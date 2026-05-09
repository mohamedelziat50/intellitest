import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ts from 'typescript';
import { listProjectRelativePaths } from './codebaseContext.js';
import type { CodeInsightClass, CodeInsightFile, CodeInsightsPayload } from '../types/codeInsights.js';

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const MAX_FILE_SIZE_BYTES = 200 * 1024;

type CacheEntry = {
	payload: CodeInsightsPayload;
};

const cache = new Map<string, CacheEntry>();

function getScriptKind(filePath: string): ts.ScriptKind {
	if (filePath.endsWith('.tsx')) {
		return ts.ScriptKind.TSX;
	}
	if (filePath.endsWith('.ts')) {
		return ts.ScriptKind.TS;
	}
	if (filePath.endsWith('.jsx')) {
		return ts.ScriptKind.JSX;
	}
	return ts.ScriptKind.JS;
}

function getBindingNames(bindingName: ts.BindingName): string[] {
	if (ts.isIdentifier(bindingName)) {
		return [bindingName.text];
	}

	const names: string[] = [];
	for (const element of bindingName.elements) {
		if (ts.isBindingElement(element)) {
			names.push(...getBindingNames(element.name));
		}
	}
	return names;
}

/**
 * Extract JSDoc comment summary (first line) from a node's leading trivia.
 */
function getJSDocDescription(node: ts.Node): string | undefined {
	const jsDocTags = ts.getJSDocTags(node);
	if (jsDocTags.length > 0) {
		// Look for @summary or use first comment text
		for (const tag of jsDocTags) {
			if (tag.tagName.text === 'summary' && tag.comment) {
				return typeof tag.comment === 'string' ? tag.comment.trim() : undefined;
			}
		}
	}

	// Try to extract from JSDoc block comment
	const fullText = node.getFullText?.() || '';
	const jsdocMatch = fullText.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n\s*\*\//);
	if (jsdocMatch && jsdocMatch[1]) {
		return jsdocMatch[1].trim();
	}

	return undefined;
}

/**
 * Build full function signature including parameter types and return type.
 */
function buildFunctionSignature(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): string {
	const params = node.parameters
		.map(parameter => {
			const name = ts.isIdentifier(parameter.name) ? parameter.name.text : 'param';
			const typeStr = parameter.type ? sourceFile.text.substring(parameter.type.pos, parameter.type.end) : '';
			return typeStr ? `${name}: ${typeStr}` : name;
		})
		.join(', ');

	const returnType = node.type
		? sourceFile.text.substring(node.type.pos, node.type.end)
		: '';
	const returnStr = returnType ? `: ${returnType}` : '';

	return `(${params})${returnStr}`;
}

function extractFromSourceFile(sourceFile: ts.SourceFile): Omit<CodeInsightFile, 'filePath'> {
	const functions: Array<{ name: string; signature: string; description?: string }> = [];
	const variables: string[] = [];
	const classes: CodeInsightClass[] = [];
	const imports: string[] = [];

	for (const node of sourceFile.statements) {
		if (ts.isFunctionDeclaration(node) && node.name) {
			const signature = buildFunctionSignature(node, sourceFile);
			const description = getJSDocDescription(node);
			functions.push({
				name: node.name.text,
				signature,
				description
			});
			continue;
		}

		if (ts.isVariableStatement(node)) {
			for (const declaration of node.declarationList.declarations) {
				variables.push(...getBindingNames(declaration.name));
			}
			continue;
		}

		if (ts.isClassDeclaration(node) && node.name) {
			const methods: string[] = [];
			for (const member of node.members) {
				if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
					methods.push(member.name.text);
				}
			}
			classes.push({
				name: node.name.text,
				methods
			});
			continue;
		}

		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			imports.push(node.moduleSpecifier.text);
		}
	}

	return { functions, variables, classes, imports };
}

async function analyzeFile(workspaceRootPath: string, relativePath: string): Promise<CodeInsightFile | null> {
	const absolutePath = path.join(workspaceRootPath, relativePath);
	const extension = path.extname(relativePath).toLowerCase();
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		return null;
	}

	let stat;
	try {
		stat = await fs.stat(absolutePath);
	} catch {
		return null;
	}

	if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
		return null;
	}

	let text: string;
	try {
		text = await fs.readFile(absolutePath, 'utf8');
	} catch {
		return null;
	}

	try {
		const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, getScriptKind(relativePath));
		const extracted = extractFromSourceFile(sourceFile);
		if (
			extracted.functions.length === 0 &&
			extracted.variables.length === 0 &&
			extracted.classes.length === 0 &&
			extracted.imports.length === 0
		) {
			return null;
		}

		return {
			filePath: relativePath,
			...extracted
		};
	} catch {
		return null;
	}
}

export async function getCodeInsights(
	workspaceRootPath: string | undefined,
	forceRefresh = false,
	whitelistFiles?: string[]
): Promise<CodeInsightsPayload> {
	if (!workspaceRootPath) {
		return { files: [], totalAnalyzedFiles: 0 };
	}

	const cached = !forceRefresh && !whitelistFiles ? cache.get(workspaceRootPath) : undefined;
	if (cached) {
		return cached.payload;
	}

	const allPaths = whitelistFiles !== undefined 
		? whitelistFiles 
		: listProjectRelativePaths(workspaceRootPath, 1000);
		
	const candidates = allPaths.filter(relativePath =>
		SUPPORTED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
	);

	console.log(`[Debuggo AST Parser] Starting AST analysis on ${candidates.length} candidate files.`);

	const files: CodeInsightFile[] = [];
	for (const relativePath of candidates) {
		const result = await analyzeFile(workspaceRootPath, relativePath);
		if (result) {
			files.push(result);
		}
	}

	const payload: CodeInsightsPayload = {
		files,
		totalAnalyzedFiles: candidates.length
	};

	if (!whitelistFiles) {
		cache.set(workspaceRootPath, { payload });
	}
	return payload;
}
