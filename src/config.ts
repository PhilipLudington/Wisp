import { resolve } from 'node:path';

/**
 * Centralized runtime configuration, sourced from environment variables.
 *
 * Every tunable that differs between local dev and the Railway deployment lives
 * here so the rest of the code never reads `process.env` directly.
 */

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${v}`);
  }
  return n;
}

export interface Config {
  /** TCP port the Hono server listens on. */
  port: number;
  /** Absolute path to the SQLite database file (created if absent). */
  dbPath: string;
  /** Single-user dashboard password. Empty in dev; must be set in production. */
  adminPassword: string;
  /**
   * IANA timezone whose calendar day defines the salt-rotation boundary.
   * Defaults to UTC, matching the design (per-day visitor hashes roll at UTC midnight).
   */
  saltRotationTz: string;
}

export const config: Config = {
  port: envInt('WISP_PORT', 3000),
  dbPath: resolve(envStr('WISP_DB_PATH', './data/wisp.db')),
  adminPassword: envStr('WISP_ADMIN_PASSWORD', ''),
  saltRotationTz: envStr('WISP_SALT_ROTATION_TZ', 'UTC'),
};
