/** Shapes returned by the Phase 3 stats API, mirrored for the dashboard. */

export interface SiteSummary {
  key: string;
  name: string;
  config: Record<string, unknown>;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface LabelCount {
  label: string;
  count: number;
}

export interface PageviewsResponse {
  series: DayCount[];
  total: number;
}

/** Preset windows the API understands directly. */
export type RangePreset = '24h' | '7d' | '30d';

/**
 * A selected time window: either a preset (the API resolves it) or an explicit
 * custom `[from, to)` in unix-ms. Mirrors the collector's `parseRange` inputs.
 */
export type Range =
  | { kind: 'preset'; preset: RangePreset }
  | { kind: 'custom'; from: number; to: number };
