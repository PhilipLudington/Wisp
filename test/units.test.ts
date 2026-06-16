import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectBot } from '../src/ingest/bots.js';
import { deviceFromUa } from '../src/ingest/device.js';
import { originAllowed } from '../src/ingest/origin.js';
import { visitorHash } from '../src/ingest/visitor.js';
import { DESKTOP_UA } from './helpers.js';

test('visitor hash is deterministic and salt-sensitive', () => {
  const a = visitorHash('1.2.3.4', DESKTOP_UA, 'blog', 'salt-day-1');
  const b = visitorHash('1.2.3.4', DESKTOP_UA, 'blog', 'salt-day-1');
  const c = visitorHash('1.2.3.4', DESKTOP_UA, 'blog', 'salt-day-2');
  assert.equal(a, b); // same inputs → same hash (within a day)
  assert.notEqual(a, c); // different daily salt → different hash
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('bot detection', () => {
  assert.ok(detectBot(undefined).isBot);
  assert.ok(detectBot('').isBot);
  assert.ok(detectBot('Googlebot/2.1 (+http://www.google.com/bot.html)').isBot);
  assert.ok(detectBot('curl/8.4.0').isBot);
  assert.ok(detectBot('Mozilla/5.0 ... HeadlessChrome/120.0').isBot);
  assert.ok(detectBot('SomeRandomScraper/1.0').isBot); // no "Mozilla"
  assert.ok(!detectBot(DESKTOP_UA).isBot);
});

test('device classification', () => {
  assert.equal(deviceFromUa(DESKTOP_UA), 'desktop');
  assert.equal(
    deviceFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'),
    'mobile',
  );
  assert.equal(
    deviceFromUa(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    ),
    'mobile',
  );
  assert.equal(
    deviceFromUa('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1 Safari/604.1'),
    'tablet',
  );
  assert.equal(deviceFromUa(undefined), 'desktop');
});

test('origin allowlist', () => {
  const domains = JSON.stringify(['https://blog.example.com', 'http://localhost:5173']);
  assert.ok(originAllowed('https://blog.example.com', domains));
  assert.ok(originAllowed('https://blog.example.com/', domains)); // trailing slash tolerated
  assert.ok(originAllowed('http://localhost:5173', domains));
  assert.ok(!originAllowed('https://evil.example.com', domains));
  assert.ok(!originAllowed(undefined, domains));
  assert.ok(!originAllowed('https://blog.example.com', 'not json'));
});
