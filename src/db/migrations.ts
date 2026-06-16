/**
 * Ordered list of schema migrations.
 *
 * Each migration has a monotonically increasing `version` and a single SQL
 * string applied inside a transaction by the runner. Append new migrations;
 * never edit or reorder an applied one.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE sites (
        key     TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        domains TEXT NOT NULL,                 -- JSON array of allowed origins
        config  TEXT NOT NULL DEFAULT '{}'     -- per-site JSON config
      );

      CREATE TABLE events (
        id       INTEGER PRIMARY KEY,
        site     TEXT NOT NULL REFERENCES sites(key),
        ts       INTEGER NOT NULL,             -- unix ms
        kind     TEXT NOT NULL,                -- 'pageview' | 'event'
        name     TEXT,                         -- custom event name
        path     TEXT,
        referrer TEXT,
        visitor  TEXT NOT NULL,                -- daily rotating hash
        session  TEXT NOT NULL,
        device   TEXT,                         -- 'mobile' | 'desktop' | 'tablet'
        props    TEXT                          -- JSON, custom event properties
      );

      CREATE INDEX idx_events_site_ts ON events(site, ts);
      CREATE INDEX idx_events_visitor ON events(site, visitor, ts);

      CREATE TABLE salt (
        day   TEXT PRIMARY KEY,                -- UTC date 'YYYY-MM-DD' (only current day kept)
        value TEXT NOT NULL                    -- random salt for that day
      );
    `,
  },
];
