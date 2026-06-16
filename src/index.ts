import { serve } from '@hono/node-server';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './server.js';

const db = getDb();
const { applied } = runMigrations(db);
if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(', ')}`);
}

const app = createApp(db);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Wisp listening on http://localhost:${info.port} (db: ${config.dbPath})`);
});
