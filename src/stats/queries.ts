import type { DB } from '../db/connection.js';
import type { Range } from './range.js';

/**
 * Read-side stat queries — every dashboard panel's data, computed on read with
 * `GROUP BY` over the `events` table.
 *
 * All time-scoped queries filter `site = ? AND ts >= ? AND ts < ?`, which is
 * served by `idx_events_site_ts(site, ts)`. Day buckets use UTC (`unixepoch`),
 * matching the default salt-rotation timezone, so each daily unique-visitor
 * count lines up with the day its salt covers.
 */

/** Default number of rows returned by the "top N" lists. */
export const TOP_LIMIT = 10;

/** Current-visitors lookback window. */
export const CURRENT_WINDOW_MS = 5 * 60 * 1000;

const DAY_BUCKET = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch')";

export interface DayCount {
  day: string;
  count: number;
}

export interface LabelCount {
  label: string;
  count: number;
}

/**
 * Pageviews per UTC day plus a range total. Pageviews sum cleanly across days,
 * so the total is meaningful (unlike unique visitors).
 */
export function pageviews(
  db: DB,
  site: string,
  range: Range,
): { series: DayCount[]; total: number } {
  const series = db
    .prepare(
      `SELECT ${DAY_BUCKET} AS day, COUNT(*) AS count
       FROM events
       WHERE site = ? AND kind = 'pageview' AND ts >= ? AND ts < ?
       GROUP BY day ORDER BY day`,
    )
    .all(site, range.from, range.to) as DayCount[];

  const total = series.reduce((sum, row) => sum + row.count, 0);
  return { series, total };
}

/**
 * Unique visitors per UTC day — a series only, deliberately with no range
 * total. The salt rotates daily, so a visitor gets a fresh hash each day and a
 * cross-day "distinct visitors" number can't be derived (and would mislead).
 */
export function uniqueVisitors(db: DB, site: string, range: Range): DayCount[] {
  return db
    .prepare(
      `SELECT ${DAY_BUCKET} AS day, COUNT(DISTINCT visitor) AS count
       FROM events
       WHERE site = ? AND ts >= ? AND ts < ?
       GROUP BY day ORDER BY day`,
    )
    .all(site, range.from, range.to) as DayCount[];
}

/** Top pages by pageview count. */
export function topPages(db: DB, site: string, range: Range, limit = TOP_LIMIT): LabelCount[] {
  return db
    .prepare(
      `SELECT path AS label, COUNT(*) AS count
       FROM events
       WHERE site = ? AND kind = 'pageview' AND ts >= ? AND ts < ? AND path IS NOT NULL
       GROUP BY path ORDER BY count DESC, label LIMIT ?`,
    )
    .all(site, range.from, range.to, limit) as LabelCount[];
}

/** Top referrers/sources by pageview count; missing referrers bucket as `(direct)`. */
export function topReferrers(db: DB, site: string, range: Range, limit = TOP_LIMIT): LabelCount[] {
  return db
    .prepare(
      `SELECT COALESCE(referrer, '(direct)') AS label, COUNT(*) AS count
       FROM events
       WHERE site = ? AND kind = 'pageview' AND ts >= ? AND ts < ?
       GROUP BY label ORDER BY count DESC, label LIMIT ?`,
    )
    .all(site, range.from, range.to, limit) as LabelCount[];
}

/** Device breakdown by pageview count. */
export function deviceBreakdown(db: DB, site: string, range: Range): LabelCount[] {
  return db
    .prepare(
      `SELECT COALESCE(device, 'unknown') AS label, COUNT(*) AS count
       FROM events
       WHERE site = ? AND kind = 'pageview' AND ts >= ? AND ts < ?
       GROUP BY label ORDER BY count DESC, label`,
    )
    .all(site, range.from, range.to) as LabelCount[];
}

/** Custom events with counts, in the range. */
export function customEvents(db: DB, site: string, range: Range): LabelCount[] {
  return db
    .prepare(
      `SELECT name AS label, COUNT(*) AS count
       FROM events
       WHERE site = ? AND kind = 'event' AND ts >= ? AND ts < ? AND name IS NOT NULL
       GROUP BY name ORDER BY count DESC, label`,
    )
    .all(site, range.from, range.to) as LabelCount[];
}

/** Distinct visitors seen in the last {@link CURRENT_WINDOW_MS}. */
export function currentVisitors(db: DB, site: string, now: number = Date.now()): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT visitor) AS count
       FROM events WHERE site = ? AND ts >= ?`,
    )
    .get(site, now - CURRENT_WINDOW_MS) as { count: number };
  return row.count;
}
