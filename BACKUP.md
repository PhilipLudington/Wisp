# Wisp — Backups & Restore

Wisp stores everything in one SQLite file on a Railway persistent volume. The
backup strategy follows from that: take a consistent single-file snapshot every
night and ship it offsite to Cloudflare R2. Restoring is a download and a file
swap.

- **Snapshot:** `VACUUM INTO` writes a fresh, defragmented copy of the database
  with no `-wal`/`-shm` sidecar. It runs against the live DB without stopping the
  server — WAL mode lets the snapshot read a consistent point-in-time view while
  ingestion keeps writing.
- **Destinations:** Cloudflare R2 (offsite, primary) and/or a local directory
  (handy for testing or a second on-volume copy). At least one is required.
- **Naming:** `wisp-<UTC timestamp>.db`, e.g. `wisp-20260616T213559Z.db` — sorts
  chronologically, so "latest" is the last key.

The script is [`scripts/backup.ts`](./scripts/backup.ts); R2 uploads use a
dependency-free AWS Signature V4 `PUT` ([`scripts/r2.ts`](./scripts/r2.ts)).

## Configuration

All settings are environment variables, centralized in
[`src/config.ts`](./src/config.ts):

| Variable | Required | Description |
|----------|----------|-------------|
| `WISP_DB_PATH` | yes | Path to the live DB (same value the server uses, e.g. `/data/wisp.db`). |
| `WISP_BACKUP_R2_ACCOUNT_ID` | for R2 | Cloudflare account id; forms the endpoint `https://<id>.r2.cloudflarestorage.com`. |
| `WISP_BACKUP_R2_ACCESS_KEY_ID` | for R2 | R2 API token access key id. |
| `WISP_BACKUP_R2_SECRET_ACCESS_KEY` | for R2 | R2 API token secret. |
| `WISP_BACKUP_R2_BUCKET` | for R2 | Target bucket name. |
| `WISP_BACKUP_R2_PREFIX` | no | Key prefix; default `backups/`. |
| `WISP_BACKUP_DIR` | no | Local directory to also copy each snapshot into. |

Provide the full set of `WISP_BACKUP_R2_*` (account id, access key, secret,
bucket) or none — a partial R2 config fails fast rather than silently skipping
the offsite copy. If only `WISP_BACKUP_DIR` is set, the job backs up locally.

### Creating the R2 bucket and token

1. In the Cloudflare dashboard: **R2 → Create bucket** (e.g. `wisp-backups`).
   The free tier (10 GB storage, zero egress) is ample for SQLite snapshots.
2. **R2 → Manage R2 API Tokens → Create API token**, scoped to **Object
   Read & Write** on that bucket. Copy the **Access Key ID** and **Secret
   Access Key** into the env vars above.
3. Note your **Account ID** (R2 overview page) for `WISP_BACKUP_R2_ACCOUNT_ID`.

### Retention

The job does not delete old snapshots. Use an **R2 lifecycle rule** on the
bucket (e.g. "delete objects older than 30 days" under the `backups/` prefix) so
retention is enforced by R2, not application code.

## Running a backup

Manually (from the project root):

```sh
npm run backup
```

Expected output:

```
Snapshotting /data/wisp.db -> /tmp/wisp-20260616T213559Z.db
Snapshot created: wisp-20260616T213559Z.db (36.0 KiB)
Uploading to R2: wisp-backups/backups/wisp-20260616T213559Z.db
Uploaded to R2: wisp-backups/backups/wisp-20260616T213559Z.db
Backup complete.
```

The local temp snapshot is always removed after destinations are written. The
job exits non-zero on any failure (no destination, incomplete R2 config, vacuum
or upload error), so a scheduler can alert on failed runs.

### Scheduling nightly on Railway

Add a **second Railway service in the same project**, pointed at this repo and
sharing the same persistent volume mount (so it can read `WISP_DB_PATH`):

- **Start / cron command:** `npm run backup`
- **Cron schedule:** `0 4 * * *` (04:00 UTC nightly)
- **Variables:** the `WISP_DB_PATH` and `WISP_BACKUP_R2_*` values above.

Railway runs the cron service to completion on schedule and records the exit
status. Any external scheduler (system `cron`, GitHub Actions on a timer) works
too — it just needs the env vars and network access to R2.

## Restoring

A snapshot is a complete, standalone database. To restore:

1. **Fetch the snapshot.** Download the desired `wisp-*.db` from the R2 bucket
   (Cloudflare dashboard, `rclone`, or any S3 client). Pick the newest key
   unless restoring to an earlier point.

2. **Stop the Wisp service** so nothing is writing during the swap (Railway:
   pause/stop the service, or redeploy after the swap).

3. **Swap the file** at `WISP_DB_PATH` on the volume. Replace the live DB with
   the snapshot and remove any stale WAL sidecars:

   ```sh
   cp wisp-20260616T213559Z.db /data/wisp.db
   rm -f /data/wisp.db-wal /data/wisp.db-shm
   ```

   Removing the `-wal`/`-shm` files matters: a leftover WAL from the old
   database must not be applied on top of the restored file. The snapshot has no
   WAL of its own.

4. **Start the service.** On boot Wisp re-opens the DB in WAL mode and runs
   migrations (a no-op if the snapshot is already at the latest version).

5. **Verify.** `GET /health` returns `{"status":"ok"}` and the dashboard shows
   the expected data. A quick integrity check on the snapshot before swapping is
   cheap insurance:

   ```sh
   sqlite3 wisp-20260616T213559Z.db "PRAGMA integrity_check;"   # -> ok
   ```

## Notes

- **Salt rotation vs. restore:** restoring an older snapshot also restores that
  day's salt row. Visitor hashes only need to be stable *within* a UTC day, so a
  restore is self-consistent. Cross-day unique counts are per-day by design.
- **What's in a snapshot:** everything — `sites`, `events`, `salt`, and the
  migrations table. No external state to reconcile.
