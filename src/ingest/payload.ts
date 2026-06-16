/**
 * Ingest payload parsing and validation.
 *
 * The tracker (`wisp.js`) sends a small JSON body to `POST /e`. This module
 * turns the raw request body into a validated, normalized event or an error,
 * enforcing shape, types, and size limits. Optional fields are normalized to
 * `null` so the rest of the pipeline (and the DB insert) sees a uniform shape.
 */

/** Hard cap on the raw request body, in bytes. */
export const MAX_BODY_BYTES = 4096;

const MAX_PATH = 2048;
const MAX_REFERRER = 2048;
const MAX_NAME = 200;
const MAX_SITE = 64;
const MAX_PROPS_BYTES = 2048;
const MAX_WIDTH = 100_000;

/** The wire shape sent by the tracker. */
export interface IngestPayload {
  /** Site key (`data-site`). */
  site: string;
  /** Event kind. */
  kind: 'pageview' | 'event';
  /** Custom-event name (required when `kind === 'event'`). */
  name?: string;
  /** URL path of the page. */
  path?: string;
  /** Document referrer. */
  referrer?: string;
  /** Screen width in CSS pixels (collected but not stored in v1). */
  width?: number;
  /** Custom event properties. */
  props?: Record<string, unknown>;
}

/**
 * A validated event, normalized for storage: every optional field is present
 * as either its value or `null`. `width` is accepted for forward-compatibility
 * but not persisted (no column in the v1 schema).
 */
export interface ValidatedEvent {
  site: string;
  kind: 'pageview' | 'event';
  name: string | null;
  path: string | null;
  referrer: string | null;
  props: string | null;
}

export type ValidationResult = { ok: true; value: ValidatedEvent } | { ok: false; error: string };

function fail(error: string): ValidationResult {
  return { ok: false, error };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function trimmedString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '' || s.length > max) return null;
  return s;
}

/**
 * Validate and normalize a parsed JSON body. The body must already be a parsed
 * value (see {@link parseBody}); this function never throws.
 */
export function validatePayload(body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail('body must be a JSON object');

  const site = trimmedString(body.site, MAX_SITE);
  if (site === null) return fail('site is required');

  if (body.kind !== 'pageview' && body.kind !== 'event') {
    return fail("kind must be 'pageview' or 'event'");
  }
  const kind = body.kind;

  let name: string | null = null;
  if (kind === 'event') {
    name = trimmedString(body.name, MAX_NAME);
    if (name === null) return fail('name is required for event kind');
  }

  // path/referrer are optional and best-effort: invalid/oversized values are
  // dropped to null rather than rejecting the whole event.
  const path = body.path === undefined ? null : trimmedString(body.path, MAX_PATH);
  const referrer = body.referrer === undefined ? null : trimmedString(body.referrer, MAX_REFERRER);

  if (body.width !== undefined) {
    const w = body.width;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > MAX_WIDTH) {
      return fail('width must be a non-negative number');
    }
  }

  let props: string | null = null;
  if (body.props !== undefined) {
    if (!isPlainObject(body.props)) return fail('props must be an object');
    const serialized = JSON.stringify(body.props);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PROPS_BYTES) {
      return fail('props too large');
    }
    props = serialized;
  }

  return { ok: true, value: { site, kind, name, path, referrer, props } };
}

/**
 * Parse a raw request body string into JSON, enforcing the byte-size cap.
 * Returns the parsed value, or an error string for oversized/invalid bodies.
 */
export function parseBody(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, error: 'payload too large' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}
