import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.js';

/** Sliding session window: events within this gap belong to the same session. */
export const SESSION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Resolve the session id for a visitor's new event (a read-then-write).
 *
 * Look up the visitor's most recent event for the site (served by
 * `idx_events_visitor`); if it falls within the 30-minute sliding window, reuse
 * its session, otherwise mint a new one. A session that straddles the salt
 * rotation boundary is naturally split because the visitor hash changes — an
 * accepted artifact of the cookieless model.
 */
export function resolveSession(
  db: DB,
  site: string,
  visitor: string,
  now: number = Date.now(),
  windowMs: number = SESSION_WINDOW_MS,
): string {
  const last = db
    .prepare(
      'SELECT session, ts FROM events WHERE site = ? AND visitor = ? ORDER BY ts DESC LIMIT 1',
    )
    .get(site, visitor) as { session: string; ts: number } | undefined;

  if (last && now - last.ts <= windowMs) return last.session;
  return randomUUID();
}
