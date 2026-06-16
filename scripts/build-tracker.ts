/**
 * Build the tracker: minify `tracker/wisp.js` into `dist/wisp.js`.
 *
 * The minified artifact is what Hono serves at `/wisp.js`. We assert the output
 * stays within the ~1KB budget (the whole point of the tracker) and that it is
 * dependency-free (no import/require in the bundle), failing the build otherwise.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'tracker/wisp.js');
const OUT = resolve(root, 'dist/wisp.js');

/** Size ceiling for the minified tracker, in bytes (~1KB promise + headroom). */
const SIZE_LIMIT = 1500;

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [SRC],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2018',
    legalComments: 'none',
    write: false,
  });

  const out = result.outputFiles[0];
  if (!out) throw new Error('esbuild produced no output');
  const code = out.text;

  if (/\b(require|import)\b/.test(code)) {
    throw new Error('Tracker bundle is not dependency-free (found import/require)');
  }

  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > SIZE_LIMIT) {
    throw new Error(`Tracker bundle is ${bytes} bytes, over the ${SIZE_LIMIT}-byte limit`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, code);
  console.log(`Built dist/wisp.js — ${bytes} bytes (limit ${SIZE_LIMIT})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
