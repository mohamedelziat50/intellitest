import * as path from 'node:path';
import * as vscode from 'vscode';
import * as XLSX from 'xlsx';
import type { TestCaseRow } from '../types/testCases.js';

function buildTimestampedFileName(): string {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const hh = String(now.getHours()).padStart(2, '0');
	const min = String(now.getMinutes()).padStart(2, '0');
	const ss = String(now.getSeconds()).padStart(2, '0');

	return `test_cases_${dd}-${mm}-${yy}_${hh}-${min}-${ss}.xlsx`;
}

function toSheetRows(testCases: TestCaseRow[]): Array<Record<string, string>> {
	return testCases.map(testCase => ({
		'Test Case ID': testCase.testCaseId,
		Title: testCase.title,
		Description: testCase.description,
		Preconditions: testCase.preconditions,
		Steps: testCase.steps,
		'Expected Result': testCase.expectedResult,
		Priority: testCase.priority
	}));
}

function calculateColumnWidths(rows: Array<Record<string, string>>): Array<{ wch: number }> {
	const keys = ['Test Case ID', 'Title', 'Description', 'Preconditions', 'Steps', 'Expected Result', 'Priority'];
	return keys.map(key => {
		let max = key.length;
		for (const row of rows) {
			const value = String(row[key] ?? '');
			if (value.length > max) {
				max = value.length;
			}
		}

		return { wch: Math.min(Math.max(max + 2, 14), 60) };
	});
}

export async function exportTestCasesToExcel(
	testCases: TestCaseRow[],
	workspaceRootPath: string | undefined
): Promise<vscode.Uri> {
	const rows = toSheetRows(testCases);
	const sheet = XLSX.utils.json_to_sheet(rows);
	sheet['!cols'] = calculateColumnWidths(rows);

	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, sheet, 'Test Cases');
	const fileName = buildTimestampedFileName();

	let outputPath: string;
	if (workspaceRootPath) {
		outputPath = path.join(workspaceRootPath, fileName);
	} else {
		const saveUri = await vscode.window.showSaveDialog({
			saveLabel: 'Export Test Cases',
			defaultUri: vscode.Uri.file(path.join(process.cwd(), fileName)),
			filters: { Excel: ['xlsx'] }
		});

		if (!saveUri) {
			throw new Error('Export cancelled by user.');
		}
		outputPath = saveUri.fsPath;
	}

	XLSX.writeFile(workbook, outputPath);
	return vscode.Uri.file(outputPath);
}

/**
 * Reads an existing Excel file and parses it back into TestCaseRow objects.
 * Handles any column name casing/spacing variations gracefully.
 *
 * @param filePath - Absolute path to the .xlsx file
 * @returns Array of TestCaseRow parsed from the first sheet
 */
export function readTestCasesFromExcel(filePath: string): TestCaseRow[] {
	let workbook: XLSX.WorkBook;
	try {
		workbook = XLSX.readFile(filePath);
	} catch {
		throw new Error(
			`Cannot read Excel file at:\n${filePath}\n\n` +
			'Make sure the file exists and is a valid .xlsx file.'
		);
	}

	const sheetName = workbook.SheetNames[0];
	if (!sheetName) {
		throw new Error('The Excel file contains no sheets.');
	}

	const sheet = workbook.Sheets[sheetName];
	const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

	if (!rows || rows.length === 0) {
		throw new Error('The Excel file is empty or has no data rows.');
	}

	/**
	 * Finds a value in a row by trying multiple possible column name variants.
	 * This makes parsing resilient to minor header differences.
	 */
	function pick(row: Record<string, unknown>, ...keys: string[]): string {
		for (const key of keys) {
			// Try exact match first, then case-insensitive
			if (key in row) {
				return String(row[key] ?? '').trim();
			}
			const lower = key.toLowerCase();
			for (const k of Object.keys(row)) {
				if (k.toLowerCase() === lower) {
					return String(row[k] ?? '').trim();
				}
			}
		}
		return '';
	}

	return rows.map((row, index) => ({
		testCaseId:    pick(row, 'Test Case ID', 'TestCaseID', 'ID', 'id') || `TC-${String(index + 1).padStart(3, '0')}`,
		title:         pick(row, 'Title', 'Name', 'Test Name', 'Test Case Name'),
		description:   pick(row, 'Description', 'Desc'),
		preconditions: pick(row, 'Preconditions', 'Precondition', 'Pre-conditions'),
		steps:         pick(row, 'Steps', 'Test Steps', 'Step'),
		expectedResult:pick(row, 'Expected Result', 'Expected', 'Expected Results'),
		priority:      pick(row, 'Priority', 'Severity'),
		comments:      pick(row, 'Comments', 'Notes', 'Comment'),
	}));
}
