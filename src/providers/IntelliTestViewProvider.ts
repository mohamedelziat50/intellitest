import * as vscode from 'vscode';
import { generateViaBackend, generateViaBackendV2, loadProjectSession } from '../services/backendClient.js';
import { getCodeInsights } from '../services/codeInsights.js';
import { exportTestCasesToExcel } from '../services/excel.js';
import { detectRecommendedTestingFramework } from '../services/testingFramework.js';
import type { IntelliGenerationResult } from '../types/testCases.js';
import { sanitizeTestFilename } from '../utils/testScriptNormalize.js';
import type { WebviewMessage } from '../types/messages.js';
import { getWebviewHtml } from '../webview/template.js';
import { getOrCreateProjectId } from '../utils/projectId.js';

const EMPTY_GENERATION: IntelliGenerationResult = {
	recommendedTestingFramework: 'Not generated yet',
	testCases: [],
	testScript: null
};

export class IntelliTestViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'intellitestView';

	private readonly extensionUri: vscode.Uri;
	private readonly extensionContext: vscode.ExtensionContext;
	private readonly detectedStack: string;
	/** Test runner(s) inferred from project files (package.json, etc.). */
	private recommendedTestingFramework: string;
	private view?: vscode.WebviewView;
	private latestGenerated: IntelliGenerationResult = EMPTY_GENERATION;

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
					// 3. Load code insights
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
			vscode.workspace.getConfiguration('intellitest').get<string>('backendUrl')?.trim() ?? '';

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
			console.warn(`IntelliTest: could not load previous session — ${msg}`);
		}
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
			vscode.workspace.getConfiguration('intellitest').get<string>('backendUrl')?.trim() ?? '';

		if (!backendUrl) {
			void vscode.window.showErrorMessage(
				'IntelliTest: set intellitest.backendUrl in Settings (e.g. http://localhost:3000).'
			);
			return;
		}

		try {
			const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

			this.latestGenerated = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'IntelliTest: generating test cases…',
					cancellable: false
				},
				// Use the new stateful v2 endpoint
				async () => generateViaBackendV2(
					backendUrl,
					this.projectId,
					workspaceRootPath,
					this.detectedStack,
					prompt
				)
			);

			this.recommendedTestingFramework =
				detectRecommendedTestingFramework(workspaceRootPath) || this.recommendedTestingFramework;

			this.postResult(this.latestGenerated);

			void vscode.window.showInformationMessage('IntelliTest: test cases are ready in the panel.');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`IntelliTest generation failed: ${errorMessage}`);
		}
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

			const action = await vscode.window.showInformationMessage(
				'Excel file generated successfully',
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
