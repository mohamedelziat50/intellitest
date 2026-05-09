import * as vscode from 'vscode';
import { DebuggoViewProvider } from './providers/DebuggoViewProvider.js';
import { detectRecommendedTestingFramework } from './services/testingFramework.js';
import { detectTechStack } from './services/techStack.js';

export function activate(context: vscode.ExtensionContext) {
	console.log('Debuggo extension activated');

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	let initialStack = 'Unknown Tech Stack';
	let initialFramework = 'Not detected yet';
	if (workspaceFolder) {
		// Tech stack detection walks the whole workspace — defer so activation can finish and the sidebar appears immediately.
		initialStack = 'Detecting…';
		initialFramework = 'Detecting…';
	}

	const provider = new DebuggoViewProvider(
		context,
		context.extensionUri,
		initialStack,
		initialFramework
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DebuggoViewProvider.viewType, provider)
	);

	if (workspaceFolder) {
		void (async () => {
			try {
				const rootPath = workspaceFolder.uri.fsPath;
				const detectedStack = await detectTechStack(workspaceFolder.uri, (stackLabel, isFinal) => {
					const fw = detectRecommendedTestingFramework(rootPath, {
						phase: isFinal ? 'full' : 'root'
					});
					provider.updateWorkspaceContext(stackLabel, fw);
				});
				console.log(`Detected tech stack: ${detectedStack}`);
			} catch (err) {
				console.error('Debuggo: tech stack detection failed', err);
				provider.updateWorkspaceContext('Unknown Tech Stack', 'Not detected yet');
			}
		})();
	}
}

export function deactivate() {}
