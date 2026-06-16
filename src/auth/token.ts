import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Single-password authentication primitives.
 *
 * There is one user (the operator). On login we hand out a signed, expiring
 * token stored in an HttpOnly cookie; the read API verifies it on every
 * request. The signing key is derived from the admin password itself, so the
 * token survives restarts without a separate secret env var, and changing the
 * password invalidates every outstanding token for free.
 */

/** Cookie name carrying the auth token. */
export const AUTH_COOKIE = 'wisp_auth';

/** How long an issued token stays valid. */
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Derive a stable 32-byte signing key from the admin password. */
function signingKey(password: string): Buffer {
  return createHmac('sha256', 'wisp-auth-v1').update(password).digest();
}

/** Constant-time string equality (length differences short-circuit safely). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Check a submitted password against the configured one in constant time. */
export function checkPassword(input: unknown, password: string): boolean {
  if (typeof input !== 'string') return false;
  return safeEqual(input, password);
}

/** Issue a `<expiryMs>.<hmac>` token valid for {@link TOKEN_TTL_MS}. */
export function issueToken(password: string, now: number = Date.now()): string {
  const exp = String(now + TOKEN_TTL_MS);
  const sig = createHmac('sha256', signingKey(password)).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

/** Verify a token's signature and expiry against the current password. */
export function verifyToken(
  token: string | undefined,
  password: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;

  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN <= now) return false;

  const expected = createHmac('sha256', signingKey(password)).update(exp).digest('hex');
  return safeEqual(sig, expected);
}
