/**
 * BackendClient — all HTTP calls from the extension to the Debuggo backend.
 *
 * New stateful API (v2):
 *   generateViaBackendV2()  → POST /generate   (context-aware, persisted)
 *   loadProjectSession()    → GET  /project/:projectId/init
 *
 * Legacy API (v1 — kept for backward compat):
 *   generateViaBackend()    → POST /generate-testcases + /generate-tests
 */

import axios from 'axios';
import * as vscode from 'vscode';
import type { IntelliGenerationResult, TestCaseRow } from '../types/testCases.js';
import { buildProjectMap } from './projectMap.js';
import { listProjectRelativePaths } from './codebaseContext.js';

// ── types ─────────────────────────────────────────────────────────────────────

// ── types ─────────────────────────────────────────────────────────────────────

type ServerTestCase = {
	id?: string;
	name?: string;
	description?: string;
	preconditions?: unknown;
	steps?: unknown;
	expected?: string;
	priority?: string;
	tags?: unknown;
};

export type ProjectSession = {
	projectId: string;
	messages: Array<{
		_id: string;
		prompt: string;
		response: string;
		rating: number;
		createdAt: string;
	}>;
	context: {
		modules: string[];
		routes: string[];
		priorityFiles: string[];
		contextVersion: number;
		updatedAt: string;
	} | null;
	features: Array<{
		name: string;
		description: string;
		testScore: number;
		metrics: {
			totalTests: number;
			passedTests: number;
			failedTests: number;
			coverage: number;
		};
	}>;
};

export type IntentAnalysisResult = {
	decision: string;
	matchedFeatures: string[];
	relatedFeatures: string[];
	relevantFiles: string[];
	suggestions: string[];
	isFlowTest?: boolean;
};

// ── shared helpers ─────────────────────────────────────────────────────────────

function stepsToDisplayText(steps: unknown): string {
	if (Array.isArray(steps)) {
		return steps
			.map(s => String(s ?? '').trim())
			.filter(Boolean)
			.map((t, i) => `${i + 1}. ${t}`)
			.join('\n');
	}
	return String(steps ?? '').trim();
}

function toPreconditionsText(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map(v => String(v ?? '').trim()).filter(Boolean).join('; ');
	}
	return String(value ?? '').trim();
}

function mapServerCase(item: ServerTestCase, index: number): TestCaseRow {
	const tags = Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [];
	const descriptionText = String(item.description ?? '').trim();
	const preconditionsText = toPreconditionsText(item.preconditions);
	const fallbackTagLine = tags.length ? `Tags: ${tags.join(', ')}` : '';

	return {
		testCaseId: String(item.id ?? `TC-${String(index + 1).padStart(3, '0')}`),
		title: String(item.name ?? 'Unnamed test'),
		description: descriptionText || fallbackTagLine,
		preconditions: preconditionsText,
		steps: stepsToDisplayText(item.steps),
		expectedResult: String(item.expected ?? ''),
		priority: String(item.priority ?? 'medium')
	};
}

function messageFromResponseData(data: unknown): string | undefined {
	if (data == null || typeof data !== 'object') {
		return undefined;
	}
	const d = data as Record<string, unknown>;
	if (typeof d.detail === 'string' && d.detail.trim()) {
		return d.detail;
	}
	if (typeof d.error === 'string' && d.error.trim()) {
		return d.error;
	}
	const nested = d.error;
	if (nested != null && typeof nested === 'object' && typeof (nested as { message?: unknown }).message === 'string') {
		const m = (nested as { message: string }).message;
		if (m.trim()) {
			return m;
		}
	}
	if (typeof d.message === 'string' && d.message.trim()) {
		return d.message;
	}
	return undefined;
}

function throwAxiosDetail(err: unknown): never {
	if (axios.isAxiosError(err)) {
		if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
			throw new Error(
				'Cannot reach the Debuggo backend. Check your network, verify Settings → debuggo.backendUrl (hosted: https://intellitest-hyvw.onrender.com), or run the API locally (cd Server && npm start).'
			);
		}
		const fromBody = err.response?.data != null ? messageFromResponseData(err.response.data) : undefined;
		const msg = fromBody || err.message;
		throw new Error(msg);
	}
	throw err instanceof Error ? err : new Error(String(err));
}

// ── v2: stateful API ──────────────────────────────────────────────────────────

/**
 * POST /generate — stateful, context-aware test generation.
 * Requires a stable projectId that maps to a MongoDB project record.
 */
export async function generateViaBackendV2(
	baseUrl: string,
	projectId: string,
	workspaceRootPath: string | undefined,
	detectedStack: string,
	userPrompt: string
): Promise<IntelliGenerationResult> {
	const root = baseUrl.replace(/\/$/, '');

	// PASS 1: Pre-flight check
	// Grab lightweight file list (no AST parsing yet)
	const lightweightFiles = listProjectRelativePaths(workspaceRootPath, 1000);
	
	// Ask backend to map prompt to features and dependencies
	console.log(`[Debuggo Pass 1] Sending prompt: "${userPrompt}" with ${lightweightFiles.length} raw files to /analyze-intent`);
	const intentAnalysis = await analyzeIntentV2(baseUrl, projectId, userPrompt, lightweightFiles);
	
	// If API succeeded, use its files (even if empty, meaning feature not found).
	// Only fallback to full parsing if API call failed entirely (null).
	const relevantFiles = intentAnalysis !== null 
		? intentAnalysis.relevantFiles 
		: undefined;

	console.log(`[Debuggo Pass 1 Result] Backend returned ${relevantFiles?.length || 0} relevant files. Decision: ${intentAnalysis?.decision}`);

	// Intercept missing features before doing any heavy lifting
	if (intentAnalysis && intentAnalysis.decision === 'none') {
		const suggestions = intentAnalysis.suggestions && intentAnalysis.suggestions.length > 0 
			? ` Did you mean to test: ${intentAnalysis.suggestions.join(', ')}?`
			: '';
		throw new Error(
			`We couldn't find any code matching "${userPrompt}" in your project. Debuggo requires the feature to exist in your codebase before it can generate meaningful tests for it. Please check your spelling or verify the feature is implemented.${suggestions}`
		);
	}

	// Surfacing Chain Command Awareness to the user!
	if (intentAnalysis && intentAnalysis.isFlowTest && intentAnalysis.relatedFeatures?.length > 0) {
		const related = intentAnalysis.relatedFeatures.join(", ");
		vscode.window.showInformationMessage(
			`Debuggo: You requested an E2E flow. We detected this depends on [${related}]. Including these dependencies in the context for accurate root-cause analysis.`
		);
	}

	// PASS 2: Targeted Generation
	// Build map using ONLY the relevant files
	console.log(`[Debuggo Pass 2] Building project map with ${relevantFiles ? 'whitelist' : 'full project'}...`);
	const projectMap = await buildProjectMap(workspaceRootPath, detectedStack, userPrompt, relevantFiles);

	console.log(`[Debuggo Final Payload] Sending to LLM:
- Routes attached: ${projectMap.routes.length}
- Files fully parsed (Code Insights): ${projectMap.codeInsights.length}
- Target Modules: ${projectMap.modules.length}`);

	let data: { testCases?: ServerTestCase[]; meta?: unknown; error?: string; detail?: string; message?: string };
	try {
		const res = await axios.post(`${root}/generate`, {
			projectId,
			prompt: userPrompt,
			...projectMap,
		}, {
			timeout: 120_000,
			headers: { 'Content-Type': 'application/json' }
		});
		data = res.data;
	} catch (err) {
		throwAxiosDetail(err);
	}

	if (data?.error || data?.message?.startsWith('AI')) {
		throw new Error(typeof data.detail === 'string' && data.detail ? data.detail : (data.error ?? data.message ?? 'Unknown error'));
	}

	const raw = Array.isArray(data?.testCases) ? data.testCases : [];
	const testCases = raw.map(mapServerCase);

	if (testCases.length === 0) {
		throw new Error('The backend returned no test cases. Check server logs and LLM configuration.');
	}

	return {
		recommendedTestingFramework: '',
		testCases,
		testScript: null
	};
}

/**
 * POST /analyze-intent
 * Fast pre-flight check to determine relevant features and files for a prompt
 */
export async function analyzeIntentV2(
	baseUrl: string,
	projectId: string,
	userPrompt: string,
	files: string[]
): Promise<IntentAnalysisResult | null> {
	const root = baseUrl.replace(/\/$/, '');
	try {
		const res = await axios.post<IntentAnalysisResult>(`${root}/analyze-intent`, {
			projectId,
			prompt: userPrompt,
			files
		}, {
			timeout: 10_000,
			headers: { 'Content-Type': 'application/json' }
		});
		return res.data;
	} catch (err) {
		// Non-critical: if intent analysis fails, we can fallback to full map
		console.warn('Debuggo: analyzeIntentV2 failed', err);
		return null;
	}
}

/**
 * POST /project/:projectId/sync — send all files to build the backend Intelligence Graph.
 */
export async function syncProject(
	baseUrl: string,
	projectId: string,
	files: string[]
): Promise<boolean> {
	const root = baseUrl.replace(/\/$/, '');
	try {
		await axios.post(`${root}/project/${encodeURIComponent(projectId)}/sync`, {
			files
		}, {
			timeout: 20_000,
			headers: { 'Content-Type': 'application/json' }
		});
		return true;
	} catch (err) {
		console.warn('Debuggo: syncProject failed', err);
		return false;
	}
}

/**
 * GET /project/:projectId/init — load the previous session for the current workspace.
 * Called once when the extension activates.
 *
 * Returns null on network error (graceful degradation — extension still works stateless).
 */
export async function loadProjectSession(
	baseUrl: string,
	projectId: string
): Promise<ProjectSession | null> {
	const root = baseUrl.replace(/\/$/, '');
	try {
		const res = await axios.get<ProjectSession>(`${root}/project/${encodeURIComponent(projectId)}/init`, {
			timeout: 10_000,
		});
		return res.data;
	} catch (err) {
		if (axios.isAxiosError(err) && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
			// Server not running — extension still works, just without history
			return null;
		}
		// Re-throw other errors so callers can log them
		throw err instanceof Error ? err : new Error(String(err));
	}
}

// ── v1: legacy API (unchanged) ────────────────────────────────────────────────

/**
 * Calls /generate-testcases then /generate-tests with the same project map plus structured test cases.
 * @deprecated Prefer generateViaBackendV2 for new code.
 */
export async function generateViaBackend(
	baseUrl: string,
	workspaceRootPath: string | undefined,
	detectedStack: string,
	userPrompt: string
): Promise<IntelliGenerationResult> {
	const root = baseUrl.replace(/\/$/, '');
	const projectMap = await buildProjectMap(workspaceRootPath, detectedStack, userPrompt);

	let data: { testCases?: ServerTestCase[]; error?: string; detail?: string };
	try {
		const res = await axios.post(`${root}/generate-testcases`, projectMap, {
			timeout: 120_000,
			headers: { 'Content-Type': 'application/json' }
		});
		data = res.data;
	} catch (err) {
		throwAxiosDetail(err);
	}

	if (data?.error) {
		throw new Error(typeof data.detail === 'string' && data.detail ? data.detail : data.error);
	}

	const raw = Array.isArray(data?.testCases) ? data.testCases : [];
	const testCases = raw.map(mapServerCase);

	if (testCases.length === 0) {
		throw new Error('The backend returned no test cases. Check server logs and LLM configuration.');
	}

	return {
		recommendedTestingFramework: '',
		testCases,
		testScript: null
	};
}
