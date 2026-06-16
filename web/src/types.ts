/** Shapes returned by the Phase 3 stats API, mirrored for the dashboard. */

/** A goal: a label and the custom-event name it counts (see DESIGN §5). */
export interface Goal {
  name: string;
  event: string;
}

/** Normalized per-site config the API returns (see src/sites/config.ts). */
export interface SiteConfig {
  autoTrack: string[];
  goals: Goal[];
}

export interface SiteSummary {
  key: string;
  name: string;
  config: SiteConfig;
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
