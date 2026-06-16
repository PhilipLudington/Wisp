# Wisp — Implementation Plan

## Overview

Wisp is a self-hosted, cookieless web-analytics tool: a ~1KB tracker, a TypeScript
collector, and a React dashboard, served by one Hono process backed by SQLite, and
deployed as a single Railway service. See [DESIGN.md](./DESIGN.md) for the full
rationale and [IDEA.md](./IDEA.md) for the thesis.

This plan sequences the build so each phase produces something verifiable on its own:
storage first, then the write path (collector), then the script that feeds it
(tracker), then the read path (query API + dashboard), then the adaptability layer
that ties config to both ends, and finally deployment, backups, and onboarding a real
site.

**Current status:** Phase 0 complete (2026-06-16). Phase 1 next.

**Stack:** TypeScript, Hono, `better-sqlite3` (synchronous, WAL), Vite + React SPA,
Recharts or uPlot for charts, Railway (container + persistent volume), Cloudflare R2
(backups).

---

## Phase 0: Foundation & Storage ✅
**Status:** Complete (2026-06-16)

**Goal:** A running Hono server backed by a migrated SQLite database in WAL mode, with
the project scaffolding and dev tooling in place.

**Estimated Effort:** 2–3 days

### Deliverables
- TypeScript project: `package.json`, `tsconfig.json`, lint/format config, scripts
- Hono server that boots, serves a health route, and listens on a configurable port
- `better-sqlite3` connection helper opening the DB in WAL mode at a configurable path
- Migration runner + initial schema: `sites`, `events`, `salt` tables and indexes
- A way to seed/register a site (CLI script or seed migration) for local testing

### Tasks
- [x] Initialize repo: `package.json`, `tsconfig.json`, ESLint/Prettier, `.gitignore` (completed 2026-06-16)
- [x] Add Hono + a dev runner (e.g. `tsx watch`) and a `health` route returning 200 (completed 2026-06-16)
- [x] Add `better-sqlite3`; open DB with `PRAGMA journal_mode=WAL` and sane pragmas (`synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout`) (completed 2026-06-16)
- [x] Write a minimal migration runner (tracks applied versions in a table) (completed 2026-06-16)
- [x] Author migration 001: `sites`, `events`, `salt` tables + `idx_events_site_ts`, `idx_events_visitor` (per DESIGN schema) (completed 2026-06-16)
- [x] Add a `seed-site` script to insert a test site (`key`, `name`, `domains`, `config`) (completed 2026-06-16)
- [x] Centralize config (DB path, port, admin password, salt rotation TZ) via env vars (completed 2026-06-16)

### Testing Strategy
- Server starts and `GET /health` returns 200
- Running migrations on a fresh DB creates all tables/indexes; re-running is a no-op
- `seed-site` inserts a row readable via a quick SQL query
- DB file is created on the configured volume path and is in WAL mode

---

### Phase 0 Readiness Gate
Before Phase 1, these must be true:
- [x] Server boots and serves `/health` (returns 200 `{"status":"ok"}`)
- [x] Fresh DB migrates cleanly and is idempotent (re-run is a no-op)
- [x] At least one test site exists in `sites` (`blog` seeded)

---

## Phase 1: Ingestion Collector (`POST /e`)

**Goal:** The complete write path — validate, origin-check, bot-filter, derive the
daily visitor hash with a persisted rotating salt, resolve the session window, and
insert an event.

**Estimated Effort:** 4–5 days

### Deliverables
- `POST /e` route accepting the tracker payload (path, referrer, screen size, site key, kind, name, props)
- Payload validation (schema/shape, size limits) returning 204 on success, 4xx on bad input
- Origin check against the site's `domains` allowlist
- Bot filter: known-bot UA list + heuristics (missing/non-browser UA, headless markers); dropped traffic logged/auditable
- Daily-rotating visitor hash with salt persistence in the `salt` table
- Session resolution via a 30-minute sliding window per visitor
- Device derivation (`mobile`/`desktop`/`tablet`) from UA
- Event insert into `events`

### Tasks
- [ ] Define the ingest payload type and a validator; enforce max body size
- [ ] Implement `POST /e`: parse, validate, resolve site by `data-site` key (404/204 on unknown)
- [ ] Origin check: compare request `Origin` against `sites.domains` JSON array
- [ ] Bot filter module: maintained UA blocklist + heuristics; return early and log drops
- [ ] Salt service: read current UTC-day salt; on first request of a new day, generate a fresh salt and overwrite the prior row (only current day kept)
- [ ] Visitor hash: `sha256(ip + user_agent + site + daily_salt)`; raw IP/UA used in-memory only, then discarded
- [ ] Session resolver: look up visitor's most recent event; reuse `session` if within 30 min, else mint a new one (read-then-write)
- [ ] Device derivation from UA
- [ ] Insert the event row; respond 204 with no body
- [ ] Extract real client IP correctly behind Railway's proxy (trust `X-Forwarded-For` appropriately)

### Testing Strategy
- Valid payload inserts exactly one `events` row with correct fields
- Same visitor (same IP/UA/site/day) hashes identically across requests; different day → different hash
- Salt survives a simulated process restart mid-day (no re-randomization); a new UTC day rotates it and overwrites the old row
- Two events from the same visitor <30 min apart share a session; >30 min apart get distinct sessions
- Requests with a disallowed `Origin` are rejected; known bot UAs are dropped and logged
- Malformed/oversized payloads return 4xx without inserting

---

### Phase 1 Readiness Gate
Before Phase 2, these must be true:
- [ ] `POST /e` reliably ingests valid events and rejects invalid ones
- [ ] Salt persistence verified across restart and day-rotation
- [ ] Session windowing and visitor hashing verified by tests

---

## Phase 2: The Tracker (`wisp.js`)

**Goal:** A dependency-free ~1KB tracking script, served by Wisp, that sends pageviews
(including SPA route changes), supports a custom-event API, and reads per-site config to
decide what to auto-track.

**Estimated Effort:** 3–4 days

### Deliverables
- `wisp.js` source + a build/minify step producing a ~1KB artifact served at `/wisp.js`
- Pageview on load and on SPA navigation (`history.pushState` / `popstate`)
- `navigator.sendBeacon()` transport with `fetch(..., {keepalive:true})` fallback
- `window.wisp('event', name, props?)` custom-event API
- Reads `data-site` and optional inline config for auto-tracking hooks (e.g. outbound links, scroll depth)
- Collects only path, referrer, screen size, site key — nothing identifying

### Tasks
- [ ] Write the tracker: read `data-site` from the script tag, send a pageview on load
- [ ] Hook `history.pushState`/`replaceState` + `popstate` to fire pageviews on SPA route changes
- [ ] Transport: `sendBeacon` with `keepalive` fetch fallback; non-blocking, unload-safe
- [ ] Expose `window.wisp(...)`; queue calls made before load, then flush
- [ ] Auto-track scaffolding reading inline/`data-` config: outbound link clicks, scroll depth (gated by config)
- [ ] Add a minifier (esbuild/terser) build step; assert output stays ~1KB
- [ ] Serve `wisp.js` from Hono with appropriate cache headers
- [ ] Manual smoke page that loads the script and exercises pageview + custom event

### Testing Strategy
- Loading the test page sends a pageview that lands in `events`
- SPA route change (pushState) sends a second pageview with the new path
- `window.wisp('event', 'signup')` inserts an `event`-kind row with the name
- `sendBeacon` is used when available; fallback path works when it isn't
- Minified bundle is ≤ ~1KB and dependency-free
- Outbound-link / scroll-depth auto-track fire only when enabled in config

---

### Phase 2 Readiness Gate
Before Phase 3, these must be true:
- [ ] Tracker reliably feeds real events into the collector end-to-end
- [ ] Minified size target (~1KB) met
- [ ] Custom-event API and SPA tracking verified

---

## Phase 3: Stats Query API & Auth

**Goal:** Single-password authentication and the read-side API that powers every
dashboard panel, computed on read with SQL `GROUP BY` queries.

**Estimated Effort:** 3–4 days

### Deliverables
- Single-password auth (login + session/token) protecting all read routes
- Query endpoints per site for: pageviews-over-time (with range total), per-day unique visitors (no range total), top pages, top referrers/sources, device breakdown, custom-events list, current visitors (last 5 min)
- Range selector support (24h / 7d / 30d / custom) on time-series queries

### Tasks
- [ ] Implement single-password auth: login route, signed session cookie or token, middleware guarding read routes
- [ ] `GET` pageviews time series for a site + range, plus a range total (sums across days)
- [ ] `GET` unique visitors as a per-day series only — explicitly no single range total (salt rotation makes cross-day dedupe meaningless)
- [ ] `GET` top pages (GROUP BY path)
- [ ] `GET` top referrers/sources (GROUP BY referrer)
- [ ] `GET` device breakdown (GROUP BY device)
- [ ] `GET` custom-events list with counts (GROUP BY name where kind='event')
- [ ] `GET` current visitors (distinct visitors in last 5 min)
- [ ] Validate/normalize range params; bound custom ranges
- [ ] Confirm `idx_events_site_ts` / `idx_events_visitor` serve these queries (EXPLAIN QUERY PLAN)

### Testing Strategy
- Unauthenticated requests to read routes are rejected; correct password grants access
- Seeded events produce correct pageview sums and per-day unique counts
- Top pages/referrers/devices match hand-computed expectations on a fixed seed
- Current-visitors reflects only events in the last 5 minutes
- Queries use the intended indexes (no full scans on the hot paths)

---

### Phase 3 Readiness Gate
Before Phase 4, these must be true:
- [ ] Auth protects all read routes
- [ ] Every dashboard panel has a backing endpoint returning correct data
- [ ] Time-series and unique-visitor semantics match DESIGN (range total vs. per-day-only)

---

## Phase 4: Dashboard SPA

**Goal:** A static Vite + React dashboard, served by the same Hono process, that
renders the core traffic view per site behind the password gate.

**Estimated Effort:** 4–5 days

### Deliverables
- Vite + React SPA built to static assets and served by Hono
- Login screen wired to the auth route
- Per-site view: pageviews chart with range selector + range total; per-day unique-visitors chart (no range total); top pages; top referrers/sources; device breakdown; custom-events list; current-visitors number
- Site switcher across registered sites
- Charting via Recharts or uPlot (uPlot if bundle size matters)

### Tasks
- [ ] Scaffold Vite + React app; wire its build output to be served as static assets by Hono
- [ ] Login screen → auth route; handle authed/unauthed app states
- [ ] Site switcher (lists `sites`)
- [ ] Pageviews chart (line/area) + range selector (24h/7d/30d/custom) + range total
- [ ] Unique-visitors chart as per-day series with explicit "no range total" treatment
- [ ] Top pages, top referrers/sources, device breakdown panels
- [ ] Custom-events list panel
- [ ] Current-visitors indicator (polls the last-5-min endpoint)
- [ ] Pick and integrate the chart library; keep the bundle lean
- [ ] Production build wired into the single-process serve path

### Testing Strategy
- Login flow works; the app is inaccessible without auth
- Each panel renders real data from the Phase 3 endpoints for a seeded site
- Range selector changes update the pageviews chart and its total correctly
- Unique-visitors chart shows per-day points and never a single aggregate total
- Switching sites swaps all panels to the selected site
- Built SPA is served by the one Hono process (no separate frontend server)

---

### Phase 4 Readiness Gate
Before Phase 5, these must be true:
- [ ] Full core dashboard renders correct data end-to-end behind auth
- [ ] Single-process serving (API + `wisp.js` + SPA) confirmed locally

---

## Phase 5: Per-Site Config (Adaptability Layer)

**Goal:** Make `sites.config` actually drive behavior on both ends — `autoTrack` flags
reach the tracker, and a flat `goals` list makes dashboard panels appear — proving the
config-drives-both mechanism exists from day one.

**Estimated Effort:** 2–3 days

### Deliverables
- `sites.config` JSON consumed by the tracker (`autoTrack`) and the dashboard (`goals`)
- Tracker auto-track behaviors gated by `autoTrack` (e.g. `outboundLinks`, `scrollDepth`)
- Dashboard renders a goal panel per entry in `goals` (count of a named event) with no code change per goal
- A documented config shape with room to grow (funnels, path goals deferred)

### Tasks
- [ ] Expose a site's config to the tracker (inline on `wisp.js` request or a tiny config endpoint), honoring `autoTrack`
- [ ] Wire tracker auto-track behaviors to the config flags
- [ ] Dashboard reads `sites.config.goals` and renders one panel per goal (count of the named event)
- [ ] Validate config on write/seed; sensible defaults for empty config (`{}`)
- [ ] Document the v1 config schema and the deferred fields

### Testing Strategy
- Enabling `outboundLinks`/`scrollDepth` in config makes the tracker emit those events; disabling stops them
- Adding a goal to a site's config makes a matching panel appear with the correct count, with no code change
- Empty/`{}` config is handled gracefully (no panels, default tracking)

---

### Phase 5 Readiness Gate
Before Phase 6, these must be true:
- [ ] Config changes visibly alter both tracker behavior and dashboard panels
- [ ] No per-site code branches — purely config-driven

---

## Phase 6: Deploy, Backups & Onboarding

**Goal:** Run Wisp as one Railway service on a persistent volume, with a nightly backup
to Cloudflare R2, and onboard the user's first real site by replacing its GA/Plausible
snippet.

**Estimated Effort:** 3–4 days

### Deliverables
- Railway deployment: one Hono container, SQLite on a persistent volume, env config
- Salt persistence verified on the real volume across redeploys/restarts
- Nightly `VACUUM INTO` snapshot uploaded to Cloudflare R2 (free tier); documented restore procedure
- First real site registered and its GA/Plausible snippet replaced with the Wisp tag

### Tasks
- [ ] Production container/build for the single Hono process (API + `wisp.js` + SPA)
- [ ] Provision Railway service + persistent volume; mount the DB path; set env vars (password, paths, R2 creds)
- [ ] Verify migrations run on deploy and salt survives redeploys on the real volume
- [ ] Backup job: nightly `VACUUM INTO` → upload to Cloudflare R2; document the restore (download + file swap)
- [ ] Register the first real site (`key`, `name`, `domains`, `config`)
- [ ] Replace that site's GA/Plausible `<script>` with `<script defer data-site="..." src=".../wisp.js">`
- [ ] Confirm real traffic flows: pageviews, uniques, and the dashboard reflect live data

### Testing Strategy
- Fresh deploy migrates and boots; `/health` green
- A redeploy does not reset the day's salt (visitor counts stay stable across deploys)
- Nightly backup produces a valid snapshot in R2; a restore round-trip reproduces the DB
- The real site's pageviews appear in the dashboard within minutes of the snippet swap
- GA/Plausible snippet fully removed from the onboarded site

---

### MVP Definition of Done
- [ ] Tracker, collector, dashboard, config layer, and auth all functional end-to-end
- [ ] Deployed to Railway with SQLite on a volume and nightly R2 backups
- [ ] At least one real site onboarded and reporting live, GA/Plausible removed

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Bot filtering is never complete | Inflated/approximate counts | High | Maintained UA list + heuristics; log dropped traffic for audit; accept "good enough" |
| SQLite/Railway durability (single volume) | Data loss | Low | Nightly `VACUUM INTO` → Cloudflare R2; trivial single-file restore |
| Salt re-randomizes mid-day (restart/redeploy) | Inflated unique-visitor counts | Medium | Persist current-day salt in `salt` table on the volume; verified across restart in Phase 1 & 6 |
| Wrong client IP behind Railway proxy | Broken/duplicated visitor hashes | Medium | Resolve real IP via `X-Forwarded-For` correctly; test before relying on it |
| SQLite write contention across sites | Ingestion latency | Low | WAL mode (concurrent readers + one writer); revisit only if it appears |
| Tracker bundle creeps past ~1KB | Defeats "tiny" promise | Medium | Minify + assert size in build; keep dependency-free |
| Origin check is spoofable | Stat pollution if site key leaks | Medium | Accepted at personal scale; HMAC token + rate limiting deferred |
| Over-engineering the config layer | Wasted effort | Medium | Ship the simple `autoTrack` + flat `goals`; let real needs pull features |
| Query-on-read slows as data grows | Sluggish dashboard | Low | Rollup tables deferred until queries actually slow; schema kept portable |

## Timeline

Phases are largely sequential, gated by readiness checks:

```
Phase 0 (Foundation & Storage)
   └─► Phase 1 (Collector / write path)
          ├─► Phase 2 (Tracker) ──────────┐
          └─► Phase 3 (Query API + Auth) ──┤
                                           └─► Phase 4 (Dashboard SPA)
                                                  └─► Phase 5 (Config layer, both ends)
                                                         └─► Phase 6 (Deploy, backups, onboarding)
```

Phases 2 and 3 can proceed in parallel once Phase 1 lands (tracker feeds the write path;
query API reads it). Phase 4 depends on both. Estimated total: ~3–4 weeks of focused
effort.

## Deferred (post-MVP)

Tracked in [DESIGN.md](./DESIGN.md) — not in MVP scope: country/geo (GeoIP), funnels and
path-pattern goals, rollup/aggregate tables, write buffering / ingestion-service split,
per-site read-only share links, per-site HMAC ingest token + rate limiting, and an
optional Postgres/ClickHouse migration path.
