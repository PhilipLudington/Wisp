import type { Context } from 'hono';
import type { DB } from '../db/connection.js';
import { parseSiteConfig } from './config.js';

/**
 * Public config endpoint the tracker fetches: `GET /c/:site`.
 *
 * Returns only what the browser needs — the site's `autoTrack` flags — so the
 * served `wisp.js` can stay a single shared, cached artifact while still being
 * driven by per-site config. No auth (it's hit by anonymous page visitors) and
 * no PII; goals and any other config stay server-side.
 *
 * Unknown sites get `{ autoTrack: [] }` rather than a 404 so a stale or
 * mistyped embed degrades to "track pageviews only" instead of erroring in the
 * tracker.
 */
export function handleSiteConfig(db: DB) {
  const select = db.prepare('SELECT config FROM sites WHERE key = ?');
  return (c: Context): Response => {
    const row = select.get(c.req.param('site')) as { config: string } | undefined;
    const autoTrack = row ? parseSiteConfig(row.config).autoTrack : [];
    return c.json(
      { autoTrack },
      200,
      // Short cache: config changes should reach the tracker within minutes,
      // but we don't want a request per pageview hammering the DB.
      { 'cache-control': 'public, max-age=300' },
    );
  };
}
