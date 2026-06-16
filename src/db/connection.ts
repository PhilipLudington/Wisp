import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

export type DB = Database.Database;

/**
 * Open a SQLite connection in WAL mode with pragmas suited to a single
 * long-running ingestion process (concurrent readers, one writer).
 *
 * - `journal_mode=WAL`     — readers don't block the writer and vice versa.
 * - `synchronous=NORMAL`   — safe with WAL; fsync at checkpoints, not every commit.
 * - `foreign_keys=ON`      — enforce the events→sites reference.
 * - `busy_timeout=5000`    — wait up to 5s for the write lock instead of erroring.
 */
export function openDb(dbPath: string = config.dbPath): DB {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

let singleton: DB | undefined;

/** Process-wide shared connection, opened lazily on first use. */
export function getDb(): DB {
  if (!singleton) {
    singleton = openDb();
  }
  return singleton;
}

export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = undefined;
  }
}
