# apple-health-mcp

A remote [MCP](https://modelcontextprotocol.io) server that exposes your **Apple Watch / Apple Health** data to **every Claude surface** — claude.ai web, Claude Desktop, the Claude mobile app, and Claude Code — with near-fresh data.

Built in public. MIT licensed. Your health data and secrets never live in this repo — only code does.

## How it works

```
Apple Watch → iPhone HealthKit
   → Health Auto Export (iOS app) POSTs to /api/ingest every ~hour
   → Neon Postgres
   → /api/mcp (remote MCP server, this repo)
   → Claude (web · desktop · mobile · Claude Code)
```

HealthKit is iOS-only, so the data is pushed from your iPhone by the
[Health Auto Export](https://apps.apple.com/app/health-auto-export/id1115567069) app.
Local MCP servers can't reach claude.ai web/mobile, so this one is remote.

## Tools

| Tool | What it does |
|---|---|
| `list_metrics` | Discover available metrics (units, counts, date ranges) |
| `query_metric` | Query a metric over a range (raw / hourly / daily / avg / sum / min / max) |
| `list_workouts` | Workouts in a range, optionally by type |
| `query_events` | ECG, State of Mind, symptoms, medications, cycle tracking, HR notifications |
| `latest_snapshot` | Most recent value for every metric |
| `health_sql` | Read-only `SELECT` over `metric_samples`, `workouts`, `health_events` |

## Self-host

1. **Database** — provision Neon (Vercel Marketplace → Neon) and copy the connection string.
2. **Deploy** — deploy this repo to Vercel. Set env vars:
   - `DATABASE_URL` — your Neon string
   - `MCP_SECRET` — `openssl rand -hex 32`
3. **Migrate** — `DATABASE_URL=... npm run db:migrate`.
4. **iOS push** — in Health Auto Export: **Automations → REST API**
   - URL: `https://<your-app>.vercel.app/api/ingest`
   - Header: `Authorization: Bearer <MCP_SECRET>`
   - Format: JSON, all data types, schedule hourly.
5. **Connect Claude** — same URL everywhere: `https://<your-app>.vercel.app/api/mcp`
   - **Web / mobile / desktop (claude.ai):** add a Custom Connector with that URL.
     claude.ai requires OAuth, which this server implements: when prompted to sign
     in, an **Authorize** page opens — enter your `MCP_SECRET` as the access secret.
     That issues a 90-day token; no per-request URL secret.
   - **Claude Code:**
     `claude mcp add --transport http apple-health https://<your-app>.vercel.app/api/mcp --header "Authorization: Bearer <MCP_SECRET>"`

## Auth model

- **Claude Code / ingest** use the static `MCP_SECRET` as a bearer (or `?key=`).
- **claude.ai web/mobile/desktop** require OAuth, so the server ships a minimal,
  stateless OAuth 2.1 layer (discovery, dynamic client registration, PKCE). The
  `/authorize` step is gated by `MCP_SECRET` (entered as a password), so only the
  secret-holder can mint a token. Codes and tokens are HMAC-signed — no DB, no deps.

## Security notes

- Treat `MCP_SECRET` like a password: it's the ingest bearer *and* the OAuth login.
- For extra `health_sql` safety, point `DATABASE_URL` at a Postgres role granted
  only `SELECT`, or keep a separate read-only role for production.
- Custom Connectors require a paid Claude plan (Pro/Max/Team/Enterprise).

## Limitations

- iOS background limits make sync periodic (≈ hourly), not real-time.
- Data is a push from the phone; if the phone is offline, ingestion pauses.

## Develop

```bash
npm install
npm test          # Vitest (uses in-memory PGlite, no DB needed)
npm run dev
```
