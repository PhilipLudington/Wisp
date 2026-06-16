import { getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { validateSiteConfig } from '../src/sites/config.js';

/**
 * Register (or update) a site for local testing.
 *
 * Usage:
 *   npm run seed-site -- <key> [name] [domains-csv] [config-json]
 *
 * Examples:
 *   npm run seed-site -- blog
 *   npm run seed-site -- blog "My Blog" "https://blog.example.com,http://localhost:5173"
 *   npm run seed-site -- app "Web App" "https://app.example.com" '{"autoTrack":["outboundLinks"]}'
 */

const [key, name, domainsCsv, configJson] = process.argv.slice(2);

if (!key) {
  console.error('Usage: npm run seed-site -- <key> [name] [domains-csv] [config-json]');
  process.exit(1);
}

const siteName = name ?? key;
const domains = domainsCsv
  ? domainsCsv
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
  : [`http://localhost:5173`];
const cfg = configJson ?? '{}';

// Validate config (shape + known fields) before touching the DB. Unknown
// top-level keys are allowed through for forward-compat; see src/sites/config.ts.
const configErrors = validateSiteConfig(cfg);
if (configErrors.length > 0) {
  console.error('Invalid config:');
  for (const e of configErrors) console.error('  - ' + e);
  process.exit(1);
}

const db = getDb();
runMigrations(db);

db.prepare(
  `INSERT INTO sites (key, name, domains, config)
   VALUES (@key, @name, @domains, @config)
   ON CONFLICT(key) DO UPDATE SET
     name = excluded.name,
     domains = excluded.domains,
     config = excluded.config`,
).run({
  key,
  name: siteName,
  domains: JSON.stringify(domains),
  config: cfg,
});

const row = db.prepare('SELECT key, name, domains, config FROM sites WHERE key = ?').get(key);
console.log('Seeded site:', row);

db.close();
