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
		Priority: testCase.priority,
		Comments: testCase.comments || ''
	}));
}

function calculateColumnWidths(rows: Array<Record<string, string>>): Array<{ wch: number }> {
	const keys = ['Test Case ID', 'Title', 'Description', 'Preconditions', 'Steps', 'Expected Result', 'Priority', 'Comments'];
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
