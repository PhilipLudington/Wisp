import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { DB } from '../db/connection.js';

/**
 * Daily-rotating salt service.
 *
 * The visitor hash uses a salt that must be **stable for the whole calendar
 * day** (in the configured rotation timezone) so every request that day hashes
 * to the same visitor id. The current day's salt is persisted in the one-row
 * `salt` table on the volume, so a restart/redeploy mid-day reuses it instead
 * of re-randomizing (which would inflate unique-visitor counts).
 *
 * On the first request of a new day a fresh salt is generated and the prior
 * day's row is deleted — only the current day is ever kept, so yesterday's
 * hashes can't be reconstructed even from a DB dump.
 */

/** Compute the rotation day key (`YYYY-MM-DD`) for a timestamp in a timezone. */
export function dayKey(tz: string = config.saltRotationTz, now: number = Date.now()): string {
  // en-CA formats as ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Return the salt for the current rotation day, creating (and rotating to) a
 * fresh one on the first call of a new day. Single-process, synchronous
 * better-sqlite3 means no intra-process race here.
 */
export function getDailySalt(
  db: DB,
  tz: string = config.saltRotationTz,
  now: number = Date.now(),
): string {
  const day = dayKey(tz, now);
  const row = db.prepare('SELECT value FROM salt WHERE day = ?').get(day) as
    | { value: string }
    | undefined;
  if (row) return row.value;

  const value = randomBytes(32).toString('hex');
  const rotate = db.transaction(() => {
    db.prepare('DELETE FROM salt').run(); // drop any prior day; keep only today
    db.prepare('INSERT INTO salt (day, value) VALUES (?, ?)').run(day, value);
  });
  rotate();
  return value;
}
