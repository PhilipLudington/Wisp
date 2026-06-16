import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BODY_BYTES, parseBody, validatePayload } from '../src/ingest/payload.js';

test('valid pageview payload normalizes optionals', () => {
  const r = validatePayload({ site: 'blog', kind: 'pageview', path: '/home', referrer: '' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    site: 'blog',
    kind: 'pageview',
    name: null,
    path: '/home',
    referrer: null, // empty string normalizes to null
    props: null,
  });
});

test('event requires a name', () => {
  const bad = validatePayload({ site: 'blog', kind: 'event' });
  assert.ok(!bad.ok);
  const good = validatePayload({ site: 'blog', kind: 'event', name: 'signup' });
  assert.ok(good.ok);
  assert.equal(good.value.name, 'signup');
});

test('rejects missing site and bad kind', () => {
  assert.ok(!validatePayload({ kind: 'pageview' }).ok);
  assert.ok(!validatePayload({ site: 'blog', kind: 'nope' }).ok);
  assert.ok(!validatePayload('not an object').ok);
});

test('props must be an object and within size', () => {
  assert.ok(!validatePayload({ site: 'blog', kind: 'event', name: 'x', props: [1, 2] }).ok);
  const big = { site: 'blog', kind: 'event', name: 'x', props: { k: 'a'.repeat(3000) } };
  assert.ok(!validatePayload(big).ok);
  const ok = validatePayload({ site: 'blog', kind: 'event', name: 'x', props: { plan: 'pro' } });
  assert.ok(ok.ok);
  assert.equal(ok.value.props, '{"plan":"pro"}');
});

test('width must be a non-negative number when present', () => {
  assert.ok(!validatePayload({ site: 'blog', kind: 'pageview', width: 'wide' }).ok);
  assert.ok(validatePayload({ site: 'blog', kind: 'pageview', width: 1920 }).ok);
});

test('parseBody rejects oversized and invalid JSON', () => {
  const oversized = parseBody('x'.repeat(MAX_BODY_BYTES + 1));
  assert.ok(!oversized.ok);
  assert.ok(!parseBody('{not json').ok);
  assert.ok(parseBody('{"site":"blog","kind":"pageview"}').ok);
});
