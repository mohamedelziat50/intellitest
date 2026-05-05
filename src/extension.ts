import * as vscode from 'vscode';
import { IntelliTestViewProvider } from './providers/IntelliTestViewProvider.js';
import { detectRecommendedTestingFramework } from './services/testingFramework.js';
import { detectTechStack } from './services/techStack.js';

export async function activate(context: vscode.ExtensionContext) {
	console.log('IntelliTest extension activated');

	// Show welcome message
	void vscode.window.showInformationMessage('Welcome to IntelliTest! Generate test cases from prompts.');

	// Detect tech stack from workspace
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	let detectedStack = 'Unknown Tech Stack';

	let recommendedTestingFramework = 'Not detected yet';
	if (workspaceFolder) {
		detectedStack = await detectTechStack(workspaceFolder.uri);
		recommendedTestingFramework = detectRecommendedTestingFramework(workspaceFolder.uri.fsPath);
		console.log(`Detected tech stack: ${detectedStack}`);
		void vscode.window.showInformationMessage(`IntelliTest detected: ${detectedStack}`);
	}

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			IntelliTestViewProvider.viewType,
			// Pass context so the provider can persist projectId in workspaceState
			new IntelliTestViewProvider(context, context.extensionUri, detectedStack, recommendedTestingFramework)
		)
	);
}

export function deactivate() {}
