import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertEvent } from '../src/ingest/insert.js';
import { resolveSession, SESSION_WINDOW_MS } from '../src/ingest/session.js';
import { makeTestDb, seedSite } from './helpers.js';

function insertAt(
  db: ReturnType<typeof makeTestDb>['db'],
  visitor: string,
  ts: number,
  session: string,
) {
  insertEvent(db, {
    site: 'blog',
    ts,
    kind: 'pageview',
    name: null,
    path: '/',
    referrer: null,
    visitor,
    session,
    device: 'desktop',
    props: null,
  });
}

test('events within the window share a session; beyond it, a new one', () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const t0 = Date.parse('2026-06-16T12:00:00Z');

    // No prior event → fresh session.
    const s1 = resolveSession(db, 'blog', 'visitorA', t0);
    insertAt(db, 'visitorA', t0, s1);

    // 20 minutes later → same session.
    const s2 = resolveSession(db, 'blog', 'visitorA', t0 + 20 * 60 * 1000);
    assert.equal(s2, s1);
    insertAt(db, 'visitorA', t0 + 20 * 60 * 1000, s2);

    // 31 minutes after the last event → new session.
    const last = t0 + 20 * 60 * 1000;
    const s3 = resolveSession(db, 'blog', 'visitorA', last + SESSION_WINDOW_MS + 60 * 1000);
    assert.notEqual(s3, s1);

    // A different visitor never shares a session.
    const sOther = resolveSession(db, 'blog', 'visitorB', t0 + 60 * 1000);
    assert.notEqual(sOther, s1);
  } finally {
    cleanup();
  }
});
