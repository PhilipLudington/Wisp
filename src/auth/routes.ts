import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { AUTH_COOKIE, TOKEN_TTL_MS, checkPassword, issueToken, verifyToken } from './token.js';

/**
 * Auth routes and the middleware that guards the read API.
 *
 * `POST /api/login` exchanges the admin password for a signed cookie;
 * `POST /api/logout` clears it; `GET /api/me` reports auth status without
 * gating. {@link requireAuth} rejects everything else under `/api` with 401
 * unless a valid cookie is present.
 */

/** Build a middleware that 401s unless the request carries a valid auth cookie. */
export function requireAuth(password: string): MiddlewareHandler {
  return async (c, next) => {
    if (!verifyToken(getCookie(c, AUTH_COOKIE), password)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  };
}

function setAuthCookie(c: Context, password: string): void {
  setCookie(c, AUTH_COOKIE, issueToken(password), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(TOKEN_TTL_MS / 1000),
    // Only mark Secure when the edge terminated TLS, so dev over http still works.
    secure: c.req.header('x-forwarded-proto') === 'https',
  });
}

/** Mount login/logout/me on the app. Returns nothing; mutates `app`. */
export function registerAuth(app: Hono, password: string): void {
  app.post('/api/login', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const submitted = (body as { password?: unknown } | null)?.password;
    if (!checkPassword(submitted, password)) {
      return c.json({ error: 'invalid password' }, 401);
    }
    setAuthCookie(c, password);
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, AUTH_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/me', (c) => {
    const authed = verifyToken(getCookie(c, AUTH_COOKIE), password);
    return c.json({ authed });
  });
}
