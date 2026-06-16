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

/**
 * Backup destinations, consumed only by `scripts/backup.ts`. All fields are
 * optional: the backup job requires at least one destination (a local `dir`
 * and/or a fully-configured R2 bucket) and validates that at runtime, so the
 * server boots fine with none of these set.
 */
export interface BackupConfig {
  /** Optional local directory to also write each snapshot into. */
  dir: string;
  /** Cloudflare account id; used to build the R2 S3 endpoint. */
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  /** Key prefix within the bucket (e.g. `backups/`). */
  r2Prefix: string;
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
  /** Backup-job settings (see {@link BackupConfig}). */
  backup: BackupConfig;
}

export const config: Config = {
  // Railway (and most PaaS) inject the listen port as `PORT`; honor it when
  // `WISP_PORT` isn't set explicitly so the container needs no extra config.
  port: envInt('WISP_PORT', envInt('PORT', 3000)),
  dbPath: resolve(envStr('WISP_DB_PATH', './data/wisp.db')),
  adminPassword: envStr('WISP_ADMIN_PASSWORD', ''),
  saltRotationTz: envStr('WISP_SALT_ROTATION_TZ', 'UTC'),
  backup: {
    dir: envStr('WISP_BACKUP_DIR', ''),
    r2AccountId: envStr('WISP_BACKUP_R2_ACCOUNT_ID', ''),
    r2AccessKeyId: envStr('WISP_BACKUP_R2_ACCESS_KEY_ID', ''),
    r2SecretAccessKey: envStr('WISP_BACKUP_R2_SECRET_ACCESS_KEY', ''),
    r2Bucket: envStr('WISP_BACKUP_R2_BUCKET', ''),
    r2Prefix: envStr('WISP_BACKUP_R2_PREFIX', 'backups/'),
  },
};
