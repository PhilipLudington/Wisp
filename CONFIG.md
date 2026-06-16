# Per-Site Config

Every site row carries a JSON `config` blob (`sites.config`). It is the
**adaptability layer**: one blob drives behavior on _both_ ends — the tracker in
the browser and the dashboard — with no per-site code. Change the config, and
the tracker and dashboard adapt. See [DESIGN.md](./DESIGN.md) §5 for the
rationale; the shape lives in [`src/sites/config.ts`](./src/sites/config.ts).

## v1 schema

```jsonc
{
  // Auto-track behaviors the tracker should wire up. Unknown flags are ignored.
  "autoTrack": ["outboundLinks", "scrollDepth"],

  // Each goal becomes one count panel in the dashboard: how many times its
  // custom event fired in the selected range. No code change per goal.
  "goals": [
    { "name": "Signups", "event": "signup" },
    { "name": "Newsletter", "event": "subscribe" },
  ],
}
```

An empty config (`{}`) is valid and the default: pageviews are tracked, nothing
is auto-tracked, and no goal panels appear.

### `autoTrack`

A list of flags. Known flags:

| Flag            | Effect                                                             |
| --------------- | ------------------------------------------------------------------ |
| `outboundLinks` | Emits an `outbound` event (with the link URL) on cross-host clicks |
| `scrollDepth`   | Emits a `scroll` event once the visitor passes 90% of the page     |

**How it reaches the tracker.** The served `wisp.js` is a single shared, cached
artifact, so it can't be per-site. Instead the tracker fetches
`GET /c/<site>` — a public endpoint returning just `{ "autoTrack": [...] }` —
and wires up the named behaviors. Changing config centrally reaches every embed
within the endpoint's 5-minute cache, with no snippet edit.

A `data-auto="outboundLinks,scrollDepth"` attribute on the embed **overrides**
the fetch (for inline/one-off control); when present, the server config is not
consulted.

### `goals`

A flat list of `{ name, event }`:

- `name` — the label shown on the dashboard panel.
- `event` — the custom-event name (`window.wisp('event', '<event>')`) to count.

The dashboard renders one panel per goal, deriving the count from the
custom-events data it already fetches — so adding a goal needs only a config
edit, no new endpoint or query.

## Setting config

Via the seed/register script (config is validated before it's stored):

```sh
npm run seed-site -- app "Web App" "https://app.example.com" \
  '{"autoTrack":["outboundLinks"],"goals":[{"name":"Signups","event":"signup"}]}'
```

Invalid config (bad JSON, a non-array `autoTrack`, an unknown flag, or a
malformed goal) is rejected with a specific error and nothing is written.

## Validation & forward-compat

- **Read paths** (`/c/<site>`, `/api/sites`) normalize leniently: anything
  malformed is dropped to a safe default, never thrown — a bad blob can't break
  ingestion or the dashboard.
- **Write paths** (seed/admin) validate the known fields and reject bad input.
  Unknown top-level keys are **preserved**, so the stored blob can already carry
  fields a future version will consume.

## Deferred (post-v1)

Intentionally not in v1 — adding them is new fields, not new architecture:

- **Funnels** — ordered, multi-step goals.
- **Path-pattern goals** — count visits to URLs matching a pattern.
- **Per-site retention windows.**
