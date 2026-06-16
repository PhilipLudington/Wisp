import { createHash } from 'node:crypto';

/**
 * Derive the cookieless visitor id: `sha256(ip | user_agent | site | salt)`.
 *
 * The raw IP and user-agent are passed in only to be hashed here and are never
 * stored. Because the salt rotates daily, the same person produces a different
 * hash each day — unique visitors are inherently per-day (see DESIGN).
 */
export function visitorHash(ip: string, userAgent: string, site: string, salt: string): string {
  return createHash('sha256').update(`${ip}|${userAgent}|${site}|${salt}`).digest('hex');
}
