import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';

/** Create a migrated, throwaway file-backed DB and a cleanup function. */
export function makeTestDb(): { db: DB; cleanup: () => void; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wisp-test-'));
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db);
  return {
    db,
    dir,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Register a site for tests. */
export function seedSite(
  db: DB,
  key = 'blog',
  domains: string[] = ['https://blog.example.com'],
  config = '{}',
): void {
  db.prepare('INSERT INTO sites (key, name, domains, config) VALUES (?, ?, ?, ?)').run(
    key,
    key,
    JSON.stringify(domains),
    config,
  );
}

/** A realistic desktop Chrome user-agent for tests. */
export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
