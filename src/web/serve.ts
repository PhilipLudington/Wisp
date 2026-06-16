import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

/**
 * Serve the built dashboard SPA from the same Hono process.
 *
 * Vite builds the app to `dist/web/` (hashed assets under `dist/web/assets/`).
 * We serve those assets statically and fall back to `index.html` for every
 * other GET so client-side routes resolve to the app shell. This must be
 * registered AFTER the API, ingest, and tracker routes so the catch-all only
 * sees requests they didn't handle.
 *
 * `serveStatic`'s `root` is resolved relative to the process CWD (absolute
 * paths are unsupported), so we derive a CWD-relative path to the build dir;
 * the app is always started from the project root. `index.html` is read once
 * via an absolute path and cached, mirroring the tracker server, so the shell
 * is returned even from a different CWD and a clear 503 shows if it isn't built.
 */

const DIST_WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/web');

let cachedHtml: string | null = null;

function indexHtml(): string | null {
  if (cachedHtml !== null) return cachedHtml;
  try {
    cachedHtml = readFileSync(resolve(DIST_WEB, 'index.html'), 'utf8');
  } catch {
    return null;
  }
  return cachedHtml;
}

export function registerDashboard(app: Hono): void {
  const root = relative(process.cwd(), DIST_WEB) || '.';
  app.use('/assets/*', serveStatic({ root }));

  // SPA fallback: any unmatched GET serves the app shell.
  app.get('*', (c) => {
    const html = indexHtml();
    if (html === null) {
      return c.text('dashboard not built; run `npm run build:web`', 503);
    }
    return c.html(html);
  });
}
