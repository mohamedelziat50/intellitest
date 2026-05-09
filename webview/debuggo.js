const vscode = acquireVsCodeApi();

const input = document.getElementById('promptInput');
const button = document.getElementById('generateButton');
const exportButton = document.getElementById('exportButton');
const generateCodeButton = document.getElementById('generateCodeButton');
const techStackEl = document.getElementById('techStack');
const stackTextEl = document.getElementById('stackText');
const frameworkEl = document.getElementById('framework');
const previewBody = document.getElementById('previewBody');
const insightsPanel = document.getElementById('insightsPanel');
const insightsEmpty = document.getElementById('insightsEmpty');
const insightsList = document.getElementById('insightsList');
const insightsVisibilityButton = document.getElementById('insightsVisibilityButton');
const insightsVisibilityArrow = document.getElementById('insightsVisibilityArrow');
const refreshInsightsButton = document.getElementById('refreshInsightsButton');
const scriptSection = document.getElementById('scriptSection');
const scriptMeta = document.getElementById('scriptMeta');
const scriptPre = document.getElementById('scriptPre');
const copyScriptButton = document.getElementById('copyScriptButton');
const saveScriptButton = document.getElementById('saveScriptButton');
const scriptUiEnabled = Boolean(scriptSection && copyScriptButton && saveScriptButton);
const defaultButtonText = button.textContent;
const defaultExportButtonText = exportButton.textContent;
const defaultGenerateCodeText = generateCodeButton ? generateCodeButton.textContent : 'Generate Test Code';
let hasGeneratedRows = false;
let isExporting = false;
let isGeneratingCode = false;
let isInsightsPanelOpen = true;
const INSIGHTS_PAGE_SIZE = 8;
let currentInsightsPage = 1;
/** @type {{ filename: string, code: string } | null} */
let currentScript = null;

function updateInsightsPanelVisibility() {
	insightsPanel.style.display = isInsightsPanelOpen ? 'block' : 'none';
	insightsVisibilityButton?.setAttribute('aria-expanded', isInsightsPanelOpen ? 'true' : 'false');
	if (insightsVisibilityArrow) {
		insightsVisibilityArrow.textContent = isInsightsPanelOpen ? '▾' : '▸';
	}
	if (refreshInsightsButton) {
		refreshInsightsButton.style.display = isInsightsPanelOpen ? 'inline-flex' : 'none';
	}
}

function setLoading(isLoading) {
	button.disabled = isLoading;
	button.textContent = isLoading ? 'Generating...' : defaultButtonText;
}

function updateExportButton() {
	exportButton.disabled = !hasGeneratedRows || isExporting;
	exportButton.textContent = isExporting ? 'Exporting...' : defaultExportButtonText;
}

function updateGenerateCodeButton() {
	if (!generateCodeButton) { return; }
	generateCodeButton.disabled = !hasGeneratedRows || isGeneratingCode;
	generateCodeButton.textContent = isGeneratingCode ? 'Generating Code...' : defaultGenerateCodeText;
}

function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function prefillPrompt(functionName) {
	input.value = `Generate test cases for ${functionName}`;
	input.focus();
}

function renderInsightsPagination(totalFiles) {
	const totalPages = Math.ceil(totalFiles / INSIGHTS_PAGE_SIZE);
	if (totalPages <= 1) {
		return '';
	}

	const pages = Array.from({ length: totalPages }, (_, idx) => {
		const page = idx + 1;
		const activeClass = page === currentInsightsPage ? 'active' : '';
		return `<button type="button" class="insights-page-btn ${activeClass}" data-page="${page}">${page}</button>`;
	}).join('');

	return `<div class="insights-pagination">${pages}</div>`;
}

function renderCodeInsights(files) {
	if (!Array.isArray(files) || files.length === 0) {
		insightsEmpty.style.display = 'block';
		insightsList.style.display = 'none';
		insightsList.innerHTML = '';
		currentInsightsPage = 1;
		return;
	}

	const totalPages = Math.max(1, Math.ceil(files.length / INSIGHTS_PAGE_SIZE));
	if (currentInsightsPage > totalPages) {
		currentInsightsPage = totalPages;
	}

	const start = (currentInsightsPage - 1) * INSIGHTS_PAGE_SIZE;
	const end = start + INSIGHTS_PAGE_SIZE;
	const visibleFiles = files.slice(start, end);

	const sections = visibleFiles.map(file => {
		const normalizedPath = String(file.filePath || '').replaceAll('\\', '/');
		const pathSegments = normalizedPath.split('/').filter(Boolean);
		const fileName = pathSegments[pathSegments.length - 1] || normalizedPath;
		const folderLabel = pathSegments.slice(0, -1).join('/');

		const functions = (file.functions || [])
			.map(fn => {
				// Handle both string (legacy) and object (new semantic layer)
				const fnName = typeof fn === 'string' ? fn : (fn.name || 'unknown');
				const fnSignature = typeof fn === 'string' ? '' : (fn.signature || '');
				const displayText = fnSignature ? `${fnName}${fnSignature}` : fnName;
				return `<button type="button" class="insight-item insight-fn" data-function="${escapeHtml(fnName)}">${escapeHtml(displayText)}</button>`;
			})
			.join('');

		const variables = (file.variables || [])
			.map(variableName => `<div class="insight-item">${escapeHtml(variableName)}</div>`)
			.join('');

		const classes = (file.classes || [])
			.map(cls => {
				const methods = (cls.methods || [])
					.map(method => `<div class="insight-item insight-child">${escapeHtml(method)}()</div>`)
					.join('');
				return `<div class="insight-item">${escapeHtml(cls.name)}</div>${methods}`;
			})
			.join('');

		const details = [
			functions ? `<div class="insight-block insight-block-functions"><div class="insight-title">Functions</div>${functions}</div>` : '',
			variables ? `<div class="insight-block insight-block-variables"><div class="insight-title">Variables</div>${variables}</div>` : '',
			classes ? `<div class="insight-block insight-block-classes"><div class="insight-title">Classes</div>${classes}</div>` : ''
		].join('');

		return `
			<details class="insight-file">
				<summary class="insight-file-name" title="${escapeHtml(normalizedPath)}">
					<span class="insight-row-arrow" aria-hidden="true">▸</span>
					<span class="insight-file-base">${escapeHtml(fileName)}</span>
					${folderLabel ? `<span class="insight-file-folder">${escapeHtml(folderLabel)}</span>` : ''}
				</summary>
				<div class="insight-group">
					${details || '<div class="insight-muted">No symbols detected.</div>'}
				</div>
			</details>
		`;
	}).join('');

	insightsList.innerHTML = `${sections}${renderInsightsPagination(files.length)}`;
	insightsEmpty.style.display = 'none';
	insightsList.style.display = 'block';

	for (const node of insightsList.querySelectorAll('.insight-fn')) {
		node.addEventListener('click', () => {
			prefillPrompt(node.dataset.function || 'function');
		});
	}

	for (const pageBtn of insightsList.querySelectorAll('.insights-page-btn')) {
		pageBtn.addEventListener('click', () => {
			const page = Number(pageBtn.dataset.page || '1');
			currentInsightsPage = Number.isFinite(page) ? Math.max(1, page) : 1;
			renderCodeInsights(files);
		});
	}
}

function renderTable(testCases) {
	if (!Array.isArray(testCases) || testCases.length === 0) {
		previewBody.innerHTML = '<tr><td colspan="8" class="empty-row">No test cases generated yet.</td></tr>';
		hasGeneratedRows = false;
		updateExportButton();
		updateGenerateCodeButton();
		return;
	}

	const rows = testCases.map(testCase => {
		return `
			<tr>
				<td>${escapeHtml(testCase.testCaseId)}</td>
				<td>${escapeHtml(testCase.title)}</td>
				<td>${escapeHtml(testCase.description)}</td>
				<td>${escapeHtml(testCase.preconditions)}</td>
				<td>${escapeHtml(testCase.steps)}</td>
				<td>${escapeHtml(testCase.expectedResult)}</td>
				<td>${escapeHtml(testCase.priority)}</td>
				<td>${escapeHtml(testCase.comments)}</td>
			</tr>
		`;
	}).join('');

	previewBody.innerHTML = rows;
	hasGeneratedRows = true;
	updateExportButton();
	updateGenerateCodeButton();
}

/** @param {unknown} testScript */
function renderTestScript(testScript) {
	if (!scriptUiEnabled) {
		return;
	}

	if (!testScript || typeof testScript !== 'object') {
		scriptSection.style.display = 'none';
		currentScript = null;
		return;
	}
	const ts = /** @type {{ framework?: string, language?: string, filename?: string, code?: string }} */ (testScript);
	const code = typeof ts.code === 'string' ? ts.code : '';
	if (!code.trim()) {
		scriptSection.style.display = 'none';
		currentScript = null;
		return;
	}
	const filename = typeof ts.filename === 'string' && ts.filename.trim() ? ts.filename.trim() : 'generated.test.js';
	const fw = ts.framework != null ? String(ts.framework) : '';
	const lang = ts.language != null ? String(ts.language) : '';
	scriptMeta.textContent = [
		fw && `Framework: ${fw}`,
		lang && `Language: ${lang}`,
		`File: tests/${filename}`
	]
		.filter(Boolean)
		.join(' · ');
	scriptPre.textContent = code;
	currentScript = { filename, code };
	scriptSection.style.display = '';
}

function submitPrompt() {
	setLoading(true);
	vscode.postMessage({
		command: 'generate',
		prompt: input.value.trim()
	});
}

const syncProjectButton = document.getElementById('syncProjectButton');

button.addEventListener('click', submitPrompt);

syncProjectButton?.addEventListener('click', () => {
	syncProjectButton.disabled = true;
	syncProjectButton.textContent = 'Syncing...';
	vscode.postMessage({ command: 'syncProject' });
	
	// Reset UI after 2 seconds assuming sync is fast
	setTimeout(() => {
		syncProjectButton.disabled = false;
		syncProjectButton.textContent = 'Re-sync';
	}, 2000);
});

exportButton.addEventListener('click', () => {
	vscode.postMessage({ command: 'exportExcel' });
});

generateCodeButton?.addEventListener('click', () => {
	if (!hasGeneratedRows || isGeneratingCode) { return; }
	isGeneratingCode = true;
	updateGenerateCodeButton();
	vscode.postMessage({ command: 'generateTestCode' });
});

copyScriptButton?.addEventListener('click', () => {
	if (currentScript?.code) {
		vscode.postMessage({ command: 'copyTestScript', code: currentScript.code });
	}
});

saveScriptButton?.addEventListener('click', () => {
	if (currentScript) {
		vscode.postMessage({
			command: 'saveTestScript',
			filename: currentScript.filename,
			code: currentScript.code
		});
	}
});

refreshInsightsButton?.addEventListener('click', () => {
	currentInsightsPage = 1;
	vscode.postMessage({ command: 'refreshCodeInsights' });
});

insightsVisibilityButton?.addEventListener('click', () => {
	isInsightsPanelOpen = !isInsightsPanelOpen;
	updateInsightsPanelVisibility();
});

updateInsightsPanelVisibility();

input.addEventListener('keydown', event => {
	if (event.key === 'Enter') {
		submitPrompt();
	}
});

vscode.postMessage({
	command: 'ready'
});

window.addEventListener('message', event => {
	const message = event.data;
	if (message.command === 'init') {
		stackTextEl.textContent = message.detectedStack;
		techStackEl.style.display = 'block';
		if (message.recommendedTestingFramework) {
			frameworkEl.textContent = message.recommendedTestingFramework;
		}
	} else if (message.command === 'result') {
		const testCases = Array.isArray(message.testCases) ? message.testCases : [];
		frameworkEl.textContent = message.recommendedTestingFramework || 'Not specified';
		renderTable(testCases);
		renderTestScript(message.testScript);
		setLoading(false);
	} else if (message.command === 'exportStatus') {
		isExporting = Boolean(message.isExporting);
		updateExportButton();
	} else if (message.command === 'testCode') {
		isGeneratingCode = false;
		updateGenerateCodeButton();
		renderTestScript(message.testScript);
	} else if (message.command === 'codeInsights') {
		currentInsightsPage = 1;
		renderCodeInsights(message.files || []);
	}
});