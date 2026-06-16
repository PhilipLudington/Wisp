import type { Context, Hono } from 'hono';
import type { DB } from '../db/connection.js';
import { parseSiteConfig } from '../sites/config.js';
import {
  currentVisitors,
  customEvents,
  deviceBreakdown,
  pageviews,
  topPages,
  topReferrers,
  uniqueVisitors,
} from './queries.js';
import { parseRange, type Range } from './range.js';

/**
 * Read API routes powering the dashboard. Mounted under `/api/sites`; the
 * caller guards the prefix with {@link import('../auth/routes.js').requireAuth}.
 *
 * Each per-site route resolves the site (404 if unknown) and, for time-scoped
 * panels, parses the `range`/`from`/`to` query (400 on bad input) before
 * delegating to a query in `queries.ts`.
 */

interface SiteRow {
  key: string;
  name: string;
  config: string;
}

export function registerStats(app: Hono, db: DB): void {
  const selectSites = db.prepare('SELECT key, name, config FROM sites ORDER BY key');
  const selectSite = db.prepare('SELECT key, name, config FROM sites WHERE key = ?');

  /** List registered sites for the dashboard's site switcher. */
  app.get('/api/sites', (c) => {
    const rows = selectSites.all() as SiteRow[];
    return c.json({
      sites: rows.map((r) => ({ key: r.key, name: r.name, config: parseSiteConfig(r.config) })),
    });
  });

  /** Resolve `:site` or send 404; null means the response is already set. */
  function resolveSite(c: Context): SiteRow | null {
    const site = selectSite.get(c.req.param('site')) as SiteRow | undefined;
    return site ?? null;
  }

  /** Resolve site + range; returns null and sets a 4xx body on failure. */
  function siteAndRange(c: Context): { site: string; range: Range } | { error: Response } {
    const site = resolveSite(c);
    if (!site) return { error: c.json({ error: 'unknown site' }, 404) };
    const r = parseRange({
      range: c.req.query('range'),
      from: c.req.query('from'),
      to: c.req.query('to'),
    });
    if (!r.ok) return { error: c.json({ error: r.error }, 400) };
    return { site: site.key, range: r.value };
  }

  app.get('/api/sites/:site/pageviews', (c) => {
    const ctx = siteAndRange(c);
    if ('error' in ctx) return ctx.error;
    return c.json(pageviews(db, ctx.site, ctx.range));
  });

  app.get('/api/sites/:site/visitors', (c) => {
    const ctx = siteAndRange(c);
    if ('error' in ctx) return ctx.error;
    // Per-day series only — no range total (see queries.uniqueVisitors).
    return c.json({ series: uniqueVisitors(db, ctx.site, ctx.range) });
  });

  app.get('/api/sites/:site/pages', (c) => {
    const ctx = siteAndRange(c);
    if ('error' in ctx) return ctx.error;
    return c.json({ pages: topPages(db, ctx.site, ctx.range) });
  });

  app.get('/api/sites/:site/referrers', (c) => {
    const ctx = siteAndRange(c);
    if ('error' in ctx) return ctx.error;
    return c.json({ referrers: topReferrers(db, ctx.site, ctx.range) });
  });

  app.get('/api/sites/:site/devices', (c) => {
    const ctx = siteAndRange(c);
    if ('error' in ctx) return ctx.error;
    return c.json({ devices: deviceBreakdown(db, ctx.site, ctx.range) });
  });

  app.get('/api/sites/:site/events', (c) => {
    const ctx = siteAndRange(c);
    if ('error' in ctx) return ctx.error;
    return c.json({ events: customEvents(db, ctx.site, ctx.range) });
  });

  app.get('/api/sites/:site/current', (c) => {
    const site = resolveSite(c);
    if (!site) return c.json({ error: 'unknown site' }, 404);
    return c.json({ current: currentVisitors(db, site.key) });
  });
}
