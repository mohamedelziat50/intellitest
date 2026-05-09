import * as vscode from 'vscode';
import { generateViaBackend, generateViaBackendV2, loadProjectSession, syncProject } from '../services/backendClient.js';
import { getCodeInsights } from '../services/codeInsights.js';
import { exportTestCasesToExcel, readTestCasesFromExcel } from '../services/excel.js';
import { generateTestCodeWithGroq } from '../services/groqTestCode.js';
import { detectRecommendedTestingFramework } from '../services/testingFramework.js';
import type { IntelliGenerationResult } from '../types/testCases.js';
import { sanitizeTestFilename } from '../utils/testScriptNormalize.js';
import type { WebviewMessage } from '../types/messages.js';
import { getWebviewHtml } from '../webview/template.js';
import { getOrCreateProjectId } from '../utils/projectId.js';
import { listProjectRelativePaths } from '../services/codebaseContext.js';

const EMPTY_GENERATION: IntelliGenerationResult = {
	recommendedTestingFramework: 'Not generated yet',
	testCases: [],
	testScript: null
};

export class DebuggoViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'debuggoView';

	private readonly extensionUri: vscode.Uri;
	private readonly extensionContext: vscode.ExtensionContext;
	private detectedStack: string;
	/** Test runner(s) inferred from project files (package.json, etc.). */
	private recommendedTestingFramework: string;
	private view?: vscode.WebviewView;
	private latestGenerated: IntelliGenerationResult = EMPTY_GENERATION;
	/** Path of the most recently exported Excel file — used by Generate Test Code. */
	private lastExcelPath: string | undefined;

	/** Stable per-workspace identifier — generated once, persisted across restarts. */
	private readonly projectId: string;

	public constructor(
		context: vscode.ExtensionContext,
		extensionUri: vscode.Uri,
		detectedStack: string,
		recommendedTestingFramework: string
	) {
		this.extensionContext = context;
		this.extensionUri = extensionUri;
		this.detectedStack = detectedStack;
		this.recommendedTestingFramework = recommendedTestingFramework;
		this.projectId = getOrCreateProjectId(context);
	}

	/**
	 * Updates stack/framework after async workspace detection and refreshes the webview if it is open.
	 * The webview treats duplicate `init` messages as normal UI updates.
	 */
	public updateWorkspaceContext(detectedStack: string, recommendedTestingFramework: string): void {
		this.detectedStack = detectedStack;
		this.recommendedTestingFramework = recommendedTestingFramework;
		void this.view?.webview.postMessage({
			command: 'init',
			detectedStack: this.detectedStack,
			recommendedTestingFramework: this.recommendedTestingFramework,
			projectId: this.projectId
		});
	}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		const webview = webviewView.webview;

		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media'),
				vscode.Uri.joinPath(this.extensionUri, 'webview')
			]
		};

		webview.onDidReceiveMessage((message: WebviewMessage) => {
			switch (message.command) {
				case 'generate':
					void this.handleGenerate(message.prompt);
					break;
				case 'generateTestCode':
					void this.handleGenerateTestCode();
					break;
				case 'syncProject':
					void this.handleSyncProject();
					break;
				case 'exportExcel':
					void this.handleExportExcel();
					break;
				case 'copyTestScript':
					void this.handleCopyTestScript(message.code);
					break;
				case 'saveTestScript':
					void this.handleSaveTestScript(message.filename, message.code);
					break;
				case 'ready':
					// 1. Send basic init info
					void webview.postMessage({
						command: 'init',
						detectedStack: this.detectedStack,
						recommendedTestingFramework: this.recommendedTestingFramework,
						projectId: this.projectId
					});
					// 2. Load previous session from server
					void this.loadAndPostSession();
					// 3. Auto-sync the project map globally in the background
					void this.handleSyncProject(true);
					// 4. Load code insights
					void this.postCodeInsights();
					break;
				case 'refreshCodeInsights':
					void this.postCodeInsights(true);
					break;
			}
		});

		webview.html = getWebviewHtml(this.extensionUri, webview);
	}

	// ── Session loading ──────────────────────────────────────────────────────────

	/**
	 * Fetch previous session from /project/:projectId/init and push it to the webview.
	 * Fails silently if the backend is not running.
	 */
	private async loadAndPostSession(): Promise<void> {
		const backendUrl =
			vscode.workspace.getConfiguration('debuggo').get<string>('backendUrl')?.trim() ?? '';

		if (!backendUrl) {
			return; // No backend configured — skip session loading
		}

		try {
			const session = await loadProjectSession(backendUrl, this.projectId);
			if (!session) {
				return; // Server unreachable — silent degradation
			}

			void this.view?.webview.postMessage({
				command: 'sessionLoaded',
				projectId: this.projectId,
				messages: session.messages,
				context: session.context,
				features: session.features,
			});
		} catch (err) {
			// Non-critical — log but don't surface to user
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`Debuggo: could not load previous session — ${msg}`);
		}
	}

	// ── Sync Project ─────────────────────────────────────────────────────────────

	private async handleSyncProject(silent = false): Promise<void> {
		const backendUrl =
			vscode.workspace.getConfiguration('debuggo').get<string>('backendUrl')?.trim() ?? '';

		if (!backendUrl) {
			if (!silent) void vscode.window.showErrorMessage('Please configure Debuggo backend URL in settings.');
			return;
		}

		const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRootPath) {
			return;
		}

		// Grab lightweight file list (all 1000+ files)
		const allFiles = listProjectRelativePaths(workspaceRootPath, 2000);

		if (silent) {
			// Auto-sync in the background
			await syncProject(backendUrl, this.projectId, allFiles).catch(() => {});
			return;
		}

		void vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Debuggo: Building Global Intelligence Graph...',
				cancellable: false
			},
			async () => {
				const success = await syncProject(backendUrl, this.projectId, allFiles);
				if (success) {
					void vscode.window.showInformationMessage(
						'Debuggo: Global Knowledge Graph successfully rebuilt! The backend is now fully aware of all your new files and dependencies.'
					);
				} else {
					void vscode.window.showErrorMessage(
						'Debuggo: Failed to sync project map. Check backend server logs.'
					);
				}
			}
		);
	}

	// ── Generate ─────────────────────────────────────────────────────────────────

	private async handleGenerate(promptInput: string): Promise<void> {
		const prompt = (promptInput ?? '').trim();

		if (!prompt) {
			this.latestGenerated = EMPTY_GENERATION;
			this.postResult(this.latestGenerated);
			void vscode.window.showInformationMessage('Please enter a prompt first.');
			return;
		}

		const backendUrl =
			vscode.workspace.getConfiguration('debuggo').get<string>('backendUrl')?.trim() ?? '';

		if (!backendUrl) {
			void vscode.window.showErrorMessage(
				'Debuggo: set debuggo.backendUrl in Settings (default hosted API: https://intellitest-hyvw.onrender.com; use http://localhost:3000 for a local server).'
			);
			return;
		}

		try {
			const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

			this.latestGenerated = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Debuggo: generating test cases…',
					cancellable: false
				},
				// Use the new stateful v2 endpoint
				async () =>
					generateViaBackendV2(backendUrl, this.projectId, workspaceRootPath, this.detectedStack, prompt)
			);

			this.recommendedTestingFramework =
				detectRecommendedTestingFramework(workspaceRootPath) || this.recommendedTestingFramework;

			this.postResult(this.latestGenerated);

			void vscode.window.showInformationMessage('Debuggo: test cases are ready in the panel.');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Debuggo generation failed: ${errorMessage}`);
		}
	}

	// ── Generate Test Code (Groq) ─────────────────────────────────────────────────

	private async handleGenerateTestCode(): Promise<void> {
		const notifyError = (msg: string) => {
			void vscode.window.showErrorMessage(`IntelliTest: ${msg}`);
			void this.view?.webview.postMessage({ command: 'testCode', testScript: null });
		};

		// ── Step 1: Resolve test cases ────────────────────────────────────────────
		// Prefer in-memory test cases; fall back to reading the last exported Excel.

		let testCases = this.latestGenerated.testCases;

		if (testCases.length === 0) {
			// Try to read from the last known Excel file
			if (!this.lastExcelPath) {
				notifyError(
					'No test cases found in memory and no Excel file has been exported yet.\n' +
					'Generate test cases first, then click "Generate Test Code".'
				);
				return;
			}

			try {
				testCases = readTestCasesFromExcel(this.lastExcelPath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				notifyError(`Excel file cannot be parsed — ${msg}`);
				return;
			}

			if (testCases.length === 0) {
				notifyError('The Excel file is empty. Generate test cases first.');
				return;
			}
		}

		// ── Step 2: Validate Groq credentials ────────────────────────────────────

		const apiKey = process.env.API_KEY?.trim().replace(/^['"]|['"]$/g, '') ?? '';
		const model  = process.env.API_MODEL?.trim().replace(/^['"]|['"]$/g, '') ?? 'llama-3.3-70b-versatile';

		if (!apiKey) {
			notifyError(
				'Groq API key is missing.\n' +
				'Add API_KEY=your_groq_key to the root .env file and restart the extension.'
			);
			return;
		}

		// ── Step 3: Call Groq ─────────────────────────────────────────────────────

		void vscode.window.showInformationMessage(
			'IntelliTest: Generating test code from Excel test cases using Groq...'
		);

		let code: string;
		try {
			code = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'IntelliTest: Generating test code from Excel test cases using Groq...',
					cancellable: false
				},
				async () => generateTestCodeWithGroq(
					testCases,
					this.recommendedTestingFramework,
					apiKey,
					model
				)
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			notifyError(`Groq API request failed — ${msg}`);
			return;
		}

		if (!code.trim()) {
			notifyError('Groq returned empty test code. Please try again.');
			return;
		}

		// ── Step 4: Determine output filename ─────────────────────────────────────

		const filename = this.resolveTestCodeFilename();
		const language = this.resolveLanguage();

		// ── Step 5: Send to webview for preview ───────────────────────────────────

		void this.view?.webview.postMessage({
			command: 'testCode',
			testScript: {
				framework: this.recommendedTestingFramework,
				language,
				filename,
				code
			}
		});

		// ── Step 6: Save to generated-tests/ and open in editor ──────────────────

		try {
			await this.saveAndOpenTestCode(filename, code);
			void vscode.window.showInformationMessage(
				`IntelliTest: Test code generated successfully → generated-tests/${filename}`
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			notifyError(`File save failed — ${msg}`);
		}
	}

	/** Picks a filename based on the detected testing framework. */
	private resolveTestCodeFilename(): string {
		const fw = this.recommendedTestingFramework.toLowerCase();
		if (fw.includes('pytest') || fw.includes('python')) {
			return 'generatedTestCode.py';
		}
		if (fw.includes('junit') || fw.includes('java')) {
			return 'GeneratedTestCode.java';
		}
		return 'generatedTestCode.spec.js';
	}

	/** Returns a language label for the script section metadata. */
	private resolveLanguage(): string {
		const fw = this.recommendedTestingFramework.toLowerCase();
		if (fw.includes('pytest') || fw.includes('python')) { return 'python'; }
		if (fw.includes('junit') || fw.includes('java')) { return 'java'; }
		return 'javascript';
	}

	/** Saves generated code to generated-tests/<filename> and opens it in the editor. */
	private async saveAndOpenTestCode(filename: string, code: string): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			void vscode.window.showWarningMessage(
				'IntelliTest: No workspace folder open — test code was not saved to disk.'
			);
			return;
		}

		const outputDir = vscode.Uri.joinPath(folder.uri, 'generated-tests');

		try {
			await vscode.workspace.fs.stat(outputDir);
		} catch {
			await vscode.workspace.fs.createDirectory(outputDir);
		}

		const target = vscode.Uri.joinPath(outputDir, filename);
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(code));

		const doc = await vscode.workspace.openTextDocument(target);
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	// ── Clipboard / file ops ──────────────────────────────────────────────────────

	private async handleCopyTestScript(code: string): Promise<void> {
		if (!code?.trim()) {
			return;
		}
		await vscode.env.clipboard.writeText(code);
		void vscode.window.showInformationMessage('Test script copied to clipboard.');
	}

	private async handleSaveTestScript(filename: string, code: string): Promise<void> {
		const trimmed = code?.trim();
		if (!trimmed) {
			return;
		}

		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			void vscode.window.showErrorMessage('Open a folder workspace to save the test script.');
			return;
		}

		const safeName = sanitizeTestFilename(filename || 'generated.test.js');
		const testsDir = vscode.Uri.joinPath(folder.uri, 'tests');

		try {
			try {
				await vscode.workspace.fs.stat(testsDir);
			} catch {
				await vscode.workspace.fs.createDirectory(testsDir);
			}

			const target = vscode.Uri.joinPath(testsDir, safeName);
			await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(trimmed));

			void vscode.window.showInformationMessage(`Saved test script to ${target.fsPath}`);

			const doc = await vscode.workspace.openTextDocument(target);
			await vscode.window.showTextDocument(doc);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			void vscode.window.showErrorMessage(`Could not save test script: ${msg}`);
		}
	}

	private async handleExportExcel(): Promise<void> {
		this.postExportStatus(true);

		if (this.latestGenerated.testCases.length === 0) {
			void vscode.window.showWarningMessage('No generated test cases available to export.');
			this.postExportStatus(false);
			return;
		}

		try {
			const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const outputUri = await exportTestCasesToExcel(this.latestGenerated.testCases, workspaceRootPath);

			// Remember the path so "Generate Test Code" can read it
			this.lastExcelPath = outputUri.fsPath;

			const action = await vscode.window.showInformationMessage(
				'Test cases generated successfully.',
				'Open Folder'
			);

			if (action === 'Open Folder') {
				await vscode.commands.executeCommand('revealFileInOS', outputUri);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('cancelled')) {
				return;
			}
			void vscode.window.showErrorMessage(`Excel export failed: ${errorMessage}`);
		} finally {
			this.postExportStatus(false);
		}
	}

	// ── Post-to-webview helpers ───────────────────────────────────────────────────

	private postResult(generated: IntelliGenerationResult): void {
		void this.view?.webview.postMessage({
			command: 'result',
			testCases: generated.testCases,
			recommendedTestingFramework: this.recommendedTestingFramework,
			testScript: null
		});
	}

	private postExportStatus(isExporting: boolean): void {
		void this.view?.webview.postMessage({
			command: 'exportStatus',
			isExporting
		});
	}

	private async postCodeInsights(forceRefresh = false): Promise<void> {
		try {
			const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const insights = await getCodeInsights(workspaceRootPath, forceRefresh);

			void this.view?.webview.postMessage({
				command: 'codeInsights',
				files: insights.files,
				totalAnalyzedFiles: insights.totalAnalyzedFiles
			});
		} catch {
			void this.view?.webview.postMessage({
				command: 'codeInsights',
				files: [],
				totalAnalyzedFiles: 0
			});
		}
	}
}
