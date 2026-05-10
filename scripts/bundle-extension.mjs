/**
 * Bundles compiled extension output (out/extension.js) into dist/extension.cjs
 * so the VSIX can ship without bundling all of node_modules (axios, xlsx, typescript).
 * CommonJS output avoids esbuild's ESM helper that rejects dynamic require() of Node builtins (axios chain).
 */
import * as esbuild from 'esbuild';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'out/extension.js');
const outfile = join(root, 'dist/extension.cjs');
const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

if (!existsSync(entry)) {
	console.error(`bundle-extension: missing ${entry} — run \`npm run compile:tsc\` first.`);
	process.exit(1);
}

mkdirSync(dirname(outfile), { recursive: true });

// Root package.json has "type":"module", so plain .js under out/ would look like ESM to esbuild.
// Compiled extension code is CommonJS — scope it so bundling stays correct and warnings stay quiet.
writeFileSync(join(root, 'out/package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');

const buildOptions = {
	entryPoints: [entry],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	outfile,
	// vscode: provided by the host. typescript: compiler API has heavy dynamic loads — ship via node_modules.
	external: ['vscode', 'typescript'],
	sourcemap: !minify,
	minify,
	logLevel: 'info',
	// Prefer CJS entry points so format:cjs bundles stay pure CommonJS (no stray `import`, no broken __require).
	mainFields: ['main', 'module'],
	conditions: ['node', 'require', 'import', 'default']
};

try {
	if (watch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log('bundle-extension: watching out/extension.js → dist/extension.cjs');
	} else {
		await esbuild.build(buildOptions);
	}
} catch (err) {
	console.error(err);
	process.exit(1);
}
