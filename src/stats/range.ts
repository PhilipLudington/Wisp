/**
 * Time-range parsing for the stats API.
 *
 * Every time-scoped query takes either a preset (`24h` / `7d` / `30d`) or an
 * explicit custom window (`from`/`to` in unix ms). Ranges are half-open
 * `[from, to)` so adjacent windows never double-count a boundary event.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Preset window lengths, keyed by the `range` query value. */
export const RANGE_PRESETS: Record<string, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};

/** Default preset when no range is supplied. */
export const DEFAULT_RANGE = '7d';

/** Upper bound on a custom range, to keep unbounded scans off the hot path. */
export const MAX_RANGE_MS = 366 * DAY_MS;

export interface Range {
  /** Inclusive start, unix ms. */
  from: number;
  /** Exclusive end, unix ms. */
  to: number;
}

export type RangeResult = { ok: true; value: Range } | { ok: false; error: string };

/**
 * Resolve a `{ range?, from?, to? }` query into a concrete window.
 *
 * A `range` preset wins over `from`/`to`. A custom window requires both bounds
 * as finite numbers, `from < to`, and a span within {@link MAX_RANGE_MS}.
 */
export function parseRange(
  q: { range?: string | undefined; from?: string | undefined; to?: string | undefined },
  now: number = Date.now(),
): RangeResult {
  if (q.range !== undefined) {
    const span = RANGE_PRESETS[q.range];
    if (span === undefined) {
      return { ok: false, error: `unknown range '${q.range}'` };
    }
    return { ok: true, value: { from: now - span, to: now } };
  }

  if (q.from !== undefined || q.to !== undefined) {
    const from = Number(q.from);
    const to = Number(q.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return { ok: false, error: 'from and to must be unix-ms numbers' };
    }
    if (from >= to) return { ok: false, error: 'from must be before to' };
    if (to - from > MAX_RANGE_MS) return { ok: false, error: 'range too large' };
    return { ok: true, value: { from, to } };
  }

  return { ok: true, value: { from: now - (RANGE_PRESETS[DEFAULT_RANGE] ?? 7 * DAY_MS), to: now } };
}
