import { listProjectRelativePaths } from './codebaseContext.js';
import { getCodeInsights } from './codeInsights.js';
import { inferWebProjectCategory } from './projectCategory.js';

const MAX_INSIGHT_FILES_FOR_AI = 12;
const MAX_FUNCTIONS_PER_FILE_FOR_AI = 4;
const MAX_CLASSES_PER_FILE_FOR_AI = 3;
const MAX_VARS_PER_FILE_FOR_AI = 4;

function inferLanguage(detectedStack: string): string {
	const s = detectedStack.toLowerCase();
	if (s.includes('python')) {
		return 'python';
	}
	if (s.includes('java')) {
		return 'java';
	}
	if (s.includes('go')) {
		return 'go';
	}
	if (s.includes('rust')) {
		return 'rust';
	}
	if (s.includes('ruby') || s.includes('rails')) {
		return 'ruby';
	}
	if (s.includes('php')) {
		return 'php';
	}
	if (s.includes('.net') || s.includes('csharp') || s.includes('c#')) {
		return 'csharp';
	}
	return 'javascript';
}

/**
 * Extract file names mentioned in the user prompt.
 * Looks for patterns like "passwordModal.js", "auth.ts", etc.
 * Returns set of normalized file names (lowercase, forward slashes).
 */
function extractPriorityFilesFromPrompt(userPrompt: string): Set<string> {
	const filePattern = /\b([\w._-]+\.(?:js|ts|jsx|tsx))\b/gi;
	const matches = userPrompt.matchAll(filePattern);
	const priorityFiles = new Set<string>();
	for (const match of matches) {
		priorityFiles.add(match[1].toLowerCase());
	}
	return priorityFiles;
}

/**
 * Check if a file matches a priority file name.
 * Compares the basename (last part of path) with priority names.
 */
function isFilePriority(filePath: string, priorityFileNames: Set<string>): boolean {
	const basename = filePath.split(/[/\\]/).pop()?.toLowerCase() || '';
	return priorityFileNames.has(basename);
}

function summarizeCodeInsightsForAi(
	files: Array<{
		filePath: string;
		functions: Array<{ name: string; signature: string; description?: string }>;
		classes: Array<{ name: string }>;
		variables: string[];
	}>,
	priorityFileNames: Set<string> = new Set()
): string[] {
	// Partition files: priority files first, then others
	const priorityFiles = files.filter(f => isFilePriority(f.filePath, priorityFileNames));
	const otherFiles = files.filter(f => !isFilePriority(f.filePath, priorityFileNames));
	const sortedFiles = [...priorityFiles, ...otherFiles].slice(0, MAX_INSIGHT_FILES_FOR_AI);

	return sortedFiles.map((file) => {
		// Format functions with signature + optional description
		const fnList = file.functions
			.slice(0, MAX_FUNCTIONS_PER_FILE_FOR_AI)
			.map(fn => `${fn.name}${fn.signature}${fn.description ? ` - ${fn.description}` : ''}`)
			.join('; ');

		const classList = file.classes
			.slice(0, MAX_CLASSES_PER_FILE_FOR_AI)
			.map(c => c.name)
			.join(', ');
		const varList = file.variables.slice(0, MAX_VARS_PER_FILE_FOR_AI).join(', ');

		const parts: string[] = [];
		if (fnList) {
			parts.push(`functions: ${fnList}`);
		}
		if (classList) {
			parts.push(`classes: ${classList}`);
		}
		if (varList) {
			parts.push(`variables: ${varList}`);
		}

		const normalizedPath = file.filePath.replaceAll('\\\\', '/');
		// Mark priority files with ⭐ prefix for AI awareness
		const prefix = isFilePriority(file.filePath, priorityFileNames) ? '⭐ ' : '';
		return `${prefix}${normalizedPath} -> ${parts.join(' | ')}`;
	});
}

export async function buildProjectMap(
	workspaceRootPath: string | undefined,
	detectedStack: string,
	userPrompt: string
): Promise<Record<string, string | string[]>> {
	const paths = listProjectRelativePaths(workspaceRootPath, 400);
	const modules =
		paths.length > 0
			? [
					...new Set(
						paths
							.map((p: string) => p.split(/[/\\]/)[0])
							.filter((seg: string) => seg.length > 0 && !seg.startsWith('.'))
					)
				].slice(0, 40)
			: [];

	const routeHints = paths
		.filter(
			(p: string) =>
				/route|router|pages[/\\]|app[/\\]|api[/\\]|controller|endpoint/i.test(p) &&
				!p.includes('node_modules')
		)
		.slice(0, 60);

	const framework = detectedStack.trim() || 'Unknown stack';
	const projectKind = inferWebProjectCategory(workspaceRootPath, paths, userPrompt, detectedStack);

	// Extract priority files mentioned in user prompt
	const priorityFileNames = extractPriorityFilesFromPrompt(userPrompt);
	const priorityFilesList = Array.from(priorityFileNames);

	let codeInsights: string[] = [];
	try {
		const insights = await getCodeInsights(workspaceRootPath);
		codeInsights = summarizeCodeInsightsForAi(insights.files, priorityFileNames);
	} catch {
		codeInsights = [];
	}

	return {
		type: projectKind,
		language: inferLanguage(detectedStack),
		framework,
		modules: modules as string[],
		routes: routeHints,
		codeInsights,
		priorityFiles: priorityFilesList,
		prompt: userPrompt.trim()
	};
}
