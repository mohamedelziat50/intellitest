import * as fs from 'node:fs';
import * as vscode from 'vscode';

export function getWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
	const templatePath = vscode.Uri.joinPath(extensionUri, 'webview', 'debuggo.html');
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'debuggo.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'debuggo.js'));
	const highlightCssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'webview', 'highlight-github-dark.min.css'),
	);
	const highlightScriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'webview', 'highlight.min.js'),
	);
	const brandMascotUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'media', 'BMO Only.png'),
	);
	const template = fs.readFileSync(templatePath.fsPath, 'utf8');

	return template
		.replace(/{{cspSource}}/g, webview.cspSource)
		.replace(/{{highlightCssUri}}/g, highlightCssUri.toString())
		.replace(/{{highlightScriptUri}}/g, highlightScriptUri.toString())
		.replace(/{{styleUri}}/g, styleUri.toString())
		.replace(/{{scriptUri}}/g, scriptUri.toString())
		.replace(/{{brandMascotUri}}/g, brandMascotUri.toString());
}
