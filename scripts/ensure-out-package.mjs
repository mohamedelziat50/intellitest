/**
 * Ensures out/package.json declares CommonJS before `tsc` when using
 * `module` / `moduleResolution` Node16 — emit follows the output folder's package type.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
