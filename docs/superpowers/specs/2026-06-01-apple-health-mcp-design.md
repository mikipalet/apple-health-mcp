# apple-health-mcp — Design Spec

**Date:** 2026-06-01
**Status:** Design (awaiting review)
**Repo:** standalone, public (build-in-public), MIT licensed, on personal GitHub
**Host:** Vercel (personal account, not team)

## Goal

Expose the user's Apple Watch / Apple HealthKit data to **all Claude surfaces**
(claude.ai web, Claude Desktop, Claude mobile, Claude Code) with **always-fresh**
data, via a single remote MCP server added as a Custom Connector.

The data originates on the iPhone (HealthKit is iOS-only). The
[Health Auto Export](https://github.com/Lybron/health-auto-export) iOS app pushes
it to a hosted ingest endpoint on a schedule; a remote MCP server reads it back.

## Why this architecture

- **Local stdio MCP servers only work in Claude Desktop / Claude Code** — they are
  invisible to claude.ai web and the mobile app. Reaching every surface requires a
  **remote** MCP server (public HTTPS, Streamable HTTP transport) added as a
  Custom Connector.
- **HealthKit is iOS-only**, so "always fresh" requires an on-device app pushing
  data out. Manual `export.xml` is a snapshot and is rejected for this goal.
- Health Auto Export's REST-API automation POSTs HealthKit data (150+ metrics,
  70+ workout types, ECG, State of Mind, etc.) to any URL with custom auth headers,
  on a configurable schedule. This is the live feed.

### Freshness caveat
iOS background-execution limits mean sync is **periodic (≈ hourly), not real-time.**
Near-fresh, not instant. Documented for the user, not a bug.

## Architecture / data flow

```
Apple Watch → iPhone HealthKit
   │  Health Auto Export (Automation → POST, ~hourly, Bearer secret)
   ▼
POST /api/ingest      (bearer-gated, Zod-validated, idempotent upsert)
   ▼
Neon Postgres         (Vercel Marketplace, personal account, free tier)
   ▲
   │  read
/mcp/<secret>  or  /api/mcp   (remote MCP, Streamable HTTP, bearer-gated)
   ▼
Claude Custom Connector → web · desktop · mobile · Claude Code
```

## Auth (bearer token, no OAuth)

User chose API-key / bearer auth over OAuth. Constraint discovered during design:
**claude.ai's custom-connector UI has no API-key field** — it expects OAuth or an
open URL. To honor the bearer choice without building OAuth:

- **Secret-in-URL path:** the MCP endpoint is `https://<app>/mcp/<SECRET>`. The URL
  itself is the credential, so it works on every Claude surface including web/mobile.
- The server **also** accepts a standard `Authorization: Bearer <SECRET>` header
  (clean path for Claude Code: `claude mcp add --transport http ... --header`).
- `/api/ingest` requires the same `Authorization: Bearer <SECRET>` header (set in
  the Health Auto Export automation).
- One shared secret, supplied via env (`MCP_SECRET`). Never committed.

Trade-off: the secret lives in a URL (may appear in logs). Acceptable for a single
personal user. OAuth remains a future upgrade path if multi-user is ever wanted.

## Public repo / build-in-public

- Repository is **public** from day one. Code only — **no health data, no secrets**
  in git, ever.
- Secrets (`MCP_SECRET`, `DATABASE_URL`) live in Vercel env + a local `.env`
  (gitignored). `.env.example` documents the names with placeholder values.
- Health data lives **only in Neon**, never in the repo.
- Ships **MIT license**, a README that explains the architecture and a step-by-step
  self-host guide (Neon provision → Vercel deploy → set `MCP_SECRET` → configure
  Health Auto Export automation → add the connector to Claude), and a short roadmap.
- Anyone can fork and run their own instance against their own Neon + secret.

## Data model (Neon Postgres, Drizzle ORM)

Three tables. Generic by design — no per-metric code, so all 150+ HealthKit metric
types and the long-tail data types flow in without changes.

### `metric_samples` — every quantitative metric
| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `metric_name` | text | HAE metric name, e.g. `heart_rate`, `step_count`, `sleep_analysis` |
| `units` | text | HAE-provided units |
| `date` | timestamptz | per-sample timestamp |
| `qty` | numeric null | standard scalar metrics |
| `min` / `avg` / `max` | numeric null | heart-rate-style metrics |
| `systolic` / `diastolic` | numeric null | blood pressure |
| `source` | text null | device/app source |
| `extra` | jsonb null | any non-standard fields (e.g. glucose `mealTime`) |

- **Unique index** `(metric_name, date, source)` → HAE's overlapping re-pushes are
  idempotent (upsert on conflict do nothing).
- **Index** `(metric_name, date)` for range/aggregation queries.

### `workouts` — workout records
| column | type | notes |
|---|---|---|
| `id` | text PK | HAE workout id → upsert key |
| `name` | text | workout type |
| `start` / `end` | timestamptz | |
| `duration_s` | numeric | seconds |
| `active_energy` / `active_energy_units` | numeric / text | |
| `distance` / `distance_units` | numeric / text | |
| `avg_hr` / `max_hr` | numeric | |
| `step_count` | numeric | |
| `route` | jsonb null | GPS points (lat/lon/alt/ts/accuracy) |
| `raw` | jsonb | full original object — nothing lost |

### `health_events` — generic long-tail (ECG, State of Mind, symptoms, medications, cycle tracking, HR notifications)
| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `event_type` | text | `ecg` \| `stateOfMind` \| `symptom` \| `medication` \| `cycleTracking` \| `heartRateNotification` |
| `date` | timestamptz | event timestamp |
| `source` | text null | |
| `payload` | jsonb | full original object incl. ECG waveform voltage samples |

- **Index** `(event_type, date)`.
- A natural dedupe key per type is derived where available (e.g. ECG by start time)
  and enforced via a unique index on `(event_type, date, md5(payload::text))` to keep
  re-pushes idempotent without dropping distinct same-timestamp events.

## Ingest endpoint — `POST /api/ingest`

1. Check `Authorization: Bearer <MCP_SECRET>` → `401` if absent/wrong.
2. Zod-parse the body against the HAE shape (lenient: unknown metric names pass
   through generically; unknown top-level arrays are ignored, not fatal).
3. Normalize:
   - `data.metrics[].data[]` → `metric_samples` rows. Branch per point shape:
     `qty` | `Min/Avg/Max` | `systolic/diastolic`; everything else → `extra`.
   - `data.workouts[]` → `workouts` (upsert by id).
   - `data.{ecg,stateOfMind,symptoms,medications,cycleTracking,heartRateNotifications}[]`
     → `health_events` rows tagged with `event_type`.
4. Upsert (idempotent). Return `200 { metricsStored, workoutsStored, eventsStored }`
   so HAE never retry-storms. Partial-batch failures are logged, not 500'd.

### Known HAE payload shape (verified from project wiki)
```json
{ "data": {
  "metrics": [ { "name": "heart_rate", "units": "count/min",
    "data": [ { "date": "2026-06-01 08:00:00 +0000", "Min": 52, "Avg": 61, "Max": 74 } ] } ],
  "workouts": [ { "id": "...", "name": "Running", "start": "...", "end": "...",
    "duration": 1800, "activeEnergyBurned": {"qty": 250, "units": "kcal"},
    "distance": {"qty": 5.1, "units": "km"}, "avgHeartRate": {"qty": 150, "units":"count/min"},
    "maxHeartRate": {"qty": 172, "units":"count/min"}, "stepCount": {"qty": 5400, "units":"count"},
    "route": [ {"lat": .., "lon": .., "altitude": .., "timestamp": "..", "..": ..} ] } ],
  "stateOfMind": [], "medications": [], "symptoms": [],
  "cycleTracking": [], "ecg": [], "heartRateNotifications": []
} }
```
- Metric points: usually `{ qty, date }`; HR uses `{ Min, Avg, Max, date }`; BP uses
  `{ systolic, diastolic, date }`; glucose adds `mealTime`.
- Date format: `yyyy-MM-dd HH:mm:ss Z`.

## MCP server — `/mcp/<secret>` (and `/api/mcp` for header auth)

Implemented with **`mcp-handler`** (maintained successor to `@vercel/mcp-adapter`)
on Next.js App Router, Streamable HTTP transport. Bearer/secret gate wraps the
handler. Six tools:

1. **`list_metrics`** — `{ metric_name, units, sample_count, first_date, last_date }[]`.
   Discovery so Claude knows what exists before querying.
2. **`query_metric`** — args `name`, `start`, `end`, `aggregation`
   (`raw` | `hourly` | `daily` | `avg` | `sum` | `min` | `max`). The workhorse;
   returns a time series or a single aggregate.
3. **`list_workouts`** — args `start`, `end`, optional `type`. Returns workouts with
   key stats (duration, energy, distance, avg/max HR, steps).
4. **`query_events`** — args `event_type`, `start`, `end`. Reads the long-tail
   (`health_events`) — ECG, State of Mind, symptoms, etc.
5. **`latest_snapshot`** — most-recent value for a curated key set (resting HR,
   today's steps, last night's sleep, latest weight, HRV, …). Quick
   "how am I doing right now" answer.
6. **`health_sql`** — read-only `SELECT` escape hatch. Runs against a Postgres role
   with only `SELECT` granted; statement is rejected unless it parses as a single
   read-only query. Gives Claude 100% reach into stored data for power queries.

All tools require the secret. All input validated with Zod. Tools return structured
JSON (and a short text summary) so Claude renders results well.

## Error handling

- **Ingest:** `401` on bad secret; `200 + summary` on success; malformed points are
  skipped and counted, never 500 the whole batch (avoids HAE retry storms).
- **MCP:** `401` on bad secret; per-tool Zod errors returned as tool errors;
  `health_sql` rejects non-SELECT / multi-statement input with a clear message.
- **DB:** Neon serverless driver; upserts are idempotent so retries are safe.

## Testing

- **Ingest normalizer (unit):** sample HAE payloads → expected rows, covering
  `qty` / `Min,Avg,Max` / `systolic,diastolic` / glucose `mealTime`, workouts with
  and without routes, each `health_events` type, and **idempotent re-push** (same
  batch twice → no duplicate rows).
- **MCP tools (unit/integration):** seed a test DB, assert each tool's output shape
  and aggregations; assert `health_sql` rejects writes/multi-statements.
- **Auth:** ingest and MCP both reject missing/incorrect secret.

## Stack

- Next.js (App Router) · TypeScript
- `mcp-handler` (remote MCP, Streamable HTTP)
- Neon Postgres + `@neondatabase/serverless` + Drizzle ORM (typed schema + migrations)
- Zod (validation)
- Vitest (tests)
- Vercel (personal account) deploy; Neon via Vercel Marketplace

## Out of scope (YAGNI)

- OAuth / multi-user (single personal user; secret-in-URL is enough).
- Writing data back to HealthKit (not reachable from the cloud anyway).
- A custom iOS app (Health Auto Export already does the on-device push).
- Dashboards/UI — this is an MCP server; Claude is the UI.

## Open setup steps (documented in README, not code)

1. Provision Neon (Vercel Marketplace, personal account) → get `DATABASE_URL`.
2. Deploy to Vercel personal account; set `MCP_SECRET` + `DATABASE_URL` env.
3. Run Drizzle migrations.
4. In Health Auto Export: Automation → REST API → POST to `/api/ingest`, add header
   `Authorization: Bearer <MCP_SECRET>`, schedule hourly, select all data types.
5. Add the connector to Claude: `https://<app>/mcp/<MCP_SECRET>` (web/mobile/desktop)
   or `claude mcp add --transport http ... --header "Authorization: Bearer <MCP_SECRET>"`
   (Claude Code).
