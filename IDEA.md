---
stage: designing
type: tool
created: 2026-06-16
priority: medium
tags: [analytics, web, privacy, cookieless, self-hosted, typescript, railway, sqlite]
---

# Wisp

A self-hosted, cookieless web analytics tool — a ~1KB tracker, a tiny TypeScript collector, and a clean dashboard — built to replace Google Analytics and Plausible across many small sites at near-zero cost, while adapting to each site's specific shape.

## Key Concepts

- **One tracker, many site shapes.** A per-site config defines what matters for that site (a blog, a landing page, a web app each care about different things). The same lightweight script adapts its behavior from that config — the "fits my exact needs" payoff that off-the-shelf tools make awkward.
- **Cookieless by design.** Unique visitors are counted via a daily-rotating hash — `sha256(ip + user-agent + site + daily_salt)` — that resets every 24h and stores no IP, no cookie, no PII. No consent banner required, GDPR-friendly, same privacy stance that makes Plausible appealing.
- **Tiny and cheap.** A single TypeScript service (collector API + dashboard) backed by SQLite, deployable as one Railway service for a few dollars a month. No second database, no columnar store, no ops burden at the scale of small personal sites.
- **Core traffic first.** Pageviews, unique visitors, top pages, referrers, sessions, and trends over time — the metrics that actually get looked at — done well, before any of the long-tail features.
- **A thesis made real.** This is a deliberate proof of [[joy-of-custom-tools]]: that AI-assisted development makes a bespoke tool cheaper to build *and* run than adopting and adapting a generic SaaS, and a better fit besides.

## Relationship to Other Tools

| Tool | Role | Interaction |
|------|------|-------------|
| Google Analytics | The incumbent being replaced | Wisp drops the cookie consent burden, the data-sharing, and the bloat; keeps the core traffic view |
| Plausible | The privacy-friendly benchmark | Wisp borrows the cookieless model and lightweight script; trades breadth for a tool you fully own and can reshape per site |
| Umami | The closest self-host alternative | What you'd adopt instead of building; Wisp exists to prove building beats adopting here on cost + fit |
| GoatCounter | The minimalist self-host alternative | Reference for "how small can this be" — single binary, SQLite, cookieless |
| Railway | Hosting | Wisp deploys as one small service; SQLite on a persistent volume |

## What It Doesn't Do

- No cookies, no cross-site tracking, no personal data, no fingerprinting beyond the rotating daily hash
- No ClickHouse / columnar store — out of scope at small-site scale (designed so it *could* be added later if traffic ever demanded it)
- No heatmaps, session replay, or A/B testing in initial scope
- No multi-tenant SaaS product — this is a personal tool for the user's own sites, not a hosted service to sell
- No attempt to match GA feature-for-feature — core traffic done well beats a sprawling clone
</content>
</invoke>
