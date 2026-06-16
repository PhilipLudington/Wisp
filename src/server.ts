import { Hono } from 'hono';

/**
 * Build the Hono app. Routes are mounted here; the entry point (`index.ts`)
 * owns process concerns (DB open, migrations, listening).
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
