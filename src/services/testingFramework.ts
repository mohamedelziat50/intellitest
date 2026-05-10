import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPackageJsonPathsToAnalyze } from './workspacePackagePaths.js';

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

const E2E_RUNNERS = ['Playwright', 'Cypress', 'WebdriverIO', 'Nightwatch'] as const;

/** Primary ordering within unit vs E2E buckets. */
const RUNNER_PRIORITY = [
	'Vitest',
	'Jest',
	'Playwright',
	'Cypress',
	'WebdriverIO',
	'Nightwatch',
	'Mocha',
	'Karma',
	'Jasmine',
	'AVA',
	'tap',
	'bun test',
	'uvu',
	'node:test',
	'Testing Library',
	'PHPUnit',
	'PHPUnit (Pest)',
	'RSpec',
	'pytest',
	'JUnit',
	'go test',
	'cargo test'
] as const;

function mergeDeps(pkg: PackageJson): Record<string, string> {
	return {
		...(pkg.dependencies ?? {}),
		...(pkg.devDependencies ?? {}),
		...(pkg.peerDependencies ?? {}),
		...(pkg.optionalDependencies ?? {})
	};
}

function readPackageJson(filePath: string): PackageJson | undefined {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return JSON.parse(raw) as PackageJson;
	} catch {
		return undefined;
	}
}

function scriptBlob(pkg: PackageJson): string {
	const scripts = pkg.scripts ?? {};
	return [...Object.keys(scripts).map(k => `${k}:${scripts[k]}`), ...Object.values(scripts)].join(' ');
}

/**
 * Collect test runners hinted by dependencies, devDependencies, and npm scripts.
 */
export function extractRunnersFromPackageJson(pkg: PackageJson): string[] {
	const runners: string[] = [];
	const names = Object.keys(mergeDeps(pkg));
	const blob = scriptBlob(pkg);

	const vscodeExtensionTest = names.some(
		n =>
			n.includes('@vscode/test') ||
			n === '@vscode/test-cli' ||
			n === '@vscode/test-electron'
	);
	if (vscodeExtensionTest) {
		runners.push('Mocha');
	}

	if (/\bvitest\b/i.test(blob)) {
		runners.push('Vitest');
	}
	if (/\bjest\b/i.test(blob) || /jest\.config/i.test(blob)) {
		runners.push('Jest');
	}
	if (/\bmocha\b/i.test(blob)) {
		runners.push('Mocha');
	}
	if (/\bcypress\b/i.test(blob) || /\bcypress\s+run\b/i.test(blob)) {
		runners.push('Cypress');
	}
	if (/\bplaywright\b/i.test(blob) || /\bnpx\s+playwright\b/i.test(blob)) {
		runners.push('Playwright');
	}
	if (/\bwdio\b|webdriverio/i.test(blob)) {
		runners.push('WebdriverIO');
	}
	if (/\bnightwatch\b/i.test(blob)) {
		runners.push('Nightwatch');
	}
	if (/\bkarma\b/i.test(blob)) {
		runners.push('Karma');
	}
	if (/\bava\b|\bnpx\s+ava\b/i.test(blob)) {
		runners.push('AVA');
	}
	if (/\btap\b|node-tap/i.test(blob)) {
		runners.push('tap');
	}
	if (/\buvu\b/i.test(blob)) {
		runners.push('uvu');
	}
	if (/\bbun\s+test\b/i.test(blob) || /\bbun\s+run\s+test\b/i.test(blob)) {
		runners.push('bun test');
	}
	if (/\bnode\s+--test\b|\bnode:test\b/.test(blob)) {
		runners.push('node:test');
	}

	if (names.some(n => n === 'jest' || n.startsWith('jest-'))) {
		runners.push('Jest');
	}
	if (names.includes('vitest') || names.some(n => n.startsWith('@vitest/'))) {
		runners.push('Vitest');
	}
	if (names.includes('mocha')) {
		runners.push('Mocha');
	}
	if (names.includes('cypress')) {
		runners.push('Cypress');
	}
	if (names.includes('@playwright/test') || names.includes('playwright')) {
		runners.push('Playwright');
	}
	if (names.includes('@wdio/cli') || names.includes('webdriverio')) {
		runners.push('WebdriverIO');
	}
	if (names.includes('nightwatch')) {
		runners.push('Nightwatch');
	}
	if (names.includes('karma')) {
		runners.push('Karma');
	}
	if (names.includes('jasmine') || names.includes('jasmine-core')) {
		runners.push('Jasmine');
	}
	if (names.includes('ava')) {
		runners.push('AVA');
	}
	if (names.some(n => n === '@tapjs/test' || n === 'tap' || n.startsWith('@tapjs/'))) {
		runners.push('tap');
	}
	if (names.includes('uvu')) {
		runners.push('uvu');
	}

	if (names.includes('@testing-library/react') || names.includes('@testing-library/vue') || names.includes('@testing-library/svelte')) {
		runners.push('Testing Library');
	}
	if (names.includes('@testing-library/jest-dom') || names.includes('@testing-library/user-event')) {
		runners.push('Testing Library');
	}

	if (names.includes('jest-preset-angular')) {
		runners.push('Jest');
	}
	if (names.includes('@angular-devkit/build-angular') && names.includes('karma') && !runners.includes('Jest')) {
		runners.push('Karma');
	}

	if (names.includes('@types/jest')) {
		runners.push('Jest');
	}
	if (names.includes('@types/mocha')) {
		runners.push('Mocha');
	}

	return runners;
}

function pickByPriority(candidates: string[], priority: readonly string[]): string | undefined {
	const uniq = [...new Set(candidates)].filter(Boolean);
	if (uniq.length === 0) {
		return undefined;
	}
	for (const p of priority) {
		if (uniq.includes(p)) {
			return p;
		}
	}
	return uniq[0];
}

function formatRunnerRecommendation(allRunners: string[]): string {
	const uniq = [...new Set(allRunners)];
	const e2e = uniq.filter(r => (E2E_RUNNERS as readonly string[]).includes(r));
	const unitLike = uniq.filter(r => !(E2E_RUNNERS as readonly string[]).includes(r));

	const primaryUnit = pickByPriority(unitLike, RUNNER_PRIORITY);
	const primaryE2e = pickByPriority(e2e, RUNNER_PRIORITY);

	if (primaryUnit && primaryE2e && primaryUnit !== primaryE2e) {
		return `${primaryUnit} + ${primaryE2e} (E2E)`;
	}
	if (primaryE2e && !primaryUnit) {
		return `${primaryE2e} (E2E)`;
	}
	if (primaryUnit === 'Testing Library') {
		const fallback = pickByPriority(
			uniq.filter(r => r !== 'Testing Library'),
			RUNNER_PRIORITY
		);
		return fallback ? `${fallback} + Testing Library` : 'Jest + Testing Library';
	}
	if (primaryUnit) {
		return primaryUnit;
	}
	return 'Jest';
}

function detectFromPythonFiles(workspaceRoot: string): string | undefined {
	const readText = (p: string): string | undefined => {
		try {
			return fs.readFileSync(p, 'utf8');
		} catch {
			return undefined;
		}
	};

	for (const f of ['pyproject.toml', 'requirements.txt', 'setup.cfg']) {
		const txt = readText(path.join(workspaceRoot, f));
		if (!txt) {
			continue;
		}
		if (/\bpytest\b/i.test(txt)) {
			return 'pytest';
		}
		if (/\bnose\b/i.test(txt) || /\bnosetests\b/i.test(txt)) {
			return 'pytest';
		}
		if (/\bunittest\b/i.test(txt)) {
			return 'pytest';
		}
	}
	return undefined;
}

function detectFromJavaFiles(workspaceRoot: string): string | undefined {
	const readText = (p: string): string | undefined => {
		try {
			return fs.readFileSync(p, 'utf8');
		} catch {
			return undefined;
		}
	};

	const pom = readText(path.join(workspaceRoot, 'pom.xml'));
	if (pom && /junit/i.test(pom)) {
		return 'JUnit';
	}

	const gradle = readText(path.join(workspaceRoot, 'build.gradle'));
	const gradleKts = readText(path.join(workspaceRoot, 'build.gradle.kts'));
	if ((gradle && /junit/i.test(gradle)) || (gradleKts && /junit/i.test(gradleKts))) {
		return 'JUnit';
	}
	return undefined;
}

function detectFromPhpComposer(workspaceRoot: string): string | undefined {
	const composerPath = path.join(workspaceRoot, 'composer.json');
	const pkg = readPackageJson(composerPath);
	if (!pkg) {
		return undefined;
	}
	const names = Object.keys(mergeDeps(pkg));
	const blob = scriptBlob(pkg);
	if (names.includes('pestphp/pest') || /\bpest\b/i.test(blob)) {
		return 'PHPUnit (Pest)';
	}
	if (names.some(n => n.includes('phpunit'))) {
		return 'PHPUnit';
	}
	return undefined;
}

function detectFromRubyGemfile(workspaceRoot: string): string | undefined {
	const gemPath = path.join(workspaceRoot, 'Gemfile');
	let txt: string | undefined;
	try {
		txt = fs.readFileSync(gemPath, 'utf8');
	} catch {
		return undefined;
	}
	if (/\brspec\b/i.test(txt)) {
		return 'RSpec';
	}
	if (/\bminitest\b/i.test(txt)) {
		return 'RSpec';
	}
	return undefined;
}

/**
 * Aggregate runners from every discovered package.json (root + workspaces), then pick a concise recommendation.
 */
export function detectTestingFrameworkFromPackageJsons(packageJsonPaths: string[]): string {
	const all: string[] = [];
	for (const p of packageJsonPaths) {
		const pkg = readPackageJson(p);
		if (pkg) {
			all.push(...extractRunnersFromPackageJson(pkg));
		}
	}
	if (all.length > 0) {
		return formatRunnerRecommendation(all);
	}

	const root = packageJsonPaths[0] ? path.dirname(packageJsonPaths[0]) : '';
	if (root && fs.existsSync(path.join(root, 'package.json'))) {
		const pkg = readPackageJson(path.join(root, 'package.json'));
		const names = Object.keys(mergeDeps(pkg ?? {}));
		const hasTypescript = names.includes('typescript') || fs.existsSync(path.join(root, 'tsconfig.json'));
		if (hasTypescript || names.includes('tsx') || names.includes('@types/node')) {
			return 'Jest';
		}
	}

	return 'Jest';
}

export type TestingFrameworkPhase = 'root' | 'full';

/**
 * Short test-runner label for the UI. Uses root package.json first when phase is `root`,
 * then all workspace package.json files when analyzing the full repo.
 */
export function detectRecommendedTestingFramework(
	workspaceRoot: string | undefined,
	opts?: { phase?: TestingFrameworkPhase }
): string {
	if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
		return 'Jest';
	}

	const phase = opts?.phase ?? 'full';

	const rootPkg = path.join(workspaceRoot, 'package.json');
	if (!fs.existsSync(rootPkg)) {
		const py = detectFromPythonFiles(workspaceRoot);
		if (py) {
			return py;
		}
		const java = detectFromJavaFiles(workspaceRoot);
		if (java) {
			return java;
		}
		if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
			return 'go test';
		}
		if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
			return 'cargo test';
		}
		const php = detectFromPhpComposer(workspaceRoot);
		if (php) {
			return php;
		}
		const rb = detectFromRubyGemfile(workspaceRoot);
		if (rb) {
			return rb;
		}

		const orphanPackages = getPackageJsonPathsToAnalyze(workspaceRoot);
		if (orphanPackages.length > 0) {
			return detectTestingFrameworkFromPackageJsons(orphanPackages);
		}

		return 'Jest';
	}

	if (phase === 'root') {
		const pkg = readPackageJson(rootPkg);
		if (!pkg) {
			return 'Jest';
		}
		const fromPkg = formatRunnerRecommendation(extractRunnersFromPackageJson(pkg));
		if (fromPkg !== 'Jest' || Object.keys(mergeDeps(pkg)).length > 0) {
			return fromPkg;
		}
	}

	const paths = phase === 'full' ? getPackageJsonPathsToAnalyze(workspaceRoot) : [rootPkg];
	let recommendation = detectTestingFrameworkFromPackageJsons(paths);

	const py = detectFromPythonFiles(workspaceRoot);
	const java = detectFromJavaFiles(workspaceRoot);
	const php = detectFromPhpComposer(workspaceRoot);
	const rb = detectFromRubyGemfile(workspaceRoot);

	if (recommendation === 'Jest') {
		if (py) {
			recommendation = py;
		} else if (java) {
			recommendation = java;
		} else if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
			recommendation = 'go test';
		} else if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
			recommendation = 'cargo test';
		} else if (php) {
			recommendation = php;
		} else if (rb) {
			recommendation = rb;
		}
	}

	return recommendation;
}
