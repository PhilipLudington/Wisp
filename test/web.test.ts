import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { makeTestDb } from './helpers.js';

/**
 * Dashboard serving (Phase 4): the SPA's catch-all must serve the app shell for
 * client routes without shadowing the API, ingest, tracker, or health routes.
 *
 * These assertions hold whether or not the SPA has been built: when `dist/web`
 * exists the shell returns 200 `text/html`; when it doesn't, the handler returns
 * a 503 hint. Either way the response is the dashboard handler's — never a JSON
 * 404 — which is what proves the single-process wiring is in place.
 */

test('SPA catch-all serves the app shell for client routes', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    const app = createApp(db, { adminPassword: '' });

    for (const path of ['/', '/some/client/route']) {
      const res = await app.request(path);
      assert.ok([200, 503].includes(res.status), `${path} → ${res.status}`);
      if (res.status === 200) {
        assert.match(res.headers.get('content-type') ?? '', /text\/html/);
        assert.match(await res.text(), /<div id="root">/);
      } else {
        // Not built in this environment — still the dashboard handler, not a 404.
        assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
      }
    }
  } finally {
    cleanup();
  }
});

test('catch-all does not shadow the API, tracker, or health routes', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    const app = createApp(db, { adminPassword: 'pw' });

    const health = await app.request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    // Auth status route stays JSON, not the shell.
    const me = await app.request('/api/me');
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { authed: false });

    // Guarded read route still 401s rather than falling through to the shell.
    const guarded = await app.request('/api/sites');
    assert.equal(guarded.status, 401);

    // Tracker still served as JavaScript.
    const tracker = await app.request('/wisp.js');
    assert.ok([200, 503].includes(tracker.status));
    if (tracker.status === 200) {
      assert.match(tracker.headers.get('content-type') ?? '', /javascript/);
    }
  } finally {
    cleanup();
  }
});
