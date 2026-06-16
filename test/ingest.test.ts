import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/server.js';
import { DESKTOP_UA, makeTestDb, seedSite } from './helpers.js';

const ORIGIN = 'https://blog.example.com';

async function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request('/e', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'user-agent': DESKTOP_UA,
      'x-forwarded-for': '1.2.3.4',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function countEvents(db: ReturnType<typeof makeTestDb>['db']): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

test('valid payload inserts exactly one event with correct fields', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    const res = await post(app, {
      site: 'blog',
      kind: 'pageview',
      path: '/about',
      referrer: 'https://news.example',
    });
    assert.equal(res.status, 204);
    assert.equal(countEvents(db), 1);

    const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>;
    assert.equal(row.site, 'blog');
    assert.equal(row.kind, 'pageview');
    assert.equal(row.path, '/about');
    assert.equal(row.referrer, 'https://news.example');
    assert.equal(row.device, 'desktop');
    assert.match(String(row.visitor), /^[0-9a-f]{64}$/);
    assert.ok(row.session);
  } finally {
    cleanup();
  }
});

test('custom event stores name and props', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    const res = await post(app, {
      site: 'blog',
      kind: 'event',
      name: 'signup',
      props: { plan: 'pro' },
    });
    assert.equal(res.status, 204);
    const row = db.prepare("SELECT name, kind, props FROM events WHERE kind = 'event'").get() as {
      name: string;
      kind: string;
      props: string;
    };
    assert.equal(row.name, 'signup');
    assert.equal(row.props, '{"plan":"pro"}');
  } finally {
    cleanup();
  }
});

test('same visitor within 30 min shares a session', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    await post(app, { site: 'blog', kind: 'pageview', path: '/' });
    await post(app, { site: 'blog', kind: 'pageview', path: '/next' });

    const sessions = db.prepare('SELECT DISTINCT session FROM events').all();
    assert.equal(sessions.length, 1);

    const visitors = db.prepare('SELECT DISTINCT visitor FROM events').all();
    assert.equal(visitors.length, 1); // same ip/ua/site/day → same hash
  } finally {
    cleanup();
  }
});

test('malformed and oversized payloads return 400 without inserting', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    assert.equal((await post(app, '{not json')).status, 400);
    assert.equal((await post(app, 'x'.repeat(5000))).status, 400);
    assert.equal((await post(app, { kind: 'pageview' })).status, 400); // missing site
    assert.equal(countEvents(db), 0);
  } finally {
    cleanup();
  }
});

test('unknown site returns 404', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    const res = await post(app, { site: 'ghost', kind: 'pageview' });
    assert.equal(res.status, 404);
    assert.equal(countEvents(db), 0);
  } finally {
    cleanup();
  }
});

test('disallowed origin is rejected with 403', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    const res = await post(
      app,
      { site: 'blog', kind: 'pageview' },
      { origin: 'https://evil.example' },
    );
    assert.equal(res.status, 403);
    assert.equal(countEvents(db), 0);
  } finally {
    cleanup();
  }
});

test('bot user-agents are dropped silently (204, no insert)', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    const res = await post(
      app,
      { site: 'blog', kind: 'pageview' },
      { 'user-agent': 'Googlebot/2.1' },
    );
    assert.equal(res.status, 204);
    assert.equal(countEvents(db), 0);
  } finally {
    cleanup();
  }
});
