import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getPackageJsonPathsToAnalyze } from './workspacePackagePaths.js';

const ignoredFolders = new Set([
	'.git',
	'.vscode',
	'.venv',
	'venv',
	'env',
	'node_modules',
	'vendor',
	'dist',
	'out',
	'build',
	'target',
	'coverage',
	'.next',
	'.nuxt',
	'.cache',
	'tmp',
	'temp',
	'logs'
]);

async function yieldToHost(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}

/** Prefer this order in the joined label; unknown tags append alphabetically at the end. */
const STACK_RANK: string[] = [
	// Runtimes / languages
	'Node.js',
	'Bun',
	'TypeScript',
	'Python',
	'Java (Maven)',
	'Java (Gradle)',
	'PHP',
	'Ruby',
	'Go',
	'Rust',
	'.NET',
	// Web frameworks & meta-frameworks
	'React',
	'Vue',
	'Angular',
	'Svelte',
	'SvelteKit',
	'Next.js',
	'Nuxt',
	'Remix',
	'Astro',
	'Gatsby',
	'SolidJS',
	'Preact',
	'Ember',
	'Qwik',
	'Lit',
	'Stencil',
	// Backend (often paired with a web UI)
	'NestJS',
	'Express',
	'Fastify',
	'Koa',
	'Hono',
	'H3',
	'Nitro',
	'AdonisJS',
	'Strapi',
	// Mobile / desktop web tooling
	'Electron',
	'React Native',
	'Expo',
	'Capacitor',
	'Ionic',
	'Tauri',
	// Build & tooling
	'Vite',
	'Webpack',
	'Rollup',
	'Parcel',
	'esbuild',
	'Turbopack',
	'Turborepo',
	'Nx',
	'Lerna',
	'Rush',
	// UI & docs
	'Tailwind CSS',
	'Bootstrap',
	'Material UI',
	'Ant Design',
	'Chakra UI',
	'Storybook',
	// Platform / deploy signals
	'Docker',
	'Firebase',
	'Serverless',
	'Playwright (project)',
	'Cypress (project)',
	'WebdriverIO (project)',
	'Nightwatch (project)',
	// Generic
	'Web',
	'Rails',
	'Django',
	'Flask',
	'FastAPI',
	'Laravel',
	'Symfony'
];

function sortStackTags(tags: Set<string>): string[] {
	const rank = new Map(STACK_RANK.map((t, i) => [t, i]));
	const list = [...tags];
	list.sort((a, b) => {
		const ra = rank.get(a) ?? 999;
		const rb = rank.get(b) ?? 999;
		if (ra !== rb) {
			return ra - rb;
		}
		return a.localeCompare(b);
	});
	return list;
}

function formatStack(tags: Set<string>): string {
	if (tags.size === 0) {
		return 'Unknown Tech Stack';
	}
	return sortStackTags(tags).join(' + ');
}

type RootListing = { files: Set<string>; dirs: Set<string> };

function listRootOnly(rootPath: string): RootListing {
	const files = new Set<string>();
	const dirs = new Set<string>();
	let dirents: fs.Dirent[];
	try {
		dirents = fs.readdirSync(rootPath, { withFileTypes: true });
	} catch {
		return { files, dirs };
	}
	for (const ent of dirents) {
		if (ent.isDirectory()) {
			if (!ignoredFolders.has(ent.name)) {
				dirs.add(ent.name);
			}
		} else {
			files.add(ent.name);
		}
	}
	return { files, dirs };
}

function existsRoot(rootPath: string, name: string): boolean {
	return fs.existsSync(path.join(rootPath, name));
}

/** Phase 1 — filenames and obvious config files only at workspace root. */
export function collectStackFromRootLevel(rootPath: string): Set<string> {
	const tags = new Set<string>();
	const { files, dirs } = listRootOnly(rootPath);

	if (files.has('package.json')) {
		tags.add('Node.js');
	}
	if (files.has('bun.lockb')) {
		tags.add('Bun');
	}
	if (existsRoot(rootPath, 'tsconfig.json')) {
		tags.add('TypeScript');
	}

	const rootConfigs: { names: string[]; tag: string }[] = [
		{ names: ['angular.json'], tag: 'Angular' },
		{ names: ['vue.config.js', 'vue.config.ts', 'vue.config.mjs'], tag: 'Vue' },
		{ names: ['nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs'], tag: 'Nuxt' },
		{ names: ['next.config.js', 'next.config.mjs', 'next.config.ts'], tag: 'Next.js' },
		{ names: ['remix.config.js', 'remix.config.ts'], tag: 'Remix' },
		{ names: ['svelte.config.js', 'svelte.config.ts'], tag: 'Svelte' },
		{ names: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'], tag: 'Astro' },
		{ names: ['gatsby-config.js', 'gatsby-config.ts', 'gatsby-config.mjs'], tag: 'Gatsby' },
		{ names: ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'], tag: 'Vite' },
		{ names: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'], tag: 'Vite' },
		{ names: ['webpack.config.js', 'webpack.config.ts'], tag: 'Webpack' },
		{ names: ['rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts'], tag: 'Rollup' },
		{ names: ['parcel.config.js', '.parcelrc'], tag: 'Parcel' },
		{ names: ['turbo.json'], tag: 'Turborepo' },
		{ names: ['nx.json'], tag: 'Nx' },
		{ names: ['lerna.json'], tag: 'Lerna' },
		{ names: ['rush.json'], tag: 'Rush' },
		{ names: ['firebase.json'], tag: 'Firebase' },
		{ names: ['serverless.yml', 'serverless.yaml'], tag: 'Serverless' },
		{ names: ['ionic.config.json'], tag: 'Ionic' },
		{ names: ['capacitor.config.json', 'capacitor.config.ts'], tag: 'Capacitor' },
		{ names: ['tauri.conf.json', 'src-tauri/tauri.conf.json'], tag: 'Tauri' },
		{ names: ['playwright.config.ts', 'playwright.config.js'], tag: 'Playwright (project)' },
		{ names: ['cypress.config.ts', 'cypress.config.js', 'cypress.json'], tag: 'Cypress (project)' },
		{ names: ['wdio.conf.js', 'wdio.conf.ts'], tag: 'WebdriverIO (project)' },
		{ names: ['nightwatch.conf.js', 'nightwatch.json'], tag: 'Nightwatch (project)' },
		{ names: ['Dockerfile'], tag: 'Docker' },
		{ names: ['docker-compose.yml', 'docker-compose.yaml'], tag: 'Docker' },
		{ names: ['pom.xml'], tag: 'Java (Maven)' },
		{ names: ['build.gradle', 'build.gradle.kts'], tag: 'Java (Gradle)' },
		{ names: ['composer.json'], tag: 'PHP' },
		{ names: ['Gemfile'], tag: 'Ruby' },
		{ names: ['go.mod'], tag: 'Go' },
		{ names: ['Cargo.toml'], tag: 'Rust' },
		{ names: ['requirements.txt', 'Pipfile', 'pyproject.toml'], tag: 'Python' },
		{ names: ['manage.py'], tag: 'Django' }
	];

	for (const { names, tag } of rootConfigs) {
		if (names.some(n => existsRoot(rootPath, n))) {
			tags.add(tag);
		}
	}

	if (files.has('index.html') && !files.has('package.json')) {
		tags.add('Web');
	}

	for (const n of files) {
		if (n.endsWith('.csproj') || n.endsWith('.fsproj')) {
			tags.add('.NET');
		}
	}

	if (files.has('Rakefile') || dirs.has('config') && files.has('Gemfile')) {
		tags.add('Rails');
	}

	// FastAPI / Flask hints from pyproject or requirements (root file only, shallow read)
	for (const pyName of ['pyproject.toml', 'requirements.txt']) {
		if (!files.has(pyName)) {
			continue;
		}
		try {
			const txt = fs.readFileSync(path.join(rootPath, pyName), 'utf8');
			if (/fastapi/i.test(txt)) {
				tags.add('FastAPI');
			}
			if (/flask/i.test(txt)) {
				tags.add('Flask');
			}
			if (/django/i.test(txt)) {
				tags.add('Django');
			}
		} catch {
			/* skip */
		}
	}

	if (existsRoot(rootPath, 'artisan')) {
		tags.add('Laravel');
	}

	// Expo / React Native — app.json
	if (files.has('app.json')) {
		try {
			const appJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'app.json'), 'utf8')) as {
				expo?: unknown;
			};
			if (appJson?.expo) {
				tags.add('Expo');
			}
		} catch {
			/* skip */
		}
	}

	return tags;
}

type PackageJsonShape = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

function mergeDeps(pkg: PackageJsonShape): Record<string, string> {
	return {
		...(pkg.dependencies ?? {}),
		...(pkg.devDependencies ?? {}),
		...(pkg.peerDependencies ?? {}),
		...(pkg.optionalDependencies ?? {})
	};
}

function hasDep(names: Record<string, string>, packageNames: string[]): boolean {
	return packageNames.some(n => names[n] !== undefined);
}

/** Derive stack tags from merged npm dependency keys. */
export function collectStackFromPackageJson(pkg: PackageJsonShape): Set<string> {
	const tags = new Set<string>();
	const names = mergeDeps(pkg);

	if (Object.keys(names).length === 0) {
		return tags;
	}

	tags.add('Node.js');

	if (hasDep(names, ['typescript', 'tsx'])) {
		tags.add('TypeScript');
	}

	const frameworkSignals: { pkgs: string[]; tag: string }[] = [
		{ pkgs: ['react', 'react-dom'], tag: 'React' },
		{ pkgs: ['vue', 'vue-router'], tag: 'Vue' },
		{ pkgs: ['@angular/core', '@angular/common'], tag: 'Angular' },
		{ pkgs: ['svelte'], tag: 'Svelte' },
		{ pkgs: ['@sveltejs/kit'], tag: 'SvelteKit' },
		{ pkgs: ['next'], tag: 'Next.js' },
		{ pkgs: ['nuxt'], tag: 'Nuxt' },
		{ pkgs: ['@remix-run/react', '@remix-run/node', 'remix'], tag: 'Remix' },
		{ pkgs: ['astro'], tag: 'Astro' },
		{ pkgs: ['gatsby'], tag: 'Gatsby' },
		{ pkgs: ['solid-js'], tag: 'SolidJS' },
		{ pkgs: ['preact'], tag: 'Preact' },
		{ pkgs: ['ember-source', 'ember-cli'], tag: 'Ember' },
		{ pkgs: ['@builder.io/qwik', '@builder.io/qwik-city'], tag: 'Qwik' },
		{ pkgs: ['lit', 'lit-element'], tag: 'Lit' },
		{ pkgs: ['@stencil/core'], tag: 'Stencil' },
		{ pkgs: ['@nestjs/core'], tag: 'NestJS' },
		{ pkgs: ['express'], tag: 'Express' },
		{ pkgs: ['fastify'], tag: 'Fastify' },
		{ pkgs: ['koa', '@koa/router'], tag: 'Koa' },
		{ pkgs: ['hono'], tag: 'Hono' },
		{ pkgs: ['h3'], tag: 'H3' },
		{ pkgs: ['nitropack'], tag: 'Nitro' },
		{ pkgs: ['@adonisjs/core'], tag: 'AdonisJS' },
		{ pkgs: ['@strapi/strapi'], tag: 'Strapi' },
		{ pkgs: ['electron'], tag: 'Electron' },
		{ pkgs: ['react-native'], tag: 'React Native' },
		{ pkgs: ['expo', 'expo-router'], tag: 'Expo' },
		{ pkgs: ['@capacitor/core'], tag: 'Capacitor' },
		{ pkgs: ['@ionic/core', '@ionic/react', '@ionic/angular'], tag: 'Ionic' },
		{ pkgs: ['@tauri-apps/api'], tag: 'Tauri' },
		{ pkgs: ['vite', '@vitejs/plugin-react', '@vitejs/plugin-vue', '@vitejs/plugin-svelte'], tag: 'Vite' },
		{ pkgs: ['webpack'], tag: 'Webpack' },
		{ pkgs: ['rollup'], tag: 'Rollup' },
		{ pkgs: ['parcel', '@parcel/core'], tag: 'Parcel' },
		{ pkgs: ['esbuild'], tag: 'esbuild' },
		{ pkgs: ['turbo'], tag: 'Turborepo' },
		{ pkgs: ['nx', '@nx/workspace'], tag: 'Nx' },
		{ pkgs: ['lerna'], tag: 'Lerna' },
		{ pkgs: ['@microsoft/rush'], tag: 'Rush' },
		{ pkgs: ['tailwindcss'], tag: 'Tailwind CSS' },
		{ pkgs: ['bootstrap'], tag: 'Bootstrap' },
		{ pkgs: ['@mui/material', '@mui/icons-material'], tag: 'Material UI' },
		{ pkgs: ['antd'], tag: 'Ant Design' },
		{ pkgs: ['@chakra-ui/react'], tag: 'Chakra UI' },
		{ pkgs: ['@storybook/react', '@storybook/vue', '@storybook/angular', 'storybook'], tag: 'Storybook' },
		{ pkgs: ['@playwright/test', 'playwright'], tag: 'Playwright (project)' },
		{ pkgs: ['cypress'], tag: 'Cypress (project)' },
		{ pkgs: ['@wdio/cli', 'webdriverio'], tag: 'WebdriverIO (project)' },
		{ pkgs: ['nightwatch'], tag: 'Nightwatch (project)' }
	];

	for (const { pkgs, tag } of frameworkSignals) {
		if (hasDep(names, pkgs)) {
			tags.add(tag);
		}
	}

	// Symfony / Laravel (composer projects often live in subfolders — root composer.json)
	if (names['symfony/symfony'] || names['symfony/framework-bundle']) {
		tags.add('Symfony');
	}
	if (names['laravel/framework']) {
		tags.add('Laravel');
	}

	return tags;
}

function readPackageJsonFile(pkgPath: string): PackageJsonShape | undefined {
	try {
		const raw = fs.readFileSync(pkgPath, 'utf8');
		return JSON.parse(raw) as PackageJsonShape;
	} catch {
		return undefined;
	}
}

/**
 * Progressive tech stack detection: root first, then package.json (root), then monorepo packages.
 * Yields to the event loop between phases so the UI stays responsive.
 *
 * @param onProgress Called after each refinement; `isFinal` is true on the last emission only.
 */
export async function detectTechStack(
	workspaceUri: vscode.Uri,
	onProgress?: (stackLabel: string, isFinal: boolean) => void
): Promise<string> {
	const rootPath = workspaceUri.fsPath;
	const tags = new Set<string>();

	const emit = (isFinal: boolean): string => {
		const label = formatStack(tags);
		onProgress?.(label, isFinal);
		return label;
	};

	// Phase 1 — root-level only
	for (const t of collectStackFromRootLevel(rootPath)) {
		tags.add(t);
	}
	emit(false);
	await yieldToHost();

	// Phase 2 — root package.json dependencies
	const rootPkgPath = path.join(rootPath, 'package.json');
	if (fs.existsSync(rootPkgPath)) {
		const rootPkg = readPackageJsonFile(rootPkgPath);
		if (rootPkg) {
			for (const t of collectStackFromPackageJson(rootPkg)) {
				tags.add(t);
			}
		}
	}
	emit(false);
	await yieldToHost();

	// Phase 3 — additional package.json files (workspaces / apps / packages)
	const pkgPaths = getPackageJsonPathsToAnalyze(rootPath);
	for (const pkgPath of pkgPaths) {
		if (pkgPath === rootPkgPath) {
			continue;
		}
		const pkg = readPackageJsonFile(pkgPath);
		if (!pkg) {
			continue;
		}
		for (const t of collectStackFromPackageJson(pkg)) {
			tags.add(t);
		}
	}

	return emit(true);
}
