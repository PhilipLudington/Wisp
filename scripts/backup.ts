import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { putObject } from './r2.js';

/**
 * Nightly backup: snapshot the live SQLite DB with `VACUUM INTO` and ship the
 * single compacted file to one or more destinations.
 *
 * `VACUUM INTO` writes a fresh, defragmented database with no WAL sidecar —
 * a consistent point-in-time copy taken without stopping the server (WAL mode
 * lets it read while the server keeps writing). The snapshot is uploaded to
 * Cloudflare R2 and/or copied to a local directory; at least one destination
 * must be configured. Restore is a download + file swap (see BACKUP.md).
 *
 * Usage:
 *   npm run backup
 *
 * Destinations (env, via src/config.ts):
 *   WISP_BACKUP_DIR                 local directory to copy the snapshot into
 *   WISP_BACKUP_R2_ACCOUNT_ID       Cloudflare account id (R2 endpoint)
 *   WISP_BACKUP_R2_ACCESS_KEY_ID    R2 API token access key
 *   WISP_BACKUP_R2_SECRET_ACCESS_KEY R2 API token secret
 *   WISP_BACKUP_R2_BUCKET           target bucket
 *   WISP_BACKUP_R2_PREFIX           key prefix (default "backups/")
 */

function snapshotName(now: Date): string {
  // wisp-20060102T150405Z.db — sorts chronologically, safe as an object key.
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return `wisp-${stamp}.db`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function main(): Promise<void> {
  const { backup } = config;

  const r2Configured =
    backup.r2AccountId &&
    backup.r2AccessKeyId &&
    backup.r2SecretAccessKey &&
    backup.r2Bucket;
  const localConfigured = backup.dir !== '';

  // Partial R2 config is almost certainly a misconfiguration — fail loudly with
  // a specific message rather than the generic "no destination" one below.
  const anyR2 =
    backup.r2AccountId ||
    backup.r2AccessKeyId ||
    backup.r2SecretAccessKey ||
    backup.r2Bucket;
  if (anyR2 && !r2Configured) {
    console.error(
      'Incomplete R2 config: set ALL of WISP_BACKUP_R2_ACCOUNT_ID,\n' +
        'WISP_BACKUP_R2_ACCESS_KEY_ID, WISP_BACKUP_R2_SECRET_ACCESS_KEY,\n' +
        'and WISP_BACKUP_R2_BUCKET (or none).',
    );
    process.exit(1);
  }

  if (!r2Configured && !localConfigured) {
    console.error(
      'No backup destination configured. Set WISP_BACKUP_DIR and/or the\n' +
        'WISP_BACKUP_R2_* variables (see BACKUP.md).',
    );
    process.exit(1);
  }

  const now = new Date();
  const name = snapshotName(now);
  const snapshotPath = join(tmpdir(), name);

  // `VACUUM INTO` requires the target not to exist; tmpdir is per-run unique by
  // timestamp, but clear any stale file defensively.
  rmSync(snapshotPath, { force: true });

  console.log(`Snapshotting ${config.dbPath} -> ${snapshotPath}`);
  const db = openDb(config.dbPath);
  try {
    // Bind the path as a parameter so quoting/escaping is handled for us.
    db.prepare('VACUUM INTO ?').run(snapshotPath);
  } finally {
    db.close();
  }

  const size = statSync(snapshotPath).size;
  console.log(`Snapshot created: ${name} (${humanSize(size)})`);

  try {
    if (localConfigured) {
      const dir = resolve(backup.dir);
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, name);
      copyFileSync(snapshotPath, dest);
      console.log(`Copied to local backup dir: ${dest}`);
    }

    if (r2Configured) {
      const key = `${backup.r2Prefix}${name}`;
      const body = readFileSync(snapshotPath);
      console.log(`Uploading to R2: ${backup.r2Bucket}/${key}`);
      await putObject(
        {
          accountId: backup.r2AccountId,
          accessKeyId: backup.r2AccessKeyId,
          secretAccessKey: backup.r2SecretAccessKey,
          bucket: backup.r2Bucket,
        },
        key,
        body,
        'application/x-sqlite3',
        now,
      );
      console.log(`Uploaded to R2: ${backup.r2Bucket}/${key}`);
    }
  } finally {
    // The local temp snapshot is always disposable once destinations are written.
    rmSync(snapshotPath, { force: true });
  }

  console.log('Backup complete.');
}

main().catch((err) => {
  console.error('Backup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
