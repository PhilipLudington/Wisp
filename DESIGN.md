# Wisp: Cookieless Analytics You Actually Own

> **Implementation:** `~/Fun/Wisp` (planned)

A self-hosted, cookieless web-analytics tool — a ~1KB tracker, a TypeScript collector, and a clean dashboard — that replaces Google Analytics and Plausible across many small sites for a few dollars a month, and reshapes itself to each site.

## Core Idea

Wisp is a single small TypeScript app that does three jobs: serves a tiny tracking script, ingests events from your sites, and shows you graphs. It runs as one Railway service backed by SQLite, counts unique visitors without cookies or stored PII, and is driven by a per-site config so a blog, a landing page, and a web app each get a view that fits them.

It exists because the analytics market offers a bad trade for someone with a handful of personal sites. Google Analytics is free but costs you a cookie-consent banner, data you don't control, and far more product than you need. Plausible and friends are lovely but are either a paid SaaS or an ops project (Plausible's own self-host pulls in ClickHouse *and* Postgres). Adopting an off-the-shelf self-host tool like Umami is the sensible default — but it still means adapting your sites and habits to someone else's data model, and running infrastructure sized for a product you're not building.

The key insight: at the scale of small personal sites, a bespoke tool is cheaper to *build and run* than a generic one is to *adopt and operate* — because you can delete every feature, every dependency, and every database you don't need, and shape the remaining 5% to fit you exactly. Wisp is a deliberate proof of that thesis (see *The Joy of Custom Tools*).

## Why This Exists

| Problem | Today's Reality |
|---|---|
| GA needs a consent banner | Cookie tracking forces a GDPR/ePrivacy banner on every site |
| GA gives away your data | Visitor data flows to Google; you rent access to your own numbers |
| GA is enormous | 99% of its surface is unused for a personal blog |
| Plausible Cloud costs money | Per-site/usage pricing adds up across many small sites |
| Plausible self-host is heavy | Ships ClickHouse + Postgres — real ops for a small site |
| Umami/GoatCounter fit *their* model, not yours | Per-site adaptation is awkward; you bend your sites to the tool |
| All of them are generic | None know that *this* site cares about signups and *that* one about scroll depth |

## Architecture

```
   Your sites                         Wisp (one Railway service)
 ┌────────────┐                ┌──────────────────────────────────────┐
 │ blog       │  <script>      │  Hono server (one app)               │
 │  wisp.js ──┼──── POST /e ──►│  ┌────────────────────────────────┐  │
 ├────────────┤  navigator     │  │ Ingestion (POST /e)            │  │
 │ landing    │  .sendBeacon   │  │  • validate payload + origin   │  │
 │  wisp.js ──┼───────────────►│  │  • bot filter (UA + heuristics)│  │
 ├────────────┤                │  │  • visitor = daily rotating hash│ │
 │ web app    │                │  │  • resolve session, insert     │  │
 │  wisp.js ──┼───────────────►│  └───────────────┬────────────────┘  │
 └────────────┘                │                  ▼                   │
                               │            ┌───────────┐             │
   You (browser)               │            │  SQLite   │             │
 ┌────────────┐   GET /        │            │ events    │             │
 │ Dashboard  │◄──── auth ─────│  ┌─────────┤ sites     │             │
 │ (React SPA)│   (password)   │  │ Queries │ config    │             │
 │  graphs    │                │  │ on read │ salt      │             │
 └────────────┘                │  └─────────┴─(volume)──┘             │
                               └──────────────────────────────────────┘

   daily_salt rotates every 24h ─► yesterday's hashes can't be re-derived;
   current day's salt is persisted on the volume so a restart can't reset it.
   nightly `VACUUM INTO` ─► Cloudflare R2 (free tier) for backups
```

## Component Deep-Dives

### 1. The Tracker (`wisp.js`)

A hand-written, dependency-free script, minified to ~1KB, served by Wisp itself so there's one `<script>` tag per site:

```html
<script defer data-site="blog" src="https://wisp.example.com/wisp.js"></script>
```

Responsibilities, kept deliberately small:

- Send a pageview on load, and on SPA route changes (listen for `history.pushState` / `popstate`).
- Use `navigator.sendBeacon()` (falling back to `fetch(..., {keepalive:true})`) so sends don't block navigation and survive page unload.
- Expose `window.wisp('event', name, props?)` for custom events.
- Read `data-site` and an optional inline config to decide what to auto-track (e.g. outbound link clicks, scroll depth) — this is where per-site adaptation reaches the browser.
- Collect nothing identifying: it sends path, referrer, screen size, and the site key. The server derives everything else.

### 2. The Collector (`POST /e`)

The only write path. For each event:

1. **Validate** the payload and check the request `Origin` against the site's allowed domains (cheap anti-spam).
2. **Bot filter** — drop known bot user-agents (maintained list) plus heuristics (missing/!browser UA, headless markers).
3. **Derive the visitor hash** — `sha256(ip + user_agent + site + daily_salt)`. The `daily_salt` is a random value rotated every 24h. It must be **stable for the whole UTC day** (every request that day must hash to the same value), so the *current* day's salt is persisted in a one-row `salt` table on the volume — surviving process restarts, redeploys, and crashes, which would otherwise re-randomize mid-day and inflate visitor counts. On the first request of a new day, a fresh salt is generated and the previous day's row is overwritten. Nothing older than the current day is ever kept, so yesterday's hashes still can't be reconstructed even from a DB dump. The raw IP and UA are used only in-memory for the hash (and bot/device derivation) and then discarded.
4. **Resolve session** — look up the visitor's most recent event; if it's within a 30-minute sliding window, reuse that `session`, else mint a new one. (This makes ingestion a *read-then-write*, not a pure insert — cheap at this scale, but see the note below.) A session that straddles midnight is split in two, because the visitor hash changes when the salt rotates; accepted as a minor, well-understood artifact of the cookieless model.
5. **Insert** a row into `events`.

No queue, no batching at v1 — at <100k events/month the read-then-write per event against SQLite (WAL mode) is comfortably fast. (A write buffer is a later optimization, noted below.)

### 3. Storage (SQLite)

Raw events, with computation on read. Sketch:

```sql
CREATE TABLE sites (
  key         TEXT PRIMARY KEY,        -- 'blog', 'landing', 'app'
  name        TEXT NOT NULL,
  domains     TEXT NOT NULL,           -- JSON array of allowed origins
  config      TEXT NOT NULL DEFAULT '{}' -- per-site JSON config
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  site        TEXT NOT NULL REFERENCES sites(key),
  ts          INTEGER NOT NULL,        -- unix ms
  kind        TEXT NOT NULL,           -- 'pageview' | 'event'
  name        TEXT,                    -- custom event name
  path        TEXT,
  referrer    TEXT,
  visitor     TEXT NOT NULL,           -- daily rotating hash
  session     TEXT NOT NULL,
  device      TEXT,                    -- 'mobile'|'desktop'|'tablet' (from UA)
  props       TEXT                     -- JSON, custom event properties
);

CREATE INDEX idx_events_site_ts ON events(site, ts);
CREATE INDEX idx_events_visitor ON events(site, visitor, ts);

CREATE TABLE salt (
  day         TEXT PRIMARY KEY,        -- UTC date 'YYYY-MM-DD' (only the current day is kept)
  value       TEXT NOT NULL            -- random salt for that day
);
```

The dashboard's stats are SQL `GROUP BY` queries over this table. **Rollup tables** (daily per-site aggregates) are added only if/when those queries get slow — explicitly a later step, not v1. The schema is kept narrow and engine-agnostic enough that a future move to Postgres or ClickHouse would be a port, not a rewrite.

### 4. The Dashboard (Vite + React SPA)

A static React bundle built with Vite and served by the same Hono process. Single-user, password-protected. Per site:

- **Pageviews** over time (line/area chart) with a range selector (24h / 7d / 30d / custom), and a **range total** — pageviews sum cleanly across days.
- **Unique visitors** shown as the **per-day series only** (the chart), with **no single range total**. The daily salt rotates every 24h, so the same person gets a different hash each day; a "distinct visitors over 30 days" headline would be meaningless (it can't dedupe across days). Each day's count is exact; we deliberately don't roll them into one misleading number. (A returning-visitor metric, if ever wanted, is a deferred decision — see Risks.)
- Top pages, top referrers/sources, device breakdown.
- Custom events list with counts.
- A realtime-ish "current visitors" number (events in the last 5 min) — cheap to add, satisfying to watch.

Charting via a small library (e.g. Recharts or uPlot — uPlot if bundle size matters). The dashboard reads `sites.config` to decide which extra panels to render, so adding a goal to a site's config makes a panel appear without code changes.

### 5. Per-Site Config — the adaptability layer

A JSON blob per site. v1 keeps it simple; it has room to grow:

```jsonc
{
  "autoTrack": ["outboundLinks", "scrollDepth"],  // tracker reads this
  "goals": [                                       // dashboard renders these
    { "name": "signup", "event": "signup" },
    { "name": "newsletter", "event": "subscribe" }
  ]
}
```

v1 scope: `autoTrack` flags and a flat `goals` list (count of a named event). Deliberately deferred: funnels (ordered multi-step goals), path-pattern goals, per-site retention windows. The point is that the *mechanism* — config drives both the tracker and the dashboard — exists from day one, so growing the adaptability is adding fields, not architecture.

## Key Design Decisions

- **One small Hono server, not Next.js, and not separate collector + dashboard.** Hono serves the ingestion route, the static `wisp.js`, and the pre-built React dashboard SPA from a single long-running container — one deploy, one language, minimal dependencies, fast cold start. *Rejected:* Next.js — heavier than a one-route API + tiny dashboard needs, and against the "delete every dependency you don't need" thesis. *Rejected:* a standalone ingestion service for load isolation — premature at this scale; can be split later if a single site ever goes viral. (Note: synchronous `better-sqlite3` + the in-memory/volume salt require a long-running process, so a serverless host like Vercel is out — a container host like Railway/Fly is assumed.)
- **Ingestion is origin-checked, not authenticated.** The `Origin` check is casual anti-spam only — it's spoofable by anything that isn't a browser, so anyone who learns a site key could pollute that site's stats. Accepted for a personal-scale tool. *Deferred:* a per-site HMAC token in `wisp.js` and per-site rate limiting, if abuse ever appears.
- **SQLite, not Postgres/ClickHouse.** Zero-ops, single file on a Railway volume, free. *Rejected:* ClickHouse (what real Plausible uses) — overkill below millions of events/month and adds a database to babysit; the schema is kept portable in case that day comes.
- **Raw events + query-on-read, not pre-aggregation.** Simpler, more flexible for ad-hoc questions, fine at target scale. *Rejected:* rollups-first — deferred until queries actually slow down.
- **Cookieless daily-rotating hash, not cookies or persistent IDs.** No banner, no PII, GDPR-friendly. *Trade-off accepted:* a returning visitor across day boundaries counts as new; "unique visitors" is per-day, like Plausible. This is the correct trade for privacy and is well understood.
- **Synchronous inserts, no queue.** Matches the scale; less to build and operate. *Noted:* an in-memory write buffer or WAL tuning is the first lever if write latency ever shows up.
- **Single-password auth.** It's one user (you). *Deferred:* per-site read-only share links.

## Risks and Open Questions

- **Bot filtering is never finished.** A UA list plus heuristics catches most traffic but not all; numbers will be approximate. Mitigation: maintain a known-bot list, log dropped traffic so it's auditable, accept "good enough."
- **SQLite + Railway durability.** Data lives on a single persistent volume. Mitigation: a nightly `VACUUM INTO` snapshot uploaded to **Cloudflare R2** (free tier, zero egress fees); SQLite's single-file nature makes backups trivial. Restore is a download + file swap.
- **SQLite write concurrency.** Many sites posting at once could contend on the write lock. Mitigation: WAL mode handles concurrent readers + one writer well; revisit only if write contention appears.
- **GeoIP deferred.** No country data in v1 (avoids bundling MaxMind GeoLite2 and its license/update story). Open question: is country breakdown worth pulling in for v2, or not worth the dependency?
- **The "adapts to each site" promise.** Easy to over-engineer the config layer. Mitigation: ship the simple version, let real needs from the user's actual sites pull features in.
- **Scale ceiling.** Design targets <100k views/month. Open question: what's the realistic combined traffic, and is there any one site that could spike past the SQLite-comfortable range?

## MVP Scope

- [ ] `wisp.js` tracker: pageviews, SPA route changes, `sendBeacon`, custom-event API, ~1KB minified
- [ ] `POST /e` collector: validation, origin check, bot filter, daily-hash visitor, session window, insert
- [ ] SQLite schema + migrations; WAL mode
- [ ] Dashboard (Vite + React SPA): pageviews over time (with range total) + per-day unique visitors (no range total), top pages, top referrers, device breakdown, current-visitors
- [ ] Per-site config: `autoTrack` flags + flat `goals` list, read by both tracker and dashboard
- [ ] Single-password auth
- [ ] Deploy to Railway: one Hono service, SQLite on a persistent volume, nightly `VACUUM INTO` → Cloudflare R2 backup job
- [ ] Onboard the user's first real site and replace its GA/Plausible snippet

## Deferred (post-MVP)

- Country/geo breakdown (GeoIP)
- Funnels and path-pattern goals
- Rollup/aggregate tables for query speed
- Write buffering / ingestion service split
- Per-site read-only share links
- Per-site HMAC ingest token + rate limiting (tamper-resistant ingestion)
- Optional migration path to Postgres or ClickHouse if traffic ever demands it

## Name Notes

**Wisp** — a near-invisible, lightweight thing; the tracker is a ~1KB wisp of a script, and the privacy stance means it barely leaves a trace. Alternatives considered: **Footfall** (the retail term for visitor counts), **Tracelet**, **Glimpse**, **Beacon**.
