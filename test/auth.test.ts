import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { checkPassword, issueToken, verifyToken } from '../src/auth/token.js';
import { makeTestDb, seedSite } from './helpers.js';

const PASSWORD = 'hunter2';

test('issued token verifies; wrong password, expiry, and tampering fail', () => {
  const now = 1_700_000_000_000;
  const token = issueToken(PASSWORD, now);

  assert.equal(verifyToken(token, PASSWORD, now + 1000), true);
  assert.equal(verifyToken(token, 'wrong', now + 1000), false);
  assert.equal(verifyToken(token, PASSWORD, now + 8 * 24 * 60 * 60 * 1000), false); // expired
  assert.equal(verifyToken(token + 'x', PASSWORD, now + 1000), false); // tampered sig
  assert.equal(verifyToken(undefined, PASSWORD, now), false);
  assert.equal(verifyToken('garbage', PASSWORD, now), false);
});

test('checkPassword is exact and rejects non-strings', () => {
  assert.equal(checkPassword('hunter2', PASSWORD), true);
  assert.equal(checkPassword('hunter', PASSWORD), false);
  assert.equal(checkPassword(undefined, PASSWORD), false);
  assert.equal(checkPassword(42, PASSWORD), false);
});

/** Extract a cookie header value from a login response's Set-Cookie. */
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'expected Set-Cookie');
  return setCookie.split(';')[0] ?? '';
}

test('read routes are gated: 401 without auth, 200 after login', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db, { adminPassword: PASSWORD });

    // No cookie → rejected.
    const denied = await app.request('/api/sites/blog/pageviews');
    assert.equal(denied.status, 401);

    // Wrong password → 401, no cookie.
    const badLogin = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(badLogin.status, 401);

    // Correct password → 200 + cookie.
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);

    const ok = await app.request('/api/sites/blog/pageviews', { headers: { cookie } });
    assert.equal(ok.status, 200);

    // /api/me reflects auth state.
    const me = await app.request('/api/me', { headers: { cookie } });
    assert.deepEqual(await me.json(), { authed: true });
    const anon = await app.request('/api/me');
    assert.deepEqual(await anon.json(), { authed: false });
  } finally {
    cleanup();
  }
});
