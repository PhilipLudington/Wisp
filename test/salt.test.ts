import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db/connection.js';
import { dayKey, getDailySalt } from '../src/ingest/salt.js';
import { makeTestDb } from './helpers.js';

const T_DAY1 = Date.parse('2026-06-16T12:00:00Z');
const T_DAY1_LATER = Date.parse('2026-06-16T23:59:00Z');
const T_DAY2 = Date.parse('2026-06-17T00:30:00Z');

test('dayKey formats the rotation day in UTC', () => {
  assert.equal(dayKey('UTC', T_DAY1), '2026-06-16');
  assert.equal(dayKey('UTC', T_DAY2), '2026-06-17');
});

test('salt is stable across calls within a day', () => {
  const { db, cleanup } = makeTestDb();
  try {
    const first = getDailySalt(db, 'UTC', T_DAY1);
    const second = getDailySalt(db, 'UTC', T_DAY1_LATER);
    assert.equal(first, second);
  } finally {
    cleanup();
  }
});

test('salt survives a simulated process restart (reopen)', () => {
  const { db, cleanup, dir } = makeTestDb();
  try {
    const before = getDailySalt(db, 'UTC', T_DAY1);
    db.close();
    // Reopen the same file, as a restart would.
    const db2 = openDb(join(dir, 'test.db'));
    const after = getDailySalt(db2, 'UTC', T_DAY1_LATER);
    assert.equal(after, before);
    db2.close();
  } finally {
    cleanup();
  }
});

test('a new day rotates the salt and keeps only one row', () => {
  const { db, cleanup } = makeTestDb();
  try {
    const day1 = getDailySalt(db, 'UTC', T_DAY1);
    const day2 = getDailySalt(db, 'UTC', T_DAY2);
    assert.notEqual(day1, day2);

    const rows = db.prepare('SELECT day FROM salt').all() as { day: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.day, '2026-06-17');
  } finally {
    cleanup();
  }
});
