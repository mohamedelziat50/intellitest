const vscode = acquireVsCodeApi();

// ── Auth DOM ────────────────────────────────────────────────────────────────────
const authGate = document.getElementById('authGate');
const needsBackendBanner = document.getElementById('needsBackendBanner');
const bootstrapErrorBanner = document.getElementById('bootstrapErrorBanner');
const modeLoginBtn = document.getElementById('modeLoginBtn');
const modeSignupBtn = document.getElementById('modeSignupBtn');
const authForm = document.getElementById('authForm');
const nameFieldWrap = document.getElementById('nameFieldWrap');
const authName = document.getElementById('authName');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authInlineError = document.getElementById('authInlineError');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authRetryBtn = document.getElementById('authRetryBtn');
const cancelAuthPanelBtn = document.getElementById('cancelAuthPanelBtn');
const signInAccountButton = document.getElementById('signInAccountButton');
const logoutButton = document.getElementById('logoutButton');
const userLabel = document.getElementById('userLabel');

// ── Main workspace DOM ─────────────────────────────────────────────────────────
const input = document.getElementById('promptInput');
const button = document.getElementById('generateButton');
const exportButton = document.getElementById('exportButton');
const generateCodeButton = document.getElementById('generateCodeButton');
const generationStatus = document.getElementById('generationStatus');
const promptChipsEl = document.getElementById('promptChips');
const stackDetectCard = document.getElementById('stackDetectCard');
const stackPillsEl = document.getElementById('stackPills');
const frameworkEl = document.getElementById('framework');
const frameworkPillEl = document.getElementById('frameworkPill');
const previewCardsEl = document.getElementById('previewCards');
const testcasesPanel = document.getElementById('testcasesPanel');
const testcasesVisibilityButton = document.getElementById('testcasesVisibilityButton');
const testcasesVisibilityArrow = document.getElementById('testcasesVisibilityArrow');
const testcasesCollapse = document.getElementById('testcasesCollapse');
const testcasesSectionHint = document.getElementById('testcasesSectionHint');
const insightsPanel = document.getElementById('insightsPanel');
const insightsEmpty = document.getElementById('insightsEmpty');
const insightsList = document.getElementById('insightsList');
const insightsVisibilityButton = document.getElementById('insightsVisibilityButton');
const insightsVisibilityArrow = document.getElementById('insightsVisibilityArrow');
const insightsCollapse = document.getElementById('insightsCollapse');
const refreshInsightsButton = document.getElementById('refreshInsightsButton');
const scriptInnerPanel = document.getElementById('scriptInnerPanel');
const scriptPlaceholder = document.getElementById('scriptPlaceholder');
const scriptMeta = document.getElementById('scriptMeta');
const scriptPreOuter = document.getElementById('scriptPreOuter');
const scriptPre = document.getElementById('scriptPre');
const scriptVisibilityButton = document.getElementById('scriptVisibilityButton');
const scriptVisibilityArrow = document.getElementById('scriptVisibilityArrow');
const scriptCollapse = document.getElementById('scriptCollapse');
const scriptToolbarActions = document.getElementById('scriptToolbarActions');
const copyScriptButton = document.getElementById('copyScriptButton');
const saveScriptButton = document.getElementById('saveScriptButton');
const scriptUiEnabled = Boolean(
	scriptInnerPanel &&
		scriptPlaceholder &&
		scriptPre &&
		scriptPreOuter &&
		copyScriptButton &&
		saveScriptButton,
);

const defaultButtonText = button?.textContent ?? 'Generate Test Cases';
const defaultExportButtonText = exportButton?.textContent ?? 'Export to Excel';
const defaultGenerateCodeText = generateCodeButton ? generateCodeButton.textContent : 'Generate Test Code';
const defaultCopyScriptLabel = copyScriptButton?.textContent?.trim() || 'Copy code';

let signupMode = false;
let hasGeneratedRows = false;
let isGeneratingCases = false;
let isExporting = false;
let isGeneratingCode = false;
let isInsightsPanelOpen = true;
let isTestCasesPanelOpen = true;
let isScriptInnerPanelOpen = true;
const SCRIPT_PLACEHOLDER_EMPTY =
	'No generated code yet. Run Generate Test Cases, then use Generate Test Code to produce a script here.';
/** Parsed files shown per pagination page — keep small so Code insights + Generated code fit typical sidebar heights */
const INSIGHTS_PAGE_SIZE = 4;
const TC_EMPTY_HTML =
	'<div class="tc-empty dg-muted-copy">Generate from a prompt above to see scenarios here.</div>';

let currentInsightsPage = 1;
/** @type {{ filename: string, code: string } | null} */
let currentScript = null;
/** @type {unknown[]} */
let cachedInsightFiles = [];

/** True until extension reports debuggo.backendUrl is set */
let needsBackendUrlFlag = true;

let copyFeedbackTimer = 0;
let authPanelAnimTimer = 0;

function workspaceReady() {
	return !needsBackendUrlFlag;
}

/**
 * @param {string | undefined | null} text
 * @param {{ busy?: boolean }} [opts]
 */
function setGenerationStatus(text, opts) {
	const busy = opts?.busy ?? false;
	if (!generationStatus) {
		return;
	}
	if (!text || !text.trim()) {
		generationStatus.hidden = true;
		generationStatus.textContent = '';
		generationStatus.classList.remove('generation-status-busy');
		return;
	}
	generationStatus.hidden = false;
	generationStatus.textContent = text.trim();
	generationStatus.classList.toggle('generation-status-busy', Boolean(busy));
}

function updatePromptChipsVisibility() {
	if (!promptChipsEl) {
		return;
	}
	const show =
		workspaceReady() && !hasGeneratedRows && !isGeneratingCases && !isGeneratingCode;
	promptChipsEl.hidden = !show;
}

/**
 * @param {string} rawCode
 * @param {string} language
 */
function applyScriptHighlight(rawCode, language) {
	if (!scriptPre) {
		return;
	}
	const lang =
		language === 'python' ? 'python' : language === 'java' ? 'java' : 'javascript';
	if (typeof hljs !== 'undefined' && rawCode.trim()) {
		try {
			const { value } = hljs.highlight(rawCode, { language: lang, ignoreIllegals: true });
			scriptPre.innerHTML = value;
			scriptPre.className = `hljs language-${lang}`;
			return;
		} catch {
			/* unsupported grammar — try auto-detect */
		}
		try {
			const r = hljs.highlightAuto(rawCode);
			if (r?.value != null) {
				scriptPre.innerHTML = r.value;
				scriptPre.className = 'hljs';
				return;
			}
		} catch {
			/* plain text fallback */
		}
	}
	scriptPre.textContent = rawCode;
	scriptPre.className = 'hljs';
}

function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function splitStackPieces(label) {
	if (label == null) {
		return [];
	}
	const s = String(label).trim();
	if (!s) {
		return [];
	}
	return s
		.split(/\s*\+\s*/)
		.map(part => part.trim())
		.filter(Boolean);
}

function renderTechStackPills(stackLabel) {
	if (!stackPillsEl || !stackDetectCard) {
		return;
	}
	const parts = splitStackPieces(stackLabel);
	if (parts.length === 0) {
		stackPillsEl.innerHTML = '';
		stackDetectCard.hidden = true;
		return;
	}
	stackDetectCard.hidden = false;
	stackPillsEl.innerHTML = parts
		.map(p => `<span class="pill pill-compact">${escapeHtml(p)}</span>`)
		.join('');
}

function truncateOneLine(text, maxLen = 156) {
	const s = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (s.length <= maxLen) {
		return s;
	}
	return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function testCasesLoadingSkeletonHtml() {
	const rows = ['', '', '', ''].map(
		() =>
			`<div class="dg-skel-block" aria-hidden="true"><div class="dg-skel-line dg-skel-line-w70"></div><div class="dg-skel-line dg-skel-line-w40"></div></div>`,
	);
	return `<div class="dg-skel-list">${rows.join('')}</div>`;
}

function injectTestCasesSkeleton() {
	if (!previewCardsEl) {
		return;
	}
	previewCardsEl.innerHTML = testCasesLoadingSkeletonHtml();
}

function updateTestcasesSectionHint(count) {
	if (!testcasesSectionHint) {
		return;
	}
	if (!count || count < 1) {
		testcasesSectionHint.textContent = '';
		return;
	}
	testcasesSectionHint.textContent = `${count} scenario${count === 1 ? '' : 's'}`;
}

function setFrameworkLabel(text) {
	if (frameworkEl) {
		frameworkEl.textContent = text != null && String(text).trim() ? String(text).trim() : 'Not generated yet';
	}
	const t = frameworkEl?.textContent ?? '';
	const muted =
		!t.trim() ||
		/^(not generated yet|not specified|not detected yet)$/i.test(t.trim());
	if (frameworkPillEl) {
		frameworkPillEl.classList.toggle('pill-muted', Boolean(muted));
	}
}

function openAuthPanel() {
	if (!authGate) {
		return;
	}
	window.clearTimeout(authPanelAnimTimer);
	authGate.hidden = false;
	authGate.classList.remove('auth-gate--open');
	void authGate.offsetHeight;
	window.requestAnimationFrame(() => {
		authGate.classList.add('auth-gate--open');
	});
}

function closeAuthPanel(instant = false) {
	clearAuthInlineError();
	if (!authGate) {
		return;
	}
	window.clearTimeout(authPanelAnimTimer);
	if (instant) {
		authGate.classList.remove('auth-gate--open');
		authGate.hidden = true;
		return;
	}
	authGate.classList.remove('auth-gate--open');
	/* Match longest auth card transition (transform 320ms); hiding early clips the exit animation */
	authPanelAnimTimer = window.setTimeout(() => {
		authGate.hidden = true;
	}, 335);
}

function setSignupMode(signup) {
	signupMode = signup;
	if (modeLoginBtn && modeSignupBtn) {
		modeLoginBtn.classList.toggle('active', !signup);
		modeSignupBtn.classList.toggle('active', signup);
		modeLoginBtn.setAttribute('aria-selected', signup ? 'false' : 'true');
		modeSignupBtn.setAttribute('aria-selected', signup ? 'true' : 'false');
	}
	if (nameFieldWrap) {
		nameFieldWrap.hidden = !signup;
	}
	if (authName && signup) {
		authName.required = true;
	} else if (authName) {
		authName.required = false;
	}
	const pw = authPassword;
	if (pw) {
		pw.autocomplete = signup ? 'new-password' : 'current-password';
		pw.minLength = signup ? 8 : 0;
	}
}

function clearAuthInlineError() {
	if (authInlineError) {
		authInlineError.textContent = '';
		authInlineError.hidden = true;
	}
}

function showAuthInlineError(text) {
	if (authInlineError) {
		authInlineError.textContent = text;
		authInlineError.hidden = !text.trim();
	}
}

function updateBootstrapBanner(message) {
	if (!bootstrapErrorBanner) {
		return;
	}
	if (message && String(message).trim()) {
		bootstrapErrorBanner.textContent = message;
		bootstrapErrorBanner.hidden = false;
		if (authRetryBtn) {
			authRetryBtn.hidden = false;
		}
	} else {
		bootstrapErrorBanner.textContent = '';
		bootstrapErrorBanner.hidden = true;
		if (authRetryBtn) {
			authRetryBtn.hidden = true;
		}
	}
}

function setAuthBusy(busy) {
	if (authSubmitBtn) {
		authSubmitBtn.disabled = Boolean(busy);
		authSubmitBtn.textContent = busy ? 'Please wait…' : 'Continue';
	}
	if (authRetryBtn) {
		authRetryBtn.disabled = Boolean(busy);
	}
}

function applyAuthChrome(authenticated) {
	if (signInAccountButton) {
		signInAccountButton.hidden = Boolean(authenticated);
	}
	if (logoutButton) {
		logoutButton.hidden = !authenticated;
	}
	if (authenticated) {
		closeAuthPanel(true);
	}
}

const syncProjectButton = document.getElementById('syncProjectButton');
const syncWorkspaceLabel = 'Sync';

function applyWorkspaceGating() {
	const ok = workspaceReady();
	if (syncProjectButton) {
		syncProjectButton.disabled = !ok;
		syncProjectButton.style.opacity = ok ? '' : '0.55';
	}
	if (button && !isGeneratingCases) {
		button.disabled = !ok;
		button.style.opacity = ok ? '' : '0.55';
	}
	updateGenerateCodeButton();
	updatePromptChipsVisibility();
}

function resetMainWorkspaceUi() {
	if (input) {
		input.value = '';
	}
	if (stackPillsEl) {
		stackPillsEl.innerHTML = '';
	}
	if (stackDetectCard) {
		stackDetectCard.hidden = true;
	}
	setFrameworkLabel('Not generated yet');
	renderTestCases([]);
	renderTestScript(null);
	cachedInsightFiles = [];
	currentInsightsPage = 1;
	renderCodeInsights([]);
	if (button) {
		button.disabled = !workspaceReady();
		button.textContent = defaultButtonText;
		button.style.opacity = workspaceReady() ? '' : '0.55';
	}
	if (syncProjectButton) {
		syncProjectButton.disabled = !workspaceReady();
		syncProjectButton.textContent = syncWorkspaceLabel;
		syncProjectButton.style.opacity = workspaceReady() ? '' : '0.55';
	}
	if (userLabel) {
		userLabel.textContent = '';
	}
	isGeneratingCode = false;
	updateGenerateCodeButton();
	updateTestcasesSectionHint(0);
	updatePromptChipsVisibility();
}

signInAccountButton?.addEventListener('click', () => {
	clearAuthInlineError();
	openAuthPanel();
});

cancelAuthPanelBtn?.addEventListener('click', () => {
	closeAuthPanel();
});

document.addEventListener('keydown', e => {
	if (e.key !== 'Escape' || e.defaultPrevented) {
		return;
	}
	if (!authGate || authGate.hidden || !authGate.classList.contains('auth-gate--open')) {
		return;
	}
	e.preventDefault();
	closeAuthPanel();
});

modeLoginBtn?.addEventListener('click', () => {
	clearAuthInlineError();
	setSignupMode(false);
});

modeSignupBtn?.addEventListener('click', () => {
	clearAuthInlineError();
	setSignupMode(true);
});

authForm?.addEventListener('submit', e => {
	e.preventDefault();
	clearAuthInlineError();
	const email = (authEmail?.value ?? '').trim();
	const password = authPassword?.value ?? '';
	const name = (authName?.value ?? '').trim();
	if (!email || !password) {
		showAuthInlineError('Email and password are required.');
		return;
	}
	if (signupMode) {
		if (!name) {
			showAuthInlineError('Name is required to create an account.');
			return;
		}
		vscode.postMessage({ command: 'signup', name, email, password });
	} else {
		vscode.postMessage({ command: 'login', email, password });
	}
});

authRetryBtn?.addEventListener('click', () => {
	clearAuthInlineError();
	updateBootstrapBanner('');
	vscode.postMessage({ command: 'retryAuth' });
});

logoutButton?.addEventListener('click', () => {
	vscode.postMessage({ command: 'logout' });
});

setSignupMode(false);
closeAuthPanel(true);

function updateInsightsPanelVisibility() {
	if (insightsCollapse) {
		insightsCollapse.dataset.collapsed = isInsightsPanelOpen ? 'false' : 'true';
	}
	insightsVisibilityButton?.setAttribute('aria-expanded', isInsightsPanelOpen ? 'true' : 'false');
	if (insightsVisibilityArrow) {
		insightsVisibilityArrow.textContent = isInsightsPanelOpen ? '▾' : '▸';
	}
	if (refreshInsightsButton) {
		refreshInsightsButton.style.display = isInsightsPanelOpen ? 'inline-flex' : 'none';
	}
}

function updateTestCasesPanelVisibility() {
	if (testcasesCollapse) {
		testcasesCollapse.dataset.collapsed = isTestCasesPanelOpen ? 'false' : 'true';
	}
	testcasesVisibilityButton?.setAttribute('aria-expanded', isTestCasesPanelOpen ? 'true' : 'false');
	if (testcasesVisibilityArrow) {
		testcasesVisibilityArrow.textContent = isTestCasesPanelOpen ? '▾' : '▸';
	}
}

function updateScriptInnerPanelVisibility() {
	if (scriptCollapse) {
		scriptCollapse.dataset.collapsed = isScriptInnerPanelOpen ? 'false' : 'true';
	}
	scriptInnerPanel?.style.removeProperty('display');
	scriptVisibilityButton?.setAttribute(
		'aria-expanded',
		isScriptInnerPanelOpen ? 'true' : 'false',
	);
	if (scriptVisibilityArrow) {
		scriptVisibilityArrow.textContent = isScriptInnerPanelOpen ? '▾' : '▸';
	}
	if (scriptToolbarActions) {
		scriptToolbarActions.style.display = isScriptInnerPanelOpen ? 'inline-flex' : 'none';
	}
}

function setLoading(isLoading) {
	if (!button) {
		return;
	}
	isGeneratingCases = Boolean(isLoading);
	if (isLoading) {
		injectTestCasesSkeleton();
		updateTestcasesSectionHint(0);
	}
	button.disabled = isLoading || !workspaceReady();
	button.textContent = isLoading ? 'Generating…' : defaultButtonText;
	button.style.opacity = !workspaceReady() ? '0.55' : '';
	updatePromptChipsVisibility();
}

function updateExportButton() {
	if (!exportButton) {
		return;
	}
	exportButton.disabled = !hasGeneratedRows || isExporting;
	exportButton.textContent = isExporting ? 'Exporting...' : defaultExportButtonText;
}

function updateGenerateCodeButton() {
	if (!generateCodeButton) {
		return;
	}
	const allow = workspaceReady();
	generateCodeButton.disabled =
		!allow || !hasGeneratedRows || isGeneratingCode;
	generateCodeButton.textContent = isGeneratingCode ? 'Generating…' : defaultGenerateCodeText;
	generateCodeButton.title =
		!allow ?
			'Set debuggo.backendUrl in VS Code Settings to reach the backend.'
		: !hasGeneratedRows ?
				'Run “Generate Test Cases” first — this creates code from those scenarios.'
		: isGeneratingCode ?
				'Sending scenarios to the server.'
		:	'Produce runnable test code from the scenarios listed below.';
	updatePromptChipsVisibility();
}

function prefillPrompt(functionName) {
	if (!input) {
		return;
	}
	input.value = `Generate test cases for ${functionName}`;
	input.focus();
}

function renderInsightsPagination(totalFiles) {
	const totalPages = Math.ceil(totalFiles / INSIGHTS_PAGE_SIZE);
	if (totalPages <= 1 || !insightsList) {
		return '';
	}

	const cur = currentInsightsPage;
	const prevDisabled = cur <= 1;
	const nextDisabled = cur >= totalPages;

	return `
		<div class="insights-pagination" role="navigation" aria-label="Code insights pages">
			<button type="button" class="insights-pager-btn" data-insights-pager="prev" aria-label="Previous file page"${
				prevDisabled ? ' disabled' : ''
			}>‹ Prev</button>
			<span class="insights-pager-meta"><span aria-current="page">Page ${cur}</span> <span class="insights-pager-of">of</span> ${totalPages}</span>
			<button type="button" class="insights-pager-btn" data-insights-pager="next" aria-label="Next file page"${
				nextDisabled ? ' disabled' : ''
			}>Next ›</button>
		</div>`;
}

function renderCodeInsights(files) {
	const list = Array.isArray(files) ? files : [];
	cachedInsightFiles = list;

	if (!insightsEmpty || !insightsList) {
		return;
	}

	if (list.length === 0) {
		insightsEmpty.style.display = 'block';
		insightsList.style.display = 'none';
		insightsList.innerHTML = '';
		currentInsightsPage = 1;
		return;
	}

	const totalPages = Math.max(1, Math.ceil(list.length / INSIGHTS_PAGE_SIZE));
	if (currentInsightsPage > totalPages) {
		currentInsightsPage = totalPages;
	}

	const start = (currentInsightsPage - 1) * INSIGHTS_PAGE_SIZE;
	const end = start + INSIGHTS_PAGE_SIZE;
	const visibleFiles = list.slice(start, end);

	const sections = visibleFiles.map(file => {
		const normalizedPath = String(file.filePath || '').replaceAll('\\', '/');
		const pathSegments = normalizedPath.split('/').filter(Boolean);
		const fileName = pathSegments[pathSegments.length - 1] || normalizedPath;
		const folderLabel = pathSegments.slice(0, -1).join('/');

		const functions = (file.functions || [])
			.map(fn => {
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

		const imports = (file.imports || [])
			.map(imp => `<div class="insight-item">${escapeHtml(imp)}</div>`)
			.join('');

		const details = [
			functions
				? `<div class="insight-block insight-block-functions"><div class="insight-title"><span class="insight-glyph" aria-hidden="true">ƒ</span>Functions</div>${functions}</div>`
				: '',
			variables
				? `<div class="insight-block insight-block-variables"><div class="insight-title"><span class="insight-glyph" aria-hidden="true">$</span>Variables</div>${variables}</div>`
				: '',
			classes
				? `<div class="insight-block insight-block-classes"><div class="insight-title"><span class="insight-glyph" aria-hidden="true">◇</span>Classes</div>${classes}</div>`
				: '',
			imports
				? `<div class="insight-block insight-block-imports"><div class="insight-title"><span class="insight-glyph" aria-hidden="true">⧉</span>Imports</div>${imports}</div>`
				: ''
		].join('');

		return `
			<details class="insight-file">
				<summary class="insight-file-name" title="${escapeHtml(normalizedPath)}">
					<span class="insight-row-arrow" aria-hidden="true">▸</span>
					<span class="insight-file-base">${escapeHtml(fileName)}</span>
					${folderLabel ? `<span class="insight-file-folder">${escapeHtml(folderLabel)}</span>` : ''}
				</summary>
				<div class="insight-drawer">
					<div class="insight-drawer-inner">
						<div class="insight-group">
							${details || '<div class="insight-muted">No symbols detected.</div>'}
						</div>
					</div>
				</div>
			</details>
		`;
	}).join('');

	insightsList.innerHTML = `${sections}${renderInsightsPagination(list.length)}`;
	insightsEmpty.style.display = 'none';
	insightsList.style.display = 'block';
}

function renderTestCases(testCases) {
	if (!previewCardsEl || !exportButton) {
		return;
	}

	if (!Array.isArray(testCases) || testCases.length === 0) {
		previewCardsEl.innerHTML = TC_EMPTY_HTML;
		hasGeneratedRows = false;
		updateExportButton();
		updateGenerateCodeButton();
		updateTestcasesSectionHint(0);
		updatePromptChipsVisibility();
		return;
	}

	const cards = testCases.map(testCase => {
		const id = escapeHtml(testCase.testCaseId);
		const title = escapeHtml(testCase.title);
		const priority = escapeHtml(testCase.priority);
		const snippet = escapeHtml(truncateOneLine(testCase.description));
		const pre = escapeHtml(testCase.preconditions ?? '');
		const steps = escapeHtml(testCase.steps ?? '');
		const expected = escapeHtml(testCase.expectedResult ?? '');

		return `
			<details class="tc-card">
				<summary class="tc-summary">
					<div class="tc-sum-body">
						<div class="tc-headline">
							<div class="tc-line-top">
								<span class="tc-id">${id}</span>
								<span class="tc-title-text">${title}</span>
								<span class="tc-priority">${priority}</span>
							</div>
							<div class="tc-snippet">${snippet}</div>
						</div>
						<span class="tc-chev" aria-hidden="true">▸</span>
					</div>
				</summary>
				<div class="tc-expand">
					<div class="tc-field">
						<div class="tc-field-label">Preconditions</div>
						<div class="tc-field-value">${pre}</div>
					</div>
					<div class="tc-field">
						<div class="tc-field-label">Steps</div>
						<div class="tc-field-value">${steps}</div>
					</div>
					<div class="tc-field">
						<div class="tc-field-label">Expected result</div>
						<div class="tc-field-value">${expected}</div>
					</div>
				</div>
			</details>
		`;
	}).join('');

	previewCardsEl.innerHTML = cards;
	hasGeneratedRows = true;
	queueMicrotask(() => {
		let idx = 0;
		for (const el of previewCardsEl.querySelectorAll('.tc-card')) {
			el.style.setProperty('--tc-reveal-delay', `${Math.min(idx * 42, 380)}ms`);
			el.classList.add('tc-reveal-item');
			idx += 1;
		}
	});
	updateExportButton();
	updateGenerateCodeButton();
	updateTestcasesSectionHint(testCases.length);
	updatePromptChipsVisibility();
}

/** @param {unknown} testScript */
function renderTestScript(testScript) {
	if (!scriptUiEnabled || !scriptPlaceholder || !scriptPre) {
		return;
	}

	if (!testScript || typeof testScript !== 'object') {
		currentScript = null;
		if (scriptMeta) {
			scriptMeta.textContent = '';
			scriptMeta.hidden = true;
		}
		if (scriptPre) {
			scriptPre.textContent = '';
			scriptPre.className = 'hljs';
		}
		if (scriptPreOuter) {
			scriptPreOuter.removeAttribute('title');
			scriptPreOuter.hidden = true;
		}
		scriptInnerPanel?.classList.remove('panel-fade-mount');
		scriptPlaceholder.textContent = SCRIPT_PLACEHOLDER_EMPTY;
		scriptPlaceholder.hidden = false;
		if (copyScriptButton) {
			copyScriptButton.disabled = true;
		}
		if (saveScriptButton) {
			saveScriptButton.disabled = true;
		}
		return;
	}

	const ts = /** @type {{ framework?: string, language?: string, filename?: string, code?: string }} */ (
		testScript
	);
	const code = typeof ts.code === 'string' ? ts.code : '';
	if (!code.trim()) {
		renderTestScript(null);
		return;
	}

	const filename =
		typeof ts.filename === 'string' && ts.filename.trim()
			? ts.filename.trim()
			: 'generated.test.js';
	const fw = ts.framework != null ? String(ts.framework) : '';
	const lang = ts.language != null ? String(ts.language) : '';
	const relPath = `tests/${filename}`;
	if (scriptMeta) {
		scriptMeta.textContent = relPath;
		scriptMeta.hidden = false;
	}
	scriptPlaceholder.hidden = true;
	if (scriptPreOuter) {
		scriptPreOuter.hidden = false;
	}
	const tooltipBits = [fw, lang].filter(Boolean);
	const tip = tooltipBits.length > 0 ? `${tooltipBits.join(' · ')} · ${relPath}` : relPath;
	if (scriptPreOuter) {
		scriptPreOuter.title = tip;
	}
	applyScriptHighlight(code, lang);
	currentScript = { filename, code };
	if (scriptInnerPanel) {
		scriptInnerPanel.classList.remove('panel-fade-mount');
		window.requestAnimationFrame(() => {
			void scriptInnerPanel.offsetHeight;
			scriptInnerPanel.classList.add('panel-fade-mount');
		});
	}
	if (copyScriptButton) {
		copyScriptButton.disabled = false;
	}
	if (saveScriptButton) {
		saveScriptButton.disabled = false;
	}
}

function submitPrompt() {
	if (!workspaceReady()) {
		return;
	}
	setGenerationStatus('Starting…', { busy: true });
	setLoading(true);
	vscode.postMessage({
		command: 'generate',
		prompt: (input?.value ?? '').trim()
	});
}

button?.addEventListener('click', submitPrompt);

syncProjectButton?.addEventListener('click', () => {
	if (!workspaceReady()) {
		return;
	}
	syncProjectButton.disabled = true;
	syncProjectButton.textContent = 'Syncing...';
	vscode.postMessage({ command: 'syncProject' });

	setTimeout(() => {
		applyWorkspaceGating();
		syncProjectButton.textContent = syncWorkspaceLabel;
	}, 2000);
});

exportButton?.addEventListener('click', () => {
	vscode.postMessage({ command: 'exportExcel' });
});

generateCodeButton?.addEventListener('click', () => {
	if (!workspaceReady() || !hasGeneratedRows || isGeneratingCode) {
		return;
	}
	isGeneratingCode = true;
	setGenerationStatus('Preparing test code…', { busy: true });
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

refreshInsightsButton?.addEventListener('click', e => {
	e.preventDefault();
	e.stopPropagation();
	currentInsightsPage = 1;
	vscode.postMessage({ command: 'refreshCodeInsights' });
});

/* Delegated once — insightsList is recreated via innerHTML; per-row/per-pager handlers would stack */
insightsList?.addEventListener('click', e => {
	const fnBtn = e.target.closest('.insight-fn');
	if (fnBtn instanceof HTMLButtonElement) {
		e.preventDefault();
		e.stopPropagation();
		prefillPrompt(fnBtn.dataset.function || 'function');
		return;
	}
	const btn = e.target.closest('[data-insights-pager]');
	if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	const totalPages = Math.max(1, Math.ceil(cachedInsightFiles.length / INSIGHTS_PAGE_SIZE));
	const dir = btn.dataset.insightsPager;
	if (dir === 'prev') {
		currentInsightsPage = Math.max(1, currentInsightsPage - 1);
	} else if (dir === 'next') {
		currentInsightsPage = Math.min(totalPages, currentInsightsPage + 1);
	}
	renderCodeInsights(cachedInsightFiles);
});

insightsVisibilityButton?.addEventListener('click', () => {
	isInsightsPanelOpen = !isInsightsPanelOpen;
	updateInsightsPanelVisibility();
});

testcasesVisibilityButton?.addEventListener('click', () => {
	isTestCasesPanelOpen = !isTestCasesPanelOpen;
	updateTestCasesPanelVisibility();
});

scriptVisibilityButton?.addEventListener('click', () => {
	isScriptInnerPanelOpen = !isScriptInnerPanelOpen;
	updateScriptInnerPanelVisibility();
});

updateInsightsPanelVisibility();
updateTestCasesPanelVisibility();
updateScriptInnerPanelVisibility();
renderTestScript(null);
updateTestcasesSectionHint(0);
updatePromptChipsVisibility();

promptChipsEl?.addEventListener('click', e => {
	const t = /** @type {HTMLElement} */ (e.target);
	const chip = t.closest?.('.prompt-chip');
	if (!chip || !input) {
		return;
	}
	const p = chip.dataset.prompt;
	if (p) {
		input.value = p;
		input.focus();
	}
});

input?.addEventListener('keydown', event => {
	if (event.key === 'Enter') {
		submitPrompt();
	}
});

window.addEventListener('message', event => {
	const message = event.data;

	if (message.command === 'authState') {
		const authenticated = Boolean(message.authenticated);
		const needsBackend = Boolean(message.needsBackendUrl);
		clearAuthInlineError();
		updateBootstrapBanner(authenticated ? '' : message.bootstrapError);

		needsBackendUrlFlag = needsBackend;
		applyWorkspaceGating();

		if (needsBackendBanner) {
			needsBackendBanner.hidden = authenticated || !needsBackend;
		}

		applyAuthChrome(authenticated);

		if (authenticated) {
			const display = message.user?.name?.trim?.() || message.user?.email || '';
			if (userLabel && display) {
				userLabel.textContent = display;
			}
		} else if (userLabel) {
			userLabel.textContent = '';
		}
		return;
	}

	if (message.command === 'authError') {
		const m = typeof message.message === 'string' ? message.message : 'Something went wrong.';
		showAuthInlineError(m);
		return;
	}

	if (message.command === 'authErrorClear') {
		clearAuthInlineError();
		return;
	}

	if (message.command === 'authBusy') {
		setAuthBusy(Boolean(message.busy));
		return;
	}

	if (message.command === 'resetMainUi') {
		resetMainWorkspaceUi();
		return;
	}

	if (message.command === 'init') {
		if (message.detectedStack != null) {
			renderTechStackPills(message.detectedStack);
		}
		if (message.recommendedTestingFramework != null) {
			setFrameworkLabel(message.recommendedTestingFramework);
		}
		return;
	}

	if (message.command === 'generationProgress') {
		if (message.phase && message.phase !== 'cases') {
			return;
		}
		setGenerationStatus(message.text ?? '', { busy: true });
		return;
	}

	if (message.command === 'generationEnded') {
		setGenerationStatus('');
		setLoading(false);
		return;
	}

	if (message.command === 'testCodeProgress') {
		setGenerationStatus(message.text ?? '', { busy: true });
		return;
	}

	if (message.command === 'testCodeEnded') {
		isGeneratingCode = false;
		updateGenerateCodeButton();
		if (!isGeneratingCases) {
			setGenerationStatus('');
		}
		return;
	}

	if (message.command === 'copyFeedback') {
		if (!copyScriptButton) {
			return;
		}
		window.clearTimeout(copyFeedbackTimer);
		if (message.success) {
			copyScriptButton.textContent = 'Copied!';
			copyScriptButton.classList.add('btn-copy-done');
			copyFeedbackTimer = window.setTimeout(() => {
				copyScriptButton.textContent = defaultCopyScriptLabel;
				copyScriptButton.classList.remove('btn-copy-done');
			}, 2000);
		} else {
			copyScriptButton.textContent = defaultCopyScriptLabel;
			copyScriptButton.classList.remove('btn-copy-done');
		}
		return;
	}

	if (message.command === 'result') {
		const testCases = Array.isArray(message.testCases) ? message.testCases : [];
		setFrameworkLabel(message.recommendedTestingFramework || 'Not specified');
		renderTestCases(testCases);
		renderTestScript(message.testScript);
		setGenerationStatus('');
		setLoading(false);
		return;
	}

	if (message.command === 'exportStatus') {
		isExporting = Boolean(message.isExporting);
		updateExportButton();
		return;
	}

	if (message.command === 'testCode') {
		isGeneratingCode = false;
		updateGenerateCodeButton();
		renderTestScript(message.testScript);
		setGenerationStatus('');
		return;
	}

	if (message.command === 'codeInsights') {
		currentInsightsPage = 1;
		renderCodeInsights(message.files || []);
		return;
	}

	if (message.command === 'sessionLoaded') {
		/** Reserved for chat history UI; backend scopes by user + projectId. */
	}
});

vscode.postMessage({
	command: 'ready'
});
