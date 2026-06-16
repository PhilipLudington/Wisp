import { Hono } from 'hono';
import type { DB } from './db/connection.js';
import { handleIngest } from './ingest/route.js';

/**
 * Build the Hono app. Routes are mounted here; the entry point (`index.ts`)
 * owns process concerns (DB open, migrations, listening). The database handle
 * is injected so tests can supply an isolated DB.
 */
export function createApp(db: DB): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // The only write path: tracker events.
  app.post('/e', handleIngest(db));

  return app;
}
