import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DB } from '../src/db/connection.js';
import {
  currentVisitors,
  customEvents,
  deviceBreakdown,
  pageviews,
  topPages,
  topReferrers,
  uniqueVisitors,
} from '../src/stats/queries.js';
import { MAX_RANGE_MS, parseRange } from '../src/stats/range.js';
import { createApp } from '../src/server.js';
import { makeTestDb, seedSite } from './helpers.js';

const DAY9 = Date.UTC(2026, 5, 9, 0); // 2026-06-09 00:00 UTC
const DAY10 = Date.UTC(2026, 5, 10, 0);
const DAY11 = Date.UTC(2026, 5, 11, 0);
const RANGE = { from: DAY9, to: DAY11 };

interface Ev {
  ts: number;
  kind?: 'pageview' | 'event';
  name?: string | null;
  path?: string | null;
  referrer?: string | null;
  visitor?: string;
  device?: string | null;
  site?: string;
}

function insert(db: DB, e: Ev): void {
  db.prepare(
    `INSERT INTO events (site, ts, kind, name, path, referrer, visitor, session, device, props)
     VALUES (@site, @ts, @kind, @name, @path, @referrer, @visitor, @session, @device, @props)`,
  ).run({
    site: e.site ?? 'blog',
    ts: e.ts,
    kind: e.kind ?? 'pageview',
    name: e.name ?? null,
    path: e.path ?? null,
    referrer: e.referrer ?? null,
    visitor: e.visitor ?? 'v1',
    session: 's1',
    device: e.device ?? null,
    props: null,
  });
}

/** A fixed fixture spanning two UTC days. */
function seedEvents(db: DB): void {
  seedSite(db);
  insert(db, {
    ts: DAY9 + 10 * 3600_000,
    path: '/a',
    referrer: null,
    device: 'desktop',
    visitor: 'v1',
  });
  insert(db, {
    ts: DAY9 + 11 * 3600_000,
    path: '/a',
    referrer: 'https://x',
    device: 'desktop',
    visitor: 'v1',
  });
  insert(db, {
    ts: DAY9 + 12 * 3600_000,
    path: '/b',
    referrer: 'https://x',
    device: 'mobile',
    visitor: 'v2',
  });
  insert(db, {
    ts: DAY10 + 9 * 3600_000,
    path: '/a',
    referrer: null,
    device: 'desktop',
    visitor: 'v1',
  });
  insert(db, {
    ts: DAY10 + 10 * 3600_000,
    kind: 'event',
    name: 'signup',
    visitor: 'v2',
    device: 'desktop',
  });
  insert(db, {
    ts: DAY10 + 11 * 3600_000,
    kind: 'event',
    name: 'signup',
    visitor: 'v3',
    device: 'desktop',
  });
}

test('pageviews: per-day series and a summed range total', () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedEvents(db);
    const { series, total } = pageviews(db, 'blog', RANGE);
    assert.equal(total, 4);
    assert.deepEqual(series, [
      { day: '2026-06-09', count: 3 },
      { day: '2026-06-10', count: 1 },
    ]);
  } finally {
    cleanup();
  }
});

test('uniqueVisitors: distinct per day, no total', () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedEvents(db);
    assert.deepEqual(uniqueVisitors(db, 'blog', RANGE), [
      { day: '2026-06-09', count: 2 }, // v1, v2
      { day: '2026-06-10', count: 3 }, // v1, v2, v3 (events count too)
    ]);
  } finally {
    cleanup();
  }
});

test('topPages / topReferrers / devices / customEvents match hand counts', () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedEvents(db);
    assert.deepEqual(topPages(db, 'blog', RANGE), [
      { label: '/a', count: 3 },
      { label: '/b', count: 1 },
    ]);
    assert.deepEqual(topReferrers(db, 'blog', RANGE), [
      { label: '(direct)', count: 2 },
      { label: 'https://x', count: 2 },
    ]);
    assert.deepEqual(deviceBreakdown(db, 'blog', RANGE), [
      { label: 'desktop', count: 3 },
      { label: 'mobile', count: 1 },
    ]);
    assert.deepEqual(customEvents(db, 'blog', RANGE), [{ label: 'signup', count: 2 }]);
  } finally {
    cleanup();
  }
});

test('currentVisitors counts only the last 5 minutes', () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const now = Date.UTC(2026, 5, 16, 12, 0, 0);
    insert(db, { ts: now - 60_000, visitor: 'a' }); // 1 min ago
    insert(db, { ts: now - 2 * 60_000, visitor: 'b' }); // 2 min ago
    insert(db, { ts: now - 10 * 60_000, visitor: 'c' }); // 10 min ago — excluded
    assert.equal(currentVisitors(db, 'blog', now), 2);
  } finally {
    cleanup();
  }
});

test('parseRange: presets, default, custom bounds, and rejections', () => {
  const now = 1_000_000_000_000;
  assert.deepEqual(parseRange({ range: '24h' }, now), {
    ok: true,
    value: { from: now - 86_400_000, to: now },
  });
  // Default is 7d when nothing supplied.
  const def = parseRange({}, now);
  assert.ok(def.ok && def.value.to - def.value.from === 7 * 86_400_000);

  const custom = parseRange({ from: '100', to: '200' }, now);
  assert.deepEqual(custom, { ok: true, value: { from: 100, to: 200 } });

  assert.equal(parseRange({ range: 'bogus' }, now).ok, false);
  assert.equal(parseRange({ from: '200', to: '100' }, now).ok, false);
  assert.equal(parseRange({ from: 'x', to: '100' }, now).ok, false);
  assert.equal(parseRange({ from: '0', to: String(MAX_RANGE_MS + 1) }, now).ok, false);
});

test('time-scoped queries use idx_events_site_ts (no full scan)', () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedEvents(db);
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT COUNT(*) FROM events
         WHERE site = ? AND kind = 'pageview' AND ts >= ? AND ts < ?`,
      )
      .all('blog', RANGE.from, RANGE.to);
    const text = JSON.stringify(plan);
    assert.match(text, /idx_events_site_ts/);
    assert.doesNotMatch(text, /SCAN events\b(?!.*USING)/);
  } finally {
    cleanup();
  }
});

test('stats endpoints: 404 unknown site, 400 bad range, 200 with data', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedEvents(db);
    // Empty password: login with '' to obtain a cookie, exercising the real gate.
    const app = createApp(db, { adminPassword: '' });
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: '' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const notFound = await app.request('/api/sites/ghost/pageviews', { headers: { cookie } });
    assert.equal(notFound.status, 404);

    const badRange = await app.request('/api/sites/blog/pageviews?range=bogus', {
      headers: { cookie },
    });
    assert.equal(badRange.status, 400);

    const ok = await app.request(`/api/sites/blog/pageviews?from=${RANGE.from}&to=${RANGE.to}`, {
      headers: { cookie },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      series: [
        { day: '2026-06-09', count: 3 },
        { day: '2026-06-10', count: 1 },
      ],
      total: 4,
    });
  } finally {
    cleanup();
  }
});
