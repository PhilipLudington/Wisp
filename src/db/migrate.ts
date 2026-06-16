import type { DB } from './connection.js';
import { getDb } from './connection.js';
import { migrations } from './migrations.js';

/**
 * Minimal forward-only migration runner.
 *
 * Applied versions are tracked in `schema_migrations`. Running on a fresh DB
 * applies everything; re-running is a no-op. Each migration runs inside a
 * transaction together with its bookkeeping insert, so a failure leaves the
 * version unrecorded and the schema untouched.
 */
export function runMigrations(db: DB): { applied: number[]; alreadyAt: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentRow = db
    .prepare<[], { v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')
    .get();
  const current = currentRow?.v ?? 0;

  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > current);

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const applied: number[] = [];
  for (const m of pending) {
    const apply = db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, m.name, Date.now());
    });
    apply();
    applied.push(m.version);
  }

  return { applied, alreadyAt: current };
}

// Allow running directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = getDb();
  const { applied, alreadyAt } = runMigrations(db);
  if (applied.length === 0) {
    console.log(`Database already up to date (at version ${alreadyAt}).`);
  } else {
    console.log(`Applied migrations: ${applied.join(', ')} (was at ${alreadyAt}).`);
  }
  db.close();
}
