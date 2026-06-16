import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSiteConfig, validateSiteConfig } from '../src/sites/config.js';
import { createApp } from '../src/server.js';
import { makeTestDb, seedSite } from './helpers.js';

test('parseSiteConfig returns safe defaults for empty/invalid input', () => {
  assert.deepEqual(parseSiteConfig('{}'), { autoTrack: [], goals: [] });
  assert.deepEqual(parseSiteConfig('not json'), { autoTrack: [], goals: [] });
  assert.deepEqual(parseSiteConfig('[]'), { autoTrack: [], goals: [] });
  assert.deepEqual(parseSiteConfig('null'), { autoTrack: [], goals: [] });
});

test('parseSiteConfig keeps known flags and well-formed goals, drops the rest', () => {
  const cfg = parseSiteConfig(
    JSON.stringify({
      autoTrack: ['outboundLinks', 'bogus', 'scrollDepth'],
      goals: [
        { name: 'Signups', event: 'signup' },
        { name: 'missing event' },
        { event: 'no name' },
        'not an object',
      ],
      extra: 'preserved-only-on-write',
    }),
  );
  assert.deepEqual(cfg.autoTrack, ['outboundLinks', 'scrollDepth']);
  assert.deepEqual(cfg.goals, [{ name: 'Signups', event: 'signup' }]);
});

test('validateSiteConfig accepts valid config and the empty object', () => {
  assert.deepEqual(validateSiteConfig('{}'), []);
  assert.deepEqual(
    validateSiteConfig('{"autoTrack":["scrollDepth"],"goals":[{"name":"S","event":"signup"}]}'),
    [],
  );
  // Unknown top-level keys are allowed through (forward-compat).
  assert.deepEqual(validateSiteConfig('{"funnels":[]}'), []);
});

test('validateSiteConfig reports specific errors for bad input', () => {
  assert.deepEqual(validateSiteConfig('oops'), ['config is not valid JSON']);
  assert.deepEqual(validateSiteConfig('[]'), ['config must be a JSON object']);
  assert.ok(validateSiteConfig('{"autoTrack":"x"}')[0]?.includes('autoTrack must be an array'));
  assert.ok(validateSiteConfig('{"autoTrack":["nope"]}')[0]?.includes('unknown autoTrack flag'));
  assert.ok(validateSiteConfig('{"goals":[{"event":"x"}]}')[0]?.includes('name'));
});

test('GET /api/sites returns normalized config per site', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(
      db,
      'blog',
      ['https://blog.example.com'],
      '{"autoTrack":["outboundLinks","junk"],"goals":[{"name":"Signups","event":"signup"}]}',
    );
    const app = createApp(db, { adminPassword: 'pw' });
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const res = await app.request('/api/sites', { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      sites: { key: string; config: { autoTrack: string[]; goals: unknown[] } }[];
    };
    assert.equal(body.sites.length, 1);
    assert.deepEqual(body.sites[0]!.config, {
      autoTrack: ['outboundLinks'],
      goals: [{ name: 'Signups', event: 'signup' }],
    });
  } finally {
    cleanup();
  }
});
