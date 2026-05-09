import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_PATHS = 24;

function safeReadJson(pathToFile: string): Record<string, unknown> | undefined {
	try {
		const raw = fs.readFileSync(pathToFile, 'utf8');
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/**
 * Expand npm/yarn/pnpm workspace patterns relative to repo root (only `/*` globs and plain folder names).
 */
function pathsFromWorkspacePatterns(rootPath: string, patterns: string[]): string[] {
	const out: string[] = [];
	for (const pattern of patterns) {
		if (!pattern || typeof pattern !== 'string') {
			continue;
		}
		if (pattern.endsWith('/*')) {
			const dir = path.join(rootPath, pattern.slice(0, -2));
			if (!fs.existsSync(dir)) {
				continue;
			}
			let dirents: fs.Dirent[];
			try {
				dirents = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const ent of dirents) {
				if (!ent.isDirectory()) {
					continue;
				}
				const pkg = path.join(dir, ent.name, 'package.json');
				if (fs.existsSync(pkg)) {
					out.push(pkg);
				}
				if (out.length >= MAX_PATHS) {
					return out;
				}
			}
		} else {
			const pkg = path.join(rootPath, pattern, 'package.json');
			if (fs.existsSync(pkg)) {
				out.push(pkg);
			}
		}
		if (out.length >= MAX_PATHS) {
			return out;
		}
	}
	return out;
}

function workspacePatternsFromPackageJson(pkg: Record<string, unknown>): string[] {
	const patterns: string[] = [];
	const ws = pkg.workspaces;
	if (Array.isArray(ws)) {
		for (const p of ws) {
			if (typeof p === 'string') {
				patterns.push(p);
			}
		}
	} else if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)) {
		for (const p of (ws as { packages: unknown[] }).packages) {
			if (typeof p === 'string') {
				patterns.push(p);
			}
		}
	}
	return patterns;
}

/**
 * First-level folders under `packages`, `apps`, `libs`, `projects` when no workspaces field fills the list.
 */
function shallowKnownDirs(rootPath: string, existing: Set<string>): string[] {
	const out: string[] = [];
	const bucketDirs = ['packages', 'apps', 'libs', 'projects'];
	for (const bucket of bucketDirs) {
		const base = path.join(rootPath, bucket);
		if (!fs.existsSync(base)) {
			continue;
		}
		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(base, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const ent of dirents) {
			if (!ent.isDirectory()) {
				continue;
			}
			const pkg = path.join(base, ent.name, 'package.json');
			if (fs.existsSync(pkg) && !existing.has(pkg)) {
				out.push(pkg);
				existing.add(pkg);
			}
			if (existing.size >= MAX_PATHS) {
				return out;
			}
		}
	}
	return out;
}

/**
 * package.json files to inspect for dependencies and test tooling (root → workspaces → common monorepo folders).
 */
export function getPackageJsonPathsToAnalyze(rootPath: string): string[] {
	const rootPkg = path.join(rootPath, 'package.json');
	const ordered: string[] = [];
	const seen = new Set<string>();

	if (fs.existsSync(rootPkg)) {
		ordered.push(rootPkg);
		seen.add(rootPkg);
	}

	const pkgJson = safeReadJson(rootPkg);
	if (pkgJson) {
		const patterns = workspacePatternsFromPackageJson(pkgJson);
		for (const p of pathsFromWorkspacePatterns(rootPath, patterns)) {
			if (!seen.has(p)) {
				ordered.push(p);
				seen.add(p);
			}
			if (ordered.length >= MAX_PATHS) {
				return ordered;
			}
		}
	}

	for (const p of shallowKnownDirs(rootPath, seen)) {
		ordered.push(p);
		if (ordered.length >= MAX_PATHS) {
			break;
		}
	}

	return ordered;
}
