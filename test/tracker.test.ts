import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createApp } from '../src/server.js';
import { makeTestDb, seedSite } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(resolve(root, 'tracker/wisp.js'), 'utf8');
const DIST = resolve(root, 'dist/wisp.js');

interface Send {
  via: 'beacon' | 'fetch';
  url: string;
  body: unknown;
}

interface EnvOpts {
  attrs?: Record<string, string>;
  pathname?: string;
  search?: string;
  host?: string;
  referrer?: string;
  sendBeacon?: boolean;
  preQueue?: unknown[][];
}

type Listener = (...args: unknown[]) => void;

/**
 * Run the tracker source in a vm with stubbed browser globals, returning the
 * captured sends and hooks to simulate events. The stub objects are real JS
 * objects shared with the vm, so wrapped history methods and registered
 * listeners can be invoked from the test afterward.
 */
function run(opts: EnvOpts = {}) {
  const sends: Send[] = [];
  const win: Record<string, Listener[]> = {};
  const doc: Record<string, Listener[]> = {};

  const attrs: Record<string, string> = {
    'data-site': 'blog',
    'data-host': 'http://localhost:3000',
    ...opts.attrs,
  };
  const script = {
    src: 'http://localhost:3000/wisp.js',
    attrs,
    getAttribute(name: string): string | null {
      return name in this.attrs ? (this.attrs[name] ?? null) : null;
    },
  };

  const windowStub: Record<string, unknown> = {
    addEventListener: (type: string, fn: Listener) => {
      (win[type] ??= []).push(fn);
    },
    scrollY: 0,
    innerHeight: 500,
  };
  if (opts.preQueue) {
    const wisp = (() => {}) as unknown as { q: unknown[][] };
    wisp.q = opts.preQueue;
    windowStub.wisp = wisp;
  }

  const env = {
    window: windowStub,
    document: {
      currentScript: script,
      referrer: opts.referrer ?? '',
      documentElement: { scrollHeight: 1000 },
      addEventListener: (type: string, fn: Listener) => {
        (doc[type] ??= []).push(fn);
      },
      getElementsByTagName: () => [script],
    },
    navigator: {
      sendBeacon:
        opts.sendBeacon === false
          ? undefined
          : (url: string, body: string) => {
              sends.push({ via: 'beacon', url, body: JSON.parse(body) });
              return true;
            },
    },
    location: {
      pathname: opts.pathname ?? '/',
      search: opts.search ?? '',
      host: opts.host ?? 'blog.example.com',
    },
    history: {
      pushState: () => {},
      replaceState: () => {},
    } as Record<string, unknown>,
    screen: { width: 1280 },
    fetch: (url: string, init: { body: string }) => {
      sends.push({ via: 'fetch', url, body: JSON.parse(init.body) });
      return Promise.resolve();
    },
    URL,
    JSON,
  };

  vm.runInContext(SRC, vm.createContext(env));

  const fire = (map: Record<string, Listener[]>, type: string, ...args: unknown[]) => {
    for (const fn of map[type] ?? []) fn(...args);
  };

  return {
    sends,
    env,
    popstate: () => fire(win, 'popstate'),
    scroll: () => fire(win, 'scroll'),
    click: (target: unknown) => fire(doc, 'click', { target }),
  };
}

test('sends a pageview on load with path, referrer, width, site', () => {
  const t = run({ pathname: '/about', search: '?x=1', referrer: 'https://news.example' });
  assert.equal(t.sends.length, 1);
  const s = t.sends[0];
  assert.ok(s);
  assert.equal(s.via, 'beacon');
  assert.equal(s.url, 'http://localhost:3000/e');
  assert.deepEqual(s.body, {
    site: 'blog',
    kind: 'pageview',
    name: null,
    path: '/about?x=1',
    referrer: 'https://news.example',
    width: 1280,
    props: null,
  });
});

test('SPA navigation via pushState/replaceState/popstate fires pageviews', () => {
  const t = run();
  assert.equal(t.sends.length, 1); // initial
  (t.env.history.pushState as () => void)();
  (t.env.history.replaceState as () => void)();
  t.popstate();
  assert.equal(t.sends.length, 4);
  assert.ok(t.sends.every((s) => s.via === 'beacon'));
});

test('window.wisp("event", ...) sends a custom event with props', () => {
  const t = run();
  (t.env.window.wisp as (cmd: string, name: string, props: unknown) => void)('event', 'signup', {
    plan: 'pro',
  });
  const ev = t.sends[t.sends.length - 1];
  assert.ok(ev);
  assert.equal(ev.via, 'beacon');
  assert.deepEqual(ev.body, {
    site: 'blog',
    kind: 'event',
    name: 'signup',
    path: '/',
    referrer: null,
    width: 1280,
    props: { plan: 'pro' },
  });
});

test('pre-load queued calls are flushed after load', () => {
  const t = run({ preQueue: [['event', 'early', { a: 1 }]] });
  // initial pageview + the flushed queued event (queue is flushed before the
  // initial pageview, so don't assume ordering — find the event by kind)
  assert.equal(t.sends.length, 2);
  const ev = t.sends.find((s) => (s.body as { kind: string }).kind === 'event');
  assert.ok(ev, 'queued event was flushed');
  assert.equal((ev.body as { name: string }).name, 'early');
  assert.deepEqual((ev.body as { props: unknown }).props, { a: 1 });
});

test('falls back to keepalive fetch when sendBeacon is unavailable', () => {
  const t = run({ sendBeacon: false });
  assert.equal(t.sends.length, 1);
  const s = t.sends[0];
  assert.ok(s);
  assert.equal(s.via, 'fetch');
  assert.equal((s.body as { kind: string }).kind, 'pageview');
});

test('outbound + scroll auto-track fire only when enabled', () => {
  const off = run();
  off.click({ tagName: 'A', host: 'example.com', href: 'https://example.com/', parentNode: null });
  off.env.window.scrollY = 600;
  off.scroll();
  assert.equal(off.sends.length, 1, 'no auto-track events without data-auto');

  const on = run({ attrs: { 'data-auto': 'outboundLinks,scrollDepth' } });
  on.click({ tagName: 'A', host: 'example.com', href: 'https://example.com/', parentNode: null });
  // same-host link should not count as outbound
  on.click({
    tagName: 'A',
    host: 'blog.example.com',
    href: 'https://blog.example.com/x',
    parentNode: null,
  });
  on.env.window.scrollY = 600; // (600 + 500) / 1000 = 1.1 >= 0.9
  on.scroll();
  on.scroll(); // fires at most once

  const events = on.sends.filter((s) => (s.body as { kind: string }).kind === 'event');
  const names = events.map((s) => (s.body as { name: string }).name);
  assert.deepEqual(names, ['outbound', 'scroll']);
});

test('GET /wisp.js serves the bundle with a JS content-type and cache headers', async () => {
  const { db, cleanup } = makeTestDb();
  try {
    seedSite(db);
    const app = createApp(db);
    const res = await app.request('/wisp.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);
    assert.match(res.headers.get('cache-control') ?? '', /max-age/);
    const body = await res.text();
    assert.ok(body.length > 0);
  } finally {
    cleanup();
  }
});

test('built bundle is within budget and dependency-free', () => {
  const code = readFileSync(DIST, 'utf8');
  assert.ok(Buffer.byteLength(code, 'utf8') <= 1500, 'bundle within ~1KB budget');
  assert.doesNotMatch(code, /\b(require|import)\b/, 'no module imports');
});
