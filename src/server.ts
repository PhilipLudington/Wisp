import { Hono } from 'hono';
import { registerAuth, requireAuth } from './auth/routes.js';
import { config } from './config.js';
import type { DB } from './db/connection.js';
import { handleIngest } from './ingest/route.js';
import { handleSiteConfig } from './sites/configRoute.js';
import { registerStats } from './stats/routes.js';
import { handleTracker } from './tracker/serve.js';
import { registerDashboard } from './web/serve.js';

/** Options for {@link createApp}; tests override the admin password here. */
export interface AppOptions {
  adminPassword?: string;
}

/**
 * Build the Hono app. Routes are mounted here; the entry point (`index.ts`)
 * owns process concerns (DB open, migrations, listening). The database handle
 * is injected so tests can supply an isolated DB.
 */
export function createApp(db: DB, opts: AppOptions = {}): Hono {
  const app = new Hono();
  const adminPassword = opts.adminPassword ?? config.adminPassword;

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // The tracker script every site embeds.
  app.get('/wisp.js', handleTracker());

  // Public per-site config the tracker reads to decide what to auto-track.
  app.get('/c/:site', handleSiteConfig(db));

  // The only write path: tracker events.
  app.post('/e', handleIngest(db));

  // Auth (login/logout/me) is open; everything else under /api requires a
  // valid session cookie. The guard is mounted before the read routes so it
  // covers them all.
  registerAuth(app, adminPassword);
  app.use('/api/sites/*', requireAuth(adminPassword));
  app.use('/api/sites', requireAuth(adminPassword));
  registerStats(app, db);

  // The dashboard SPA + its static assets. Registered last so its catch-all
  // only handles requests the routes above didn't.
  registerDashboard(app);

  return app;
}
