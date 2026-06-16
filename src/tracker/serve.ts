import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';

/**
 * Serve the minified tracker at `/wisp.js`.
 *
 * The artifact is produced by `scripts/build-tracker.ts` into `dist/wisp.js`.
 * It is read once and cached in memory on first request, so the server boots
 * even if the tracker hasn't been built yet (returning a clear 503 until it is).
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/wisp.js');

let cached: string | null = null;

function load(): string | null {
  if (cached !== null) return cached;
  try {
    cached = readFileSync(DIST, 'utf8');
  } catch {
    return null;
  }
  return cached;
}

export function handleTracker() {
  return (c: Context): Response => {
    const js = load();
    if (js === null) {
      return c.text('tracker not built; run `npm run build:tracker`', 503);
    }
    return c.body(js, 200, {
      'content-type': 'text/javascript; charset=utf-8',
      // Cache for an hour: long enough to be cheap, short enough that tracker
      // updates propagate without a hard cache-bust.
      'cache-control': 'public, max-age=3600',
    });
  };
}
