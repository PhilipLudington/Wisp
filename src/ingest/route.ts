import type { Context } from 'hono';
import type { DB } from '../db/connection.js';
import { detectBot } from './bots.js';
import { deviceFromUa } from './device.js';
import { buildEventRow, insertEvent } from './insert.js';
import { clientIp } from './ip.js';
import { originAllowed } from './origin.js';
import { parseBody, validatePayload } from './payload.js';
import { getDailySalt } from './salt.js';
import { resolveSession } from './session.js';
import { visitorHash } from './visitor.js';

interface SiteRow {
  key: string;
  domains: string;
}

/**
 * Build the `POST /e` handler — the only write path.
 *
 * Pipeline: validate → resolve site → origin check → bot filter → derive
 * visitor hash (rotating daily salt) → resolve session → derive device →
 * insert. Returns 204 on success and on silently-dropped bot traffic; 4xx for
 * bad input, unknown site, or disallowed origin.
 */
export function handleIngest(db: DB) {
  const selectSite = db.prepare('SELECT key, domains FROM sites WHERE key = ?');

  return async (c: Context): Promise<Response> => {
    const raw = await c.req.text();

    const parsed = parseBody(raw);
    if (!parsed.ok) return c.text(parsed.error, 400);

    const validated = validatePayload(parsed.value);
    if (!validated.ok) return c.text(validated.error, 400);
    const event = validated.value;

    const site = selectSite.get(event.site) as SiteRow | undefined;
    if (!site) return c.text('unknown site', 404);

    if (!originAllowed(c.req.header('origin'), site.domains)) {
      return c.text('origin not allowed', 403);
    }

    const userAgent = c.req.header('user-agent');
    const bot = detectBot(userAgent);
    if (bot.isBot) {
      // Silently accept (204) so bots get no signal; log for audit.
      console.warn(`[ingest] dropped bot: site=${event.site} reason=${bot.reason}`);
      return c.body(null, 204);
    }

    const now = Date.now();
    const ip = clientIp(c);
    const salt = getDailySalt(db);
    const visitor = visitorHash(ip, userAgent ?? '', event.site, salt);
    const session = resolveSession(db, event.site, visitor, now);
    const device = deviceFromUa(userAgent);

    insertEvent(db, buildEventRow(event, { ts: now, visitor, session, device }));

    return c.body(null, 204);
  };
}
