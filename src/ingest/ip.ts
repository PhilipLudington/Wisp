import type { Context } from 'hono';

/** Shape of the Node request that `@hono/node-server` exposes on `c.env`. */
interface NodeEnv {
  incoming?: { socket?: { remoteAddress?: string | null } };
}

/**
 * Extract the real client IP.
 *
 * Behind Railway's proxy the originating address is the first hop of
 * `X-Forwarded-For`; we trust it because the app only ever runs behind that
 * proxy. (It's spoofable by a direct caller, but the IP only feeds the daily
 * visitor hash — at worst it shifts dedup, matching the origin-check threat
 * model.) Falls back to the socket address for local/direct connections.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const env = c.env as NodeEnv | undefined;
  return env?.incoming?.socket?.remoteAddress ?? '';
}
