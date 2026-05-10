import * as vscode from 'vscode';
import {
	buildGeneratePayloadFromTestCaseRows,
	generateTestCodeViaBackend,
	generateViaBackendV2,
	loadProjectSession,
	syncProject
} from '../services/backendClient.js';
import {
	clearStoredToken,
	fetchSessionUser,
	getStoredToken,
	loginRequest,
	saveToken,
	signupRequest
} from '../services/authSession.js';
import { UnauthorizedApiError } from '../errors/unauthorized.js';
import { getCodeInsights } from '../services/codeInsights.js';
import { exportTestCasesToExcel, readTestCasesFromExcel } from '../services/excel.js';
import { detectTechStack } from '../services/techStack.js';
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
	private recommendedTestingFramework = 'Not detected yet';
	private view?: vscode.WebviewView;
	private latestGenerated: IntelliGenerationResult = EMPTY_GENERATION;
	/** Path of the most recently exported Excel file — used by Generate Test Code. */
	private lastExcelPath: string | undefined;

	/** Stable per-workspace identifier — generated once, persisted across restarts. */
	private readonly projectId: string;

	/** In-memory JWT for this extension session; cleared on logout or invalid token. */
	private authToken?: string;

	public constructor(
		context: vscode.ExtensionContext,
		extensionUri: vscode.Uri,
		initialDetectedStack = 'Unknown Tech Stack',
		initialRecommendedFramework = 'Not detected yet'
	) {
		this.extensionContext = context;
		this.extensionUri = extensionUri;
		this.projectId = getOrCreateProjectId(context);
		this.detectedStack = initialDetectedStack;
		this.recommendedTestingFramework = initialRecommendedFramework;
	}

	private async hydrateWorkspaceSignalsFromFolder(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return;
		}
		this.detectedStack = await detectTechStack(workspaceFolder.uri);
		this.recommendedTestingFramework =
			detectRecommendedTestingFramework(workspaceFolder.uri.fsPath) || this.recommendedTestingFramework;
	}

	private getBackendUrl(): string {
		return vscode.workspace.getConfiguration('debuggo').get<string>('backendUrl')?.trim() ?? '';
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
					void this.handleWebviewReady();
					break;
				case 'login':
					void this.handleAuthLogin(message.email, message.password);
					break;
				case 'signup':
					void this.handleAuthSignup(message.name, message.email, message.password);
					break;
				case 'logout':
					void this.handleLogout();
					break;
				case 'retryAuth':
					void this.handleWebviewReady();
					break;
				case 'refreshCodeInsights':
					void this.postCodeInsights(true);
					break;
			}
		});

		try {
			webview.html = getWebviewHtml(this.extensionUri, webview);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error('Debuggo: failed to load webview HTML', err);
			const safe = detail.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			webview.html = `<!DOCTYPE html><html><body style="padding:12px;font:13px var(--vscode-font-family);color:var(--vscode-foreground);">
<p><strong>Debuggo could not load its panel.</strong></p>
<p>${safe}</p>
<p>If you installed from the Marketplace, reinstall the extension or update to the latest version.</p>
</body></html>`;
		}
	}

	// ── Auth bootstrap ─────────────────────────────────────────────────────────────

	private async handleWebviewReady(): Promise<void> {
		const wv = this.view?.webview;
		if (!wv) {
			return;
		}

		void wv.postMessage({ command: 'authBusy', busy: false });

		const backendUrl = this.getBackendUrl();
		if (!backendUrl) {
			this.authToken = undefined;
			void wv.postMessage({
				command: 'authState',
				authenticated: false,
				guest: true,
				needsBackendUrl: true
			});
			return;
		}

		const stored = await getStoredToken(this.extensionContext);
		this.authToken = stored;

		if (!stored) {
			void wv.postMessage({
				command: 'authState',
				authenticated: false,
				guest: true,
				needsBackendUrl: false
			});
			await this.bootstrapGuestExperience();
			return;
		}

		try {
			const user = await fetchSessionUser(backendUrl, stored);
			if (!user) {
				await clearStoredToken(this.extensionContext);
				this.authToken = undefined;
				void wv.postMessage({
					command: 'authState',
					authenticated: false,
					guest: true,
					needsBackendUrl: false
				});
				await this.bootstrapGuestExperience();
				return;
			}

			void wv.postMessage({
				command: 'authState',
				authenticated: true,
				guest: false,
				user
			});
			await this.bootstrapAuthenticatedExperience();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`Debuggo: session bootstrap failed — ${msg}`);
			this.authToken = undefined;
			void wv.postMessage({
				command: 'authState',
				authenticated: false,
				guest: true,
				needsBackendUrl: false,
				bootstrapError:
					'Could not reach the Debuggo server to verify your account. Check that the backend is running and debuggo.backendUrl is correct, then use Retry below.'
			});
			await this.bootstrapGuestExperience();
		}
	}

	private async handleAuthLogin(email: string, password: string): Promise<void> {
		const wv = this.view?.webview;
		const backendUrl = this.getBackendUrl();
		if (!wv) {
			return;
		}

		void wv.postMessage({ command: 'authBusy', busy: true });
		void wv.postMessage({ command: 'authErrorClear' });

		if (!backendUrl) {
			void wv.postMessage({
				command: 'authError',
				message: 'Configure debuggo.backendUrl in Settings first.'
			});
			void wv.postMessage({ command: 'authBusy', busy: false });
			return;
		}

		try {
			const { token, user } = await loginRequest(backendUrl, email, password);
			await saveToken(this.extensionContext, token);
			this.authToken = token;
			void wv.postMessage({
				command: 'authState',
				authenticated: true,
				guest: false,
				user
			});
			await this.bootstrapAuthenticatedExperience();
		} catch (err) {
			const m = err instanceof Error ? err.message : String(err);
			void wv.postMessage({ command: 'authError', message: m });
		} finally {
			void wv.postMessage({ command: 'authBusy', busy: false });
		}
	}

	private async handleAuthSignup(name: string, email: string, password: string): Promise<void> {
		const wv = this.view?.webview;
		const backendUrl = this.getBackendUrl();
		if (!wv) {
			return;
		}

		void wv.postMessage({ command: 'authBusy', busy: true });
		void wv.postMessage({ command: 'authErrorClear' });

		if (!backendUrl) {
			void wv.postMessage({
				command: 'authError',
				message: 'Configure debuggo.backendUrl in Settings first.'
			});
			void wv.postMessage({ command: 'authBusy', busy: false });
			return;
		}

		try {
			const { token, user } = await signupRequest(backendUrl, name, email, password);
			await saveToken(this.extensionContext, token);
			this.authToken = token;
			void wv.postMessage({
				command: 'authState',
				authenticated: true,
				guest: false,
				user
			});
			await this.bootstrapAuthenticatedExperience();
		} catch (err) {
			const m = err instanceof Error ? err.message : String(err);
			void wv.postMessage({ command: 'authError', message: m });
		} finally {
			void wv.postMessage({ command: 'authBusy', busy: false });
		}
	}

	private async handleLogout(): Promise<void> {
		await clearStoredToken(this.extensionContext);
		this.authToken = undefined;
		this.latestGenerated = EMPTY_GENERATION;

		const backendUrl = this.getBackendUrl();
		void this.view?.webview.postMessage({
			command: 'authState',
			authenticated: false,
			guest: true,
			needsBackendUrl: !backendUrl
		});
		void this.view?.webview.postMessage({ command: 'resetMainUi' });
		await this.bootstrapGuestExperience();
	}

	private async clearSessionDueToUnauthorized(): Promise<void> {
		await clearStoredToken(this.extensionContext);
		this.authToken = undefined;
		this.latestGenerated = EMPTY_GENERATION;

		void vscode.window.showWarningMessage(
			'Debuggo: Your session expired or was revoked. Please sign in again.'
		);
		void this.view?.webview.postMessage({
			command: 'authState',
			authenticated: false,
			guest: true,
			needsBackendUrl: !this.getBackendUrl()
		});
		void this.view?.webview.postMessage({ command: 'resetMainUi' });
		await this.bootstrapGuestExperience();
	}

	private async bootstrapGuestExperience(): Promise<void> {
		const wv = this.view?.webview;
		const backendUrl = this.getBackendUrl();
		if (!wv || !backendUrl) {
			return;
		}

		void wv.postMessage({
			command: 'init',
			detectedStack: this.detectedStack,
			recommendedTestingFramework: this.recommendedTestingFramework,
			projectId: this.projectId
		});

		void this.handleSyncProject(true);
		void this.postCodeInsights();
	}

	private async bootstrapAuthenticatedExperience(): Promise<void> {
		const wv = this.view?.webview;
		if (!wv || !this.authToken) {
			return;
		}

		await this.hydrateWorkspaceSignalsFromFolder();

		void wv.postMessage({
			command: 'init',
			detectedStack: this.detectedStack,
			recommendedTestingFramework: this.recommendedTestingFramework,
			projectId: this.projectId
		});

		await this.loadAndPostSession();
		void this.handleSyncProject(true);
		void this.postCodeInsights();
	}

	// ── Session loading ──────────────────────────────────────────────────────────

	/**
	 * Fetch previous session from /project/:projectId/init and push it to the webview.
	 */
	private async loadAndPostSession(): Promise<void> {
		const backendUrl = this.getBackendUrl();

		if (!backendUrl || !this.authToken) {
			return;
		}

		try {
			const session = await loadProjectSession(backendUrl, this.projectId, this.authToken);
			if (!session) {
				return;
			}

			void this.view?.webview.postMessage({
				command: 'sessionLoaded',
				projectId: this.projectId,
				messages: session.messages,
				context: session.context,
				features: session.features
			});
		} catch (err) {
			if (err instanceof UnauthorizedApiError) {
				await this.clearSessionDueToUnauthorized();
				return;
			}
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`Debuggo: could not load previous session — ${msg}`);
		}
	}

	// ── Sync Project ─────────────────────────────────────────────────────────────

	private async handleSyncProject(silent = false): Promise<void> {
		const backendUrl = this.getBackendUrl();
		if (!backendUrl) {
			if (!silent) {
				void vscode.window.showErrorMessage('Configure Debuggo backend URL in settings.');
			}
			return;
		}

		const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRootPath) {
			return;
		}

		const allFiles = listProjectRelativePaths(workspaceRootPath, 2000);

		if (silent) {
			try {
				await syncProject(backendUrl, this.projectId, allFiles, this.authToken);
			} catch (err) {
				if (err instanceof UnauthorizedApiError) {
					await this.clearSessionDueToUnauthorized();
				}
			}
			return;
		}

		void vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Debuggo: Building Global Intelligence Graph...',
				cancellable: false
			},
			async () => {
				try {
					const success = await syncProject(backendUrl, this.projectId, allFiles, this.authToken);
					if (success) {
						void vscode.window.showInformationMessage(
							'Debuggo: Global Knowledge Graph successfully rebuilt! The backend is now fully aware of all your new files and dependencies.'
						);
					} else {
						void vscode.window.showErrorMessage(
							'Debuggo: Failed to sync project map. Check backend server logs.'
						);
					}
				} catch (err) {
					if (err instanceof UnauthorizedApiError) {
						await this.clearSessionDueToUnauthorized();
					} else {
						void vscode.window.showErrorMessage(
							'Debuggo: Failed to sync project map. Check backend server logs.'
						);
					}
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

		const backendUrl = this.getBackendUrl();

		if (!backendUrl) {
			void vscode.window.showErrorMessage(
				'Debuggo: set debuggo.backendUrl in Settings (default hosted API: https://intellitest-hyvw.onrender.com; use http://localhost:3000 for a local server).'
			);
			void this.view?.webview.postMessage({ command: 'generationEnded' });
			return;
		}

		const wv = this.view?.webview;

		try {
			const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

			this.latestGenerated = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Debuggo',
					cancellable: false
				},
				async progress => {
					const report = (message: string) => {
						progress.report({ message });
						void wv?.postMessage({ command: 'generationProgress', text: message, phase: 'cases' });
					};
					return generateViaBackendV2(
						backendUrl,
						this.projectId,
						workspaceRootPath,
						this.detectedStack,
						prompt,
						this.authToken,
						report
					);
				}
			);

			this.recommendedTestingFramework =
				detectRecommendedTestingFramework(workspaceRootPath) || this.recommendedTestingFramework;

			this.postResult(this.latestGenerated);
			if (this.latestGenerated.testCases.length > 0) {
				void vscode.window.showInformationMessage(
					'Debuggo: Test cases are ready — check the Debuggo panel.'
				);
			}
		} catch (error) {
			void wv?.postMessage({ command: 'generationEnded' });
			if (error instanceof UnauthorizedApiError) {
				await this.clearSessionDueToUnauthorized();
				return;
			}
			const errorMessage = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Debuggo generation failed: ${errorMessage}`);
		}
	}

	// ── Generate Test Code (server LLM) ─────────────────────────────────────────

	private async handleGenerateTestCode(): Promise<void> {
		const notifyError = (msg: string) => {
			void vscode.window.showErrorMessage(`Debuggo: ${msg}`);
			void this.view?.webview.postMessage({ command: 'testCodeEnded' });
			void this.view?.webview.postMessage({ command: 'testCode', testScript: null });
		};

		let usedExcelFallback = false;
		let testCases = this.latestGenerated.testCases;

		if (testCases.length === 0) {
			usedExcelFallback = true;
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

		const backendUrl = this.getBackendUrl();
		if (!backendUrl) {
			notifyError(
				'Set debuggo.backendUrl to your Debuggo server (e.g. http://localhost:3000) so test code can be generated via POST /generate-test-code.'
			);
			return;
		}

		const generateResponsePayload =
			!usedExcelFallback && this.latestGenerated.generateApiPayload
				? this.latestGenerated.generateApiPayload
				: buildGeneratePayloadFromTestCaseRows(
					testCases,
					usedExcelFallback ? 'excel-import' : 'rows-without-prior-generate-json'
				);

		const wv = this.view?.webview;

		let code: string;
		try {
			code = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'IntelliTest: test code',
					cancellable: false
				},
				async progress => {
					const report = (message: string) => {
						progress.report({ message });
						void wv?.postMessage({ command: 'testCodeProgress', text: message });
					};
					return generateTestCodeViaBackend(
						backendUrl,
						{
							framework: this.recommendedTestingFramework,
							generateResponsePayload
						},
						this.authToken,
						report
					);
				}
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			notifyError(`Test code request failed — ${msg}`);
			return;
		}

		if (!code.trim()) {
			notifyError('Server returned empty test code. Please try again.');
			return;
		}

		const filename = this.resolveTestCodeFilename();
		const language = this.resolveLanguage();

		void this.view?.webview.postMessage({
			command: 'testCode',
			testScript: {
				framework: this.recommendedTestingFramework,
				language,
				filename,
				code
			}
		});

		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			void vscode.window.showWarningMessage(
				'Debuggo: Test code generated — open the Debuggo panel to copy it. Use a workspace folder next time to auto-save under generated-tests/.'
			);
			return;
		}

		try {
			await this.saveAndOpenTestCode(filename, code);
			void vscode.window.showInformationMessage(
				`Debuggo: Test code saved to generated-tests/${filename} (opened in editor).`
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
		const wv = this.view?.webview;
		if (!code?.trim()) {
			void wv?.postMessage({ command: 'copyFeedback', success: false });
			return;
		}
		try {
			await vscode.env.clipboard.writeText(code);
			void wv?.postMessage({ command: 'copyFeedback', success: true });
		} catch {
			void wv?.postMessage({ command: 'copyFeedback', success: false });
			void vscode.window.showErrorMessage('Debuggo: could not copy to the clipboard.');
		}
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
				'Debuggo: Spreadsheet exported. You can attach it later for Generate Test Code.',
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
			testScript: generated.testScript ?? null
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
			if (forceRefresh) {
				const n = insights.files.length;
				void vscode.window.showInformationMessage(
					n > 0
						? `Debuggo: Code insights refreshed (${n} ${n === 1 ? 'file' : 'files'}).`
						: 'Debuggo: Code insights refreshed (no symbols in view).'
				);
			}
		} catch {
			void this.view?.webview.postMessage({
				command: 'codeInsights',
				files: [],
				totalAnalyzedFiles: 0
			});
			if (forceRefresh) {
				void vscode.window.showWarningMessage(
					'Debuggo: Could not refresh code insights — check that a workspace folder is open.'
				);
			}
		}
	}
}
