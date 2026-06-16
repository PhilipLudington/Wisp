/**
 * Per-site config — the adaptability layer (DESIGN §5).
 *
 * `sites.config` is a JSON blob that drives behavior on *both* ends without any
 * per-site code:
 *   - `autoTrack`: flags the tracker reads to decide what to auto-instrument.
 *   - `goals`:     a flat list the dashboard turns into one count panel each.
 *
 * This module is the single place that knows the v1 shape. Read paths use
 * {@link parseSiteConfig} (lenient — never throws, drops anything malformed so a
 * bad blob can't break ingestion or the dashboard). Write paths (seed/admin) use
 * {@link validateSiteConfig} to reject bad input before it reaches the DB.
 *
 * The shape is deliberately small but forward-compatible: unknown top-level keys
 * are preserved on write (validation only inspects what it knows), so growing the
 * config — funnels, path goals — is adding fields, not rewriting this. See
 * CONFIG.md for the documented schema and the deferred fields.
 */

/** Auto-track behaviors the tracker understands. Extend here as the tracker grows. */
export const KNOWN_AUTOTRACK = ['outboundLinks', 'scrollDepth'] as const;
export type AutoTrackFlag = (typeof KNOWN_AUTOTRACK)[number];

/** A single goal: a human label and the custom-event name it counts. */
export interface Goal {
  name: string;
  event: string;
}

/** The normalized, consumable config — always present, always well-formed. */
export interface SiteConfig {
  autoTrack: AutoTrackFlag[];
  goals: Goal[];
}

function isKnownFlag(v: unknown): v is AutoTrackFlag {
  return typeof v === 'string' && (KNOWN_AUTOTRACK as readonly string[]).includes(v);
}

/**
 * Normalize a raw config (a JSON string from the DB, or an already-parsed
 * object) into a {@link SiteConfig}. Lenient by design: anything missing or
 * malformed is dropped to a safe default, never thrown. Use on read paths.
 */
export function parseSiteConfig(raw: string | unknown): SiteConfig {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  const o: Record<string, unknown> =
    obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};

  const autoTrack = Array.isArray(o.autoTrack) ? o.autoTrack.filter(isKnownFlag) : [];

  const goals: Goal[] = Array.isArray(o.goals)
    ? o.goals.flatMap((g) => {
        if (!g || typeof g !== 'object') return [];
        const { name, event } = g as Record<string, unknown>;
        if (typeof name !== 'string' || typeof event !== 'string' || !name || !event) return [];
        return [{ name, event }];
      })
    : [];

  return { autoTrack, goals };
}

/**
 * Validate a raw config for a write. Returns a list of human-readable errors
 * (empty when valid). Only the known fields are checked; unknown keys are left
 * alone so the stored blob can carry fields this version doesn't consume yet.
 */
export function validateSiteConfig(raw: string | unknown): string[] {
  const errors: string[] = [];
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return ['config is not valid JSON'];
    }
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return ['config must be a JSON object'];
  }
  const o = obj as Record<string, unknown>;

  if ('autoTrack' in o) {
    if (!Array.isArray(o.autoTrack)) {
      errors.push('autoTrack must be an array of flag strings');
    } else {
      for (const f of o.autoTrack) {
        if (!isKnownFlag(f)) {
          errors.push(
            `unknown autoTrack flag: ${JSON.stringify(f)} (known: ${KNOWN_AUTOTRACK.join(', ')})`,
          );
        }
      }
    }
  }

  if ('goals' in o) {
    if (!Array.isArray(o.goals)) {
      errors.push('goals must be an array');
    } else {
      o.goals.forEach((g, i) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) {
          errors.push(`goals[${i}] must be an object { name, event }`);
          return;
        }
        const { name, event } = g as Record<string, unknown>;
        if (typeof name !== 'string' || !name)
          errors.push(`goals[${i}].name must be a non-empty string`);
        if (typeof event !== 'string' || !event)
          errors.push(`goals[${i}].event must be a non-empty string`);
      });
    }
  }

  return errors;
}
