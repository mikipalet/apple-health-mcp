# apple-health-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone public Vercel app that ingests Apple Watch/HealthKit data (pushed by the Health Auto Export iOS app) into Neon Postgres and exposes it to every Claude surface through a remote MCP server.

**Architecture:** Next.js App Router app. `POST /api/ingest` (bearer-gated) normalizes Health Auto Export JSON into three generic Postgres tables via Drizzle. `app/api/[transport]/route.ts` (mcp-handler, Streamable HTTP) serves 6 read tools, gated by the same shared secret (header or `?key=` query param; a rewrite gives the pretty `/mcp/<secret>` URL for claude.ai). Pure logic (date parsing, normalizer, each tool query) lives in `lib/` and is unit-tested with PGlite (in-memory Postgres) so tests need no live DB.

**Tech Stack:** Next.js 16, TypeScript, mcp-handler 1.1, Drizzle ORM 0.45 (pg-core), @neondatabase/serverless 1.1 (prod) / PGlite (tests), Zod 4, Vitest 4. Deploy: Vercel personal account. Repo: public, MIT.

**Spec:** `docs/superpowers/specs/2026-06-01-apple-health-mcp-design.md`

---

## File Structure

```
LICENSE                         MIT
README.md                       Architecture + self-host guide
.gitignore                      ignores .env, node_modules, .next, drizzle journal? (keep migrations)
.env.example                    DATABASE_URL=, MCP_SECRET=
package.json                    deps + scripts
tsconfig.json                   paths: @/* -> ./
next.config.ts                  rewrite /mcp/:secret -> /api/mcp?key=:secret
drizzle.config.ts               schema + out dir + dialect postgresql
vitest.config.ts               node env, globals
db/schema.ts                    3 tables: metricSamples, workouts, healthEvents
lib/env.ts                      validated env access
lib/db.ts                       neon-http drizzle client (prod)
lib/auth.ts                     secretOk(req): header or ?key
lib/hae-date.ts                 parseHaeDate("yyyy-MM-dd HH:mm:ss Z") -> Date
lib/hae-schema.ts               Zod schema for HAE payload
lib/ingest.ts                   normalize(payload) -> { metricRows, workoutRows, eventRows } (pure)
lib/tools/list-metrics.ts       listMetrics(db)
lib/tools/query-metric.ts       queryMetric(db, args)
lib/tools/list-workouts.ts      listWorkouts(db, args)
lib/tools/query-events.ts       queryEvents(db, args)
lib/tools/latest-snapshot.ts    latestSnapshot(db)
lib/tools/health-sql.ts         healthSql(db, sql) read-only guard + run
app/api/ingest/route.ts         POST handler
app/api/[transport]/route.ts    mcp-handler + auth wrap, registers 6 tools
tests/helpers/db.ts             makeTestDb(): PGlite drizzle + migrate + seed helpers
tests/*.test.ts                 per-unit tests
```

Each `lib/tools/*` function takes a `db` instance (works with both neon and PGlite drivers because the Drizzle schema is driver-agnostic), so every tool is testable in-memory.

---

## Task 1: Scaffold project (config, license, gitignore, env example)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `.gitignore`, `.env.example`, `LICENSE`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "apple-health-mcp",
  "version": "0.1.0",
  "private": false,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@neondatabase/serverless": "1.1.0",
    "drizzle-orm": "0.45.2",
    "mcp-handler": "1.1.0",
    "next": "16.2.7",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@electric-sql/pglite": "0.3.10",
    "@types/node": "24.10.1",
    "@types/react": "19.2.7",
    "drizzle-kit": "0.31.10",
    "typescript": "5.9.4",
    "vitest": "4.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`** (pretty URL rewrite: `/mcp/<secret>` → mcp-handler endpoint with secret as `?key`)

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Streamable HTTP MCP clients (claude.ai web/mobile) connect to /mcp/<secret>.
      // The secret travels as a query param to /api/mcp where auth.ts reads it.
      { source: "/mcp/:secret", destination: "/api/mcp?key=:secret" },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { globals: true, environment: "node" },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
```

- [ ] **Step 5: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
.next/
.env
.env*.local
*.tsbuildinfo
next-env.d.ts
.vercel
```

> Note: `.env` is ignored but the generated `drizzle/` migration SQL **is** committed. Health data and secrets never enter git.

- [ ] **Step 7: Create `.env.example`**

```
# Neon Postgres connection string (Vercel Marketplace → Neon, personal account)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
# Shared secret for ingest + MCP auth. Generate: openssl rand -hex 32
MCP_SECRET=replace-with-a-long-random-hex-string
```

- [ ] **Step 8: Create `LICENSE`** (MIT)

```
MIT License

Copyright (c) 2026 Miki Palet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 9: Install dependencies**

Run: `cd ~/GitHub/apple-health-mcp && npm install`
Expected: `node_modules/` populated, no peer-dep errors that block install.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold project config, MIT license, env example"
```

---

## Task 2: Database schema (3 generic tables)

**Files:**
- Create: `db/schema.ts`
- Test: `tests/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/schema.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";

describe("schema", () => {
  it("exports the three tables", () => {
    expect(schema.metricSamples).toBeDefined();
    expect(schema.workouts).toBeDefined();
    expect(schema.healthEvents).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — cannot find module `@/db/schema`.

- [ ] **Step 3: Create `db/schema.ts`**

```typescript
import {
  pgTable,
  bigserial,
  text,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Every quantitative HealthKit metric (150+ types) flows here generically.
// Branching columns cover the three HAE point shapes: scalar (qty),
// heart-rate-style (min/avg/max), and blood pressure (systolic/diastolic).
export const metricSamples = pgTable(
  "metric_samples",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    metricName: text("metric_name").notNull(),
    units: text("units"),
    date: timestamp("date", { withTimezone: true }).notNull(),
    qty: numeric("qty"),
    min: numeric("min"),
    avg: numeric("avg"),
    max: numeric("max"),
    systolic: numeric("systolic"),
    diastolic: numeric("diastolic"),
    source: text("source"),
    extra: jsonb("extra"),
  },
  (t) => [
    // Idempotency: HAE re-pushes overlapping windows. A sample is identified by
    // (metric, timestamp, source). COALESCE source to '' so NULL sources dedupe.
    uniqueIndex("metric_samples_uq").on(t.metricName, t.date, t.source),
    index("metric_samples_name_date_idx").on(t.metricName, t.date),
  ],
);

// Workout records. Known columns are promoted for querying; the full original
// object is kept in `raw` so nothing is ever lost.
export const workouts = pgTable("workouts", {
  id: text("id").primaryKey(), // HAE workout id → upsert key
  name: text("name"),
  start: timestamp("start", { withTimezone: true }),
  end: timestamp("end", { withTimezone: true }),
  durationS: numeric("duration_s"),
  activeEnergy: numeric("active_energy"),
  activeEnergyUnits: text("active_energy_units"),
  distance: numeric("distance"),
  distanceUnits: text("distance_units"),
  avgHr: numeric("avg_hr"),
  maxHr: numeric("max_hr"),
  stepCount: numeric("step_count"),
  route: jsonb("route"),
  raw: jsonb("raw").notNull(),
});

// Long-tail data types kept generic: ecg (incl. waveform samples), stateOfMind,
// symptoms, medications, cycleTracking, heartRateNotifications.
export const healthEvents = pgTable(
  "health_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventType: text("event_type").notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    source: text("source"),
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("health_events_type_date_idx").on(t.eventType, t.date)],
);
```

> Note on `health_events` dedupe: a DB-level unique index over a jsonb hash is awkward across drivers, so idempotency for events is enforced in the ingest layer (Task 7) by deleting existing rows for an `(eventType, date)` batch window before inserting. Documented there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate the migration**

Run: `DATABASE_URL=postgresql://x npx drizzle-kit generate`
Expected: a SQL file appears under `drizzle/` creating the three tables. (No DB connection needed for `generate`.)

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts tests/schema.test.ts drizzle/
git commit -m "feat(db): generic 3-table schema + initial migration"
```

---

## Task 3: HAE date parser

HAE timestamps look like `2026-06-01 08:00:00 +0000`. `new Date()` parses this unreliably across engines, so normalize to ISO first.

**Files:**
- Create: `lib/hae-date.ts`
- Test: `tests/hae-date.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hae-date.test.ts
import { describe, it, expect } from "vitest";
import { parseHaeDate } from "@/lib/hae-date";

describe("parseHaeDate", () => {
  it("parses UTC offset", () => {
    const d = parseHaeDate("2026-06-01 08:00:00 +0000");
    expect(d.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });
  it("parses positive offset into UTC", () => {
    const d = parseHaeDate("2026-06-01 10:00:00 +0200");
    expect(d.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });
  it("throws on garbage", () => {
    expect(() => parseHaeDate("not a date")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hae-date.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/hae-date.ts`**

```typescript
// Health Auto Export emits "yyyy-MM-dd HH:mm:ss Z" where Z is "+0000" style.
// Convert to a strict ISO 8601 string ("...T...+00:00") before constructing Date,
// because Date parsing of the space/compact-offset form is engine-dependent.
const HAE_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/;

export function parseHaeDate(input: string): Date {
  const m = HAE_DATE_RE.exec(input.trim());
  if (!m) throw new Error(`Unparseable HAE date: ${input}`);
  const [, y, mo, d, h, mi, s, offH, offM] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${offH}:${offM}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid HAE date: ${input}`);
  return date;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hae-date.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hae-date.ts tests/hae-date.test.ts
git commit -m "feat: HAE date parser"
```

---

## Task 4: Auth helper

**Files:**
- Create: `lib/auth.ts`, `lib/env.ts`
- Test: `tests/auth.test.ts`

- [ ] **Step 1: Create `lib/env.ts`** (no test needed — thin accessor)

```typescript
// Central, validated access to required env vars. Throws early with a clear
// message instead of leaking `undefined` into queries or auth checks.
export function requireEnv(name: "DATABASE_URL" | "MCP_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/auth.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { secretOk } from "@/lib/auth";

beforeEach(() => {
  process.env.MCP_SECRET = "s3cr3t";
});

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("secretOk", () => {
  it("accepts a correct Authorization: Bearer header", () => {
    expect(secretOk(req("https://x/api/mcp", { authorization: "Bearer s3cr3t" }))).toBe(true);
  });
  it("accepts a correct ?key query param", () => {
    expect(secretOk(req("https://x/api/mcp?key=s3cr3t"))).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(secretOk(req("https://x/api/mcp?key=nope"))).toBe(false);
  });
  it("rejects a missing secret", () => {
    expect(secretOk(req("https://x/api/mcp"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `lib/auth.ts`**

```typescript
import { requireEnv } from "@/lib/env";

// Accepts the shared secret either as `Authorization: Bearer <secret>` (clean for
// Claude Code) or as a `?key=<secret>` query param (claude.ai web/mobile, where the
// connector URL is /mcp/<secret> rewritten to /api/mcp?key=<secret>). Constant-time-ish
// compare via length+equality is sufficient for a single personal user.
export function secretOk(req: Request): boolean {
  const expected = requireEnv("MCP_SECRET");
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7) === expected) return true;
  const key = new URL(req.url).searchParams.get("key");
  return key === expected;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/auth.ts lib/env.ts tests/auth.test.ts
git commit -m "feat: shared-secret auth (header or ?key)"
```

---

## Task 5: HAE payload Zod schema

**Files:**
- Create: `lib/hae-schema.ts`
- Test: `tests/hae-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hae-schema.test.ts
import { describe, it, expect } from "vitest";
import { haePayloadSchema } from "@/lib/hae-schema";

describe("haePayloadSchema", () => {
  it("accepts a minimal metrics payload", () => {
    const r = haePayloadSchema.safeParse({
      data: { metrics: [{ name: "step_count", units: "count", data: [{ date: "2026-06-01 08:00:00 +0000", qty: 100 }] }] },
    });
    expect(r.success).toBe(true);
  });
  it("passes through unknown point fields", () => {
    const r = haePayloadSchema.safeParse({
      data: { metrics: [{ name: "blood_glucose", units: "mg/dL", data: [{ date: "2026-06-01 08:00:00 +0000", qty: 95, mealTime: "Before Meal" }] }] },
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-object body", () => {
    expect(haePayloadSchema.safeParse(42).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hae-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/hae-schema.ts`**

```typescript
import { z } from "zod";

// Lenient on purpose: HAE has 150+ metric types and adds fields per type
// (Min/Avg/Max, systolic/diastolic, mealTime, ...). We validate the envelope and
// let the normalizer (lib/ingest.ts) branch on the actual fields. `.passthrough`
// keeps unknown keys so nothing is dropped before normalization.
const point = z.object({ date: z.string() }).passthrough();

const metric = z.object({
  name: z.string(),
  units: z.string().optional(),
  data: z.array(point).default([]),
});

const valueWithUnits = z.object({ qty: z.number(), units: z.string().optional() }).passthrough();

const workout = z.object({
  id: z.string(),
  name: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  duration: z.number().optional(),
  activeEnergyBurned: valueWithUnits.optional(),
  distance: valueWithUnits.optional(),
  avgHeartRate: valueWithUnits.optional(),
  maxHeartRate: valueWithUnits.optional(),
  stepCount: valueWithUnits.optional(),
  route: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough();

const event = z.object({ date: z.string().optional() }).passthrough();

export const haePayloadSchema = z.object({
  data: z.object({
    metrics: z.array(metric).default([]),
    workouts: z.array(workout).default([]),
    ecg: z.array(event).default([]),
    stateOfMind: z.array(event).default([]),
    symptoms: z.array(event).default([]),
    medications: z.array(event).default([]),
    cycleTracking: z.array(event).default([]),
    heartRateNotifications: z.array(event).default([]),
  }),
});

export type HaePayload = z.infer<typeof haePayloadSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hae-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hae-schema.ts tests/hae-schema.test.ts
git commit -m "feat: lenient Zod schema for HAE payload envelope"
```

---

## Task 6: Ingest normalizer (pure)

Transforms a validated HAE payload into plain row arrays. Pure (no DB) → fully unit-testable. This is the heart of the ingest path.

**Files:**
- Create: `lib/ingest.ts`
- Test: `tests/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ingest.test.ts
import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/ingest";

const D = "2026-06-01 08:00:00 +0000";

describe("normalize", () => {
  it("maps a scalar metric point to qty", () => {
    const { metricRows } = normalize({
      data: { metrics: [{ name: "step_count", units: "count", data: [{ date: D, qty: 100, source: "Watch" }] }],
        workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(metricRows).toHaveLength(1);
    expect(metricRows[0]).toMatchObject({ metricName: "step_count", units: "count", qty: "100", source: "Watch" });
    expect(metricRows[0].date.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });

  it("maps heart-rate Min/Avg/Max", () => {
    const { metricRows } = normalize({
      data: { metrics: [{ name: "heart_rate", units: "count/min", data: [{ date: D, Min: 52, Avg: 61, Max: 74 }] }],
        workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(metricRows[0]).toMatchObject({ min: "52", avg: "61", max: "74", qty: null });
  });

  it("maps blood pressure systolic/diastolic", () => {
    const { metricRows } = normalize({
      data: { metrics: [{ name: "blood_pressure", units: "mmHg", data: [{ date: D, systolic: 120, diastolic: 80 }] }],
        workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(metricRows[0]).toMatchObject({ systolic: "120", diastolic: "80" });
  });

  it("keeps unknown point fields in extra", () => {
    const { metricRows } = normalize({
      data: { metrics: [{ name: "blood_glucose", units: "mg/dL", data: [{ date: D, qty: 95, mealTime: "Before Meal" }] }],
        workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(metricRows[0].extra).toEqual({ mealTime: "Before Meal" });
  });

  it("maps a workout with nested value objects", () => {
    const { workoutRows } = normalize({
      data: { metrics: [], workouts: [{
        id: "w1", name: "Running", start: D, end: "2026-06-01 08:30:00 +0000", duration: 1800,
        activeEnergyBurned: { qty: 250, units: "kcal" }, distance: { qty: 5.1, units: "km" },
        avgHeartRate: { qty: 150 }, maxHeartRate: { qty: 172 }, stepCount: { qty: 5400 },
        route: [{ lat: 1, lon: 2 }],
      }], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(workoutRows[0]).toMatchObject({
      id: "w1", name: "Running", durationS: "1800",
      activeEnergy: "250", activeEnergyUnits: "kcal", distance: "5.1", distanceUnits: "km",
      avgHr: "150", maxHr: "172", stepCount: "5400",
    });
    expect(workoutRows[0].route).toEqual([{ lat: 1, lon: 2 }]);
    expect(workoutRows[0].raw).toBeDefined();
  });

  it("maps long-tail arrays into eventRows tagged by type", () => {
    const { eventRows } = normalize({
      data: { metrics: [], workouts: [],
        ecg: [{ date: D, classification: "Sinus Rhythm" }],
        stateOfMind: [{ date: D, valence: 0.5 }],
        symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    const types = eventRows.map((e) => e.eventType).sort();
    expect(types).toEqual(["ecg", "stateOfMind"]);
    expect(eventRows.find((e) => e.eventType === "ecg")!.payload).toMatchObject({ classification: "Sinus Rhythm" });
  });

  it("skips metric points with an unparseable date instead of throwing", () => {
    const { metricRows, skipped } = normalize({
      data: { metrics: [{ name: "step_count", data: [{ date: "garbage", qty: 1 }, { date: D, qty: 2 }] }],
        workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(metricRows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/ingest.ts`**

```typescript
import { parseHaeDate } from "@/lib/hae-date";
import type { HaePayload } from "@/lib/hae-schema";

// Drizzle's numeric columns are read/written as strings, so we store stringified
// numbers to match the insert types exactly.
function num(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : null;
}

export type MetricRow = {
  metricName: string;
  units: string | null;
  date: Date;
  qty: string | null;
  min: string | null;
  avg: string | null;
  max: string | null;
  systolic: string | null;
  diastolic: string | null;
  source: string | null;
  extra: Record<string, unknown> | null;
};

export type WorkoutRow = {
  id: string;
  name: string | null;
  start: Date | null;
  end: Date | null;
  durationS: string | null;
  activeEnergy: string | null;
  activeEnergyUnits: string | null;
  distance: string | null;
  distanceUnits: string | null;
  avgHr: string | null;
  maxHr: string | null;
  stepCount: string | null;
  route: unknown[] | null;
  raw: Record<string, unknown>;
};

export type EventRow = {
  eventType: string;
  date: Date;
  source: string | null;
  payload: Record<string, unknown>;
};

export type NormalizeResult = {
  metricRows: MetricRow[];
  workoutRows: WorkoutRow[];
  eventRows: EventRow[];
  skipped: number; // points dropped due to bad/missing dates
};

// Reserved point keys that map to dedicated columns; everything else → extra.
const KNOWN_POINT_KEYS = new Set([
  "date", "qty", "Min", "Avg", "Max", "systolic", "diastolic", "source",
]);

const EVENT_TYPES = [
  "ecg", "stateOfMind", "symptoms", "medications", "cycleTracking", "heartRateNotifications",
] as const;

function safeDate(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  try {
    return parseHaeDate(s);
  } catch {
    return null;
  }
}

export function normalize(payload: HaePayload): NormalizeResult {
  const metricRows: MetricRow[] = [];
  const workoutRows: WorkoutRow[] = [];
  const eventRows: EventRow[] = [];
  let skipped = 0;

  for (const metric of payload.data.metrics) {
    for (const p of metric.data as Record<string, unknown>[]) {
      const date = safeDate(p.date);
      if (!date) { skipped++; continue; }
      const extra: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (!KNOWN_POINT_KEYS.has(k)) extra[k] = v;
      }
      metricRows.push({
        metricName: metric.name,
        units: metric.units ?? null,
        date,
        qty: num(p.qty),
        min: num(p.Min),
        avg: num(p.Avg),
        max: num(p.Max),
        systolic: num(p.systolic),
        diastolic: num(p.diastolic),
        source: typeof p.source === "string" ? p.source : null,
        extra: Object.keys(extra).length ? extra : null,
      });
    }
  }

  for (const w of payload.data.workouts as Record<string, any>[]) {
    workoutRows.push({
      id: w.id,
      name: w.name ?? null,
      start: safeDate(w.start),
      end: safeDate(w.end),
      durationS: num(w.duration),
      activeEnergy: num(w.activeEnergyBurned?.qty),
      activeEnergyUnits: w.activeEnergyBurned?.units ?? null,
      distance: num(w.distance?.qty),
      distanceUnits: w.distance?.units ?? null,
      avgHr: num(w.avgHeartRate?.qty),
      maxHr: num(w.maxHeartRate?.qty),
      stepCount: num(w.stepCount?.qty),
      route: Array.isArray(w.route) ? w.route : null,
      raw: w,
    });
  }

  for (const eventType of EVENT_TYPES) {
    for (const e of payload.data[eventType] as Record<string, unknown>[]) {
      const date = safeDate(e.date);
      if (!date) { skipped++; continue; }
      eventRows.push({
        eventType,
        date,
        source: typeof e.source === "string" ? e.source : null,
        payload: e,
      });
    }
  }

  return { metricRows, workoutRows, eventRows, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingest.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest.ts tests/ingest.test.ts
git commit -m "feat: pure HAE payload normalizer"
```

---

## Task 7: Test DB helper + ingest persistence

Now wire normalized rows into Postgres with idempotent upserts, tested against PGlite.

**Files:**
- Create: `tests/helpers/db.ts`, `lib/persist.ts`
- Test: `tests/persist.test.ts`

- [ ] **Step 1: Create `tests/helpers/db.ts`** (in-memory Postgres + schema)

```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

// Spin up an isolated in-memory Postgres, apply the committed Drizzle migrations,
// and return a typed db. Each test gets its own instance → no cross-test leakage.
export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export type TestDb = Awaited<ReturnType<typeof makeTestDb>>;
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/persist.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./helpers/db";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { metricSamples, workouts, healthEvents } from "@/db/schema";

const D = "2026-06-01 08:00:00 +0000";

function payload() {
  return normalize({
    data: {
      metrics: [{ name: "step_count", units: "count", data: [{ date: D, qty: 100, source: "Watch" }] }],
      workouts: [{ id: "w1", name: "Running", start: D, end: D, duration: 1800, activeEnergyBurned: { qty: 250, units: "kcal" } }],
      ecg: [{ date: D, classification: "Sinus Rhythm" }],
      stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [],
    },
  });
}

describe("persist", () => {
  it("inserts metric, workout, and event rows", async () => {
    const db = await makeTestDb();
    const summary = await persist(db, payload());
    expect(summary).toEqual({ metricsStored: 1, workoutsStored: 1, eventsStored: 1 });
    expect(await db.select().from(metricSamples)).toHaveLength(1);
    expect(await db.select().from(workouts)).toHaveLength(1);
    expect(await db.select().from(healthEvents)).toHaveLength(1);
  });

  it("is idempotent on re-push (no duplicate rows)", async () => {
    const db = await makeTestDb();
    await persist(db, payload());
    await persist(db, payload()); // same batch again
    expect(await db.select().from(metricSamples)).toHaveLength(1);
    expect(await db.select().from(workouts)).toHaveLength(1);
    expect(await db.select().from(healthEvents)).toHaveLength(1); // event dedupe by (type,date,payload)
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/persist.test.ts`
Expected: FAIL — cannot find `@/lib/persist`.

- [ ] **Step 4: Create `lib/persist.ts`**

```typescript
import { and, eq, sql } from "drizzle-orm";
import { metricSamples, workouts, healthEvents } from "@/db/schema";
import type { NormalizeResult } from "@/lib/ingest";

// Accepts any Drizzle db bound to our schema (neon-http in prod, PGlite in tests).
type Db = {
  insert: (...a: any[]) => any;
  delete: (...a: any[]) => any;
  select: (...a: any[]) => any;
};

export type IngestSummary = {
  metricsStored: number;
  workoutsStored: number;
  eventsStored: number;
};

// Persist normalized rows idempotently:
// - metric_samples: ON CONFLICT (metric_name,date,source) DO NOTHING (unique index).
// - workouts: ON CONFLICT (id) DO UPDATE (latest wins).
// - health_events: delete existing rows matching (event_type,date,payload) then insert,
//   since a portable jsonb-hash unique index isn't available across drivers.
export async function persist(db: Db, data: NormalizeResult): Promise<IngestSummary> {
  if (data.metricRows.length) {
    await db
      .insert(metricSamples)
      .values(data.metricRows)
      .onConflictDoNothing({
        target: [metricSamples.metricName, metricSamples.date, metricSamples.source],
      });
  }

  for (const w of data.workoutRows) {
    await db
      .insert(workouts)
      .values(w)
      .onConflictDoUpdate({ target: workouts.id, set: w });
  }

  for (const e of data.eventRows) {
    await db
      .delete(healthEvents)
      .where(
        and(
          eq(healthEvents.eventType, e.eventType),
          eq(healthEvents.date, e.date),
          sql`${healthEvents.payload}::text = ${JSON.stringify(e.payload)}`,
        ),
      );
    await db.insert(healthEvents).values(e);
  }

  return {
    metricsStored: data.metricRows.length,
    workoutsStored: data.workoutRows.length,
    eventsStored: data.eventRows.length,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/persist.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/persist.ts tests/helpers/db.ts tests/persist.test.ts
git commit -m "feat: idempotent persistence + PGlite test harness"
```

---

## Task 8: Production DB client + ingest route

**Files:**
- Create: `lib/db.ts`, `app/api/ingest/route.ts`
- Test: `tests/ingest-route.test.ts`

- [ ] **Step 1: Create `lib/db.ts`**

```typescript
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/db/schema";
import { requireEnv } from "@/lib/env";

// Neon HTTP driver — serverless-friendly (no pooled connection to manage on Vercel).
export const db = drizzle(neon(requireEnv("DATABASE_URL")), { schema });
```

- [ ] **Step 2: Write the failing test** (route logic, calling the exported POST with a mock db via the persist path; we test the HTTP contract with a stubbed body and a PGlite db injected through a thin handler factory)

```typescript
// tests/ingest-route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "./helpers/db";
import { handleIngest } from "@/app/api/ingest/route";
import { metricSamples } from "@/db/schema";

const D = "2026-06-01 08:00:00 +0000";
beforeEach(() => { process.env.MCP_SECRET = "s3cr3t"; });

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://x/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("handleIngest", () => {
  it("401s without the secret", async () => {
    const db = await makeTestDb();
    const res = await handleIngest(post({ data: { metrics: [] } }), db);
    expect(res.status).toBe(401);
  });

  it("stores metrics and returns a summary", async () => {
    const db = await makeTestDb();
    const body = { data: { metrics: [{ name: "step_count", units: "count", data: [{ date: D, qty: 100 }] }] } };
    const res = await handleIngest(post(body, { authorization: "Bearer s3cr3t" }), db);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ metricsStored: 1 });
    expect(await db.select().from(metricSamples)).toHaveLength(1);
  });

  it("400s on a malformed body", async () => {
    const db = await makeTestDb();
    const res = await handleIngest(post(42, { authorization: "Bearer s3cr3t" }), db);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ingest-route.test.ts`
Expected: FAIL — `handleIngest` not exported.

- [ ] **Step 4: Create `app/api/ingest/route.ts`**

```typescript
import { secretOk } from "@/lib/auth";
import { haePayloadSchema } from "@/lib/hae-schema";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { db as prodDb } from "@/lib/db";

export const maxDuration = 60; // App Router: must be a route export, not vercel.json.

// Core handler takes the db explicitly so tests can inject a PGlite instance.
export async function handleIngest(req: Request, db: typeof prodDb): Promise<Response> {
  if (!secretOk(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = haePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", detail: parsed.error.issues }, { status: 400 });
  }
  const normalized = normalize(parsed.data);
  const summary = await persist(db, normalized);
  // 200 with a summary so Health Auto Export never retry-storms on partial skips.
  return Response.json({ ...summary, skipped: normalized.skipped }, { status: 200 });
}

export function POST(req: Request) {
  return handleIngest(req, prodDb);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ingest-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts app/api/ingest/route.ts tests/ingest-route.test.ts
git commit -m "feat: /api/ingest route (bearer-gated, validated, idempotent)"
```

---

## Task 9: Read tools — list_metrics, query_metric, list_workouts, query_events

Each tool is a pure function over a db instance. Tested with PGlite + seeded rows.

**Files:**
- Create: `lib/tools/list-metrics.ts`, `lib/tools/query-metric.ts`, `lib/tools/list-workouts.ts`, `lib/tools/query-events.ts`
- Test: `tests/tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./helpers/db";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { listMetrics } from "@/lib/tools/list-metrics";
import { queryMetric } from "@/lib/tools/query-metric";
import { listWorkouts } from "@/lib/tools/list-workouts";
import { queryEvents } from "@/lib/tools/query-events";

async function seeded() {
  const db = await makeTestDb();
  await persist(db, normalize({
    data: {
      metrics: [{ name: "heart_rate", units: "count/min", data: [
        { date: "2026-06-01 08:00:00 +0000", Avg: 60 },
        { date: "2026-06-01 09:00:00 +0000", Avg: 80 },
      ] }],
      workouts: [{ id: "w1", name: "Running", start: "2026-06-01 08:00:00 +0000", end: "2026-06-01 08:30:00 +0000", duration: 1800 }],
      ecg: [{ date: "2026-06-01 08:00:00 +0000", classification: "Sinus Rhythm" }],
      stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [],
    },
  }));
  return db;
}

describe("tools", () => {
  it("list_metrics returns names, units, counts, range", async () => {
    const rows = await listMetrics(await seeded());
    expect(rows).toEqual([
      expect.objectContaining({ metricName: "heart_rate", units: "count/min", sampleCount: 2 }),
    ]);
  });

  it("query_metric avg aggregation averages avg column", async () => {
    const r = await queryMetric(await seeded(), {
      name: "heart_rate", start: "2026-06-01", end: "2026-06-02", aggregation: "avg",
    });
    expect(r.aggregate).toBeCloseTo(70); // (60+80)/2
  });

  it("query_metric raw returns both points", async () => {
    const r = await queryMetric(await seeded(), {
      name: "heart_rate", start: "2026-06-01", end: "2026-06-02", aggregation: "raw",
    });
    expect(r.points).toHaveLength(2);
  });

  it("list_workouts returns the workout in range", async () => {
    const rows = await listWorkouts(await seeded(), { start: "2026-06-01", end: "2026-06-02" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "w1", name: "Running" });
  });

  it("query_events returns ecg events", async () => {
    const rows = await queryEvents(await seeded(), { eventType: "ecg", start: "2026-06-01", end: "2026-06-02" });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ classification: "Sinus Rhythm" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `lib/tools/list-metrics.ts`**

```typescript
import { sql } from "drizzle-orm";
import { metricSamples } from "@/db/schema";

// Discovery: which metric types exist, their units, sample counts, and date span.
// Lets Claude pick valid `name` values before calling query_metric.
export async function listMetrics(db: any) {
  return db
    .select({
      metricName: metricSamples.metricName,
      units: metricSamples.units,
      sampleCount: sql<number>`count(*)::int`,
      firstDate: sql<string>`min(${metricSamples.date})`,
      lastDate: sql<string>`max(${metricSamples.date})`,
    })
    .from(metricSamples)
    .groupBy(metricSamples.metricName, metricSamples.units)
    .orderBy(metricSamples.metricName);
}
```

- [ ] **Step 4: Create `lib/tools/query-metric.ts`**

```typescript
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { metricSamples } from "@/db/schema";

export type Aggregation = "raw" | "hourly" | "daily" | "avg" | "sum" | "min" | "max";

export type QueryMetricArgs = {
  name: string;
  start: string; // ISO date or datetime
  end: string;
  aggregation: Aggregation;
};

// The value of a sample: scalar metrics use qty, HR-style use avg. COALESCE picks
// whichever is present so aggregation works uniformly across metric shapes.
const valueExpr = sql<number>`coalesce(${metricSamples.qty}, ${metricSamples.avg})`;

export async function queryMetric(db: any, args: QueryMetricArgs) {
  const { name, start, end, aggregation } = args;
  const range = and(
    eq(metricSamples.metricName, name),
    gte(metricSamples.date, new Date(start)),
    lt(metricSamples.date, new Date(end)),
  );

  if (aggregation === "raw") {
    const points = await db
      .select({ date: metricSamples.date, qty: metricSamples.qty, min: metricSamples.min, avg: metricSamples.avg, max: metricSamples.max, systolic: metricSamples.systolic, diastolic: metricSamples.diastolic })
      .from(metricSamples).where(range).orderBy(asc(metricSamples.date));
    return { name, aggregation, points };
  }

  if (aggregation === "hourly" || aggregation === "daily") {
    const bucket = aggregation === "hourly"
      ? sql<string>`date_trunc('hour', ${metricSamples.date})`
      : sql<string>`date_trunc('day', ${metricSamples.date})`;
    const points = await db
      .select({ bucket, avg: sql<number>`avg(${valueExpr})`, sum: sql<number>`sum(${valueExpr})`, count: sql<number>`count(*)::int` })
      .from(metricSamples).where(range).groupBy(bucket).orderBy(bucket);
    return { name, aggregation, points };
  }

  // Scalar aggregates over the whole range.
  const fn = { avg: sql`avg(${valueExpr})`, sum: sql`sum(${valueExpr})`, min: sql`min(${valueExpr})`, max: sql`max(${valueExpr})` }[aggregation];
  const [row] = await db.select({ aggregate: sql<number>`${fn}` }).from(metricSamples).where(range);
  return { name, aggregation, aggregate: row?.aggregate == null ? null : Number(row.aggregate) };
}
```

- [ ] **Step 5: Create `lib/tools/list-workouts.ts`**

```typescript
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { workouts } from "@/db/schema";

export type ListWorkoutsArgs = { start: string; end: string; type?: string };

export async function listWorkouts(db: any, args: ListWorkoutsArgs) {
  const where = [gte(workouts.start, new Date(args.start)), lt(workouts.start, new Date(args.end))];
  if (args.type) where.push(eq(workouts.name, args.type));
  return db
    .select({
      id: workouts.id, name: workouts.name, start: workouts.start, end: workouts.end,
      durationS: workouts.durationS, activeEnergy: workouts.activeEnergy, distance: workouts.distance,
      avgHr: workouts.avgHr, maxHr: workouts.maxHr, stepCount: workouts.stepCount,
    })
    .from(workouts).where(and(...where)).orderBy(asc(workouts.start));
}
```

- [ ] **Step 6: Create `lib/tools/query-events.ts`**

```typescript
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { healthEvents } from "@/db/schema";

export type QueryEventsArgs = { eventType: string; start: string; end: string };

export async function queryEvents(db: any, args: QueryEventsArgs) {
  return db
    .select({ eventType: healthEvents.eventType, date: healthEvents.date, source: healthEvents.source, payload: healthEvents.payload })
    .from(healthEvents)
    .where(and(eq(healthEvents.eventType, args.eventType), gte(healthEvents.date, new Date(args.start)), lt(healthEvents.date, new Date(args.end))))
    .orderBy(asc(healthEvents.date));
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/tools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add lib/tools/list-metrics.ts lib/tools/query-metric.ts lib/tools/list-workouts.ts lib/tools/query-events.ts tests/tools.test.ts
git commit -m "feat: list_metrics, query_metric, list_workouts, query_events tools"
```

---

## Task 10: latest_snapshot + health_sql tools

**Files:**
- Create: `lib/tools/latest-snapshot.ts`, `lib/tools/health-sql.ts`
- Test: `tests/snapshot-sql.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/snapshot-sql.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "./helpers/db";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { latestSnapshot } from "@/lib/tools/latest-snapshot";
import { healthSql, assertReadOnly } from "@/lib/tools/health-sql";

async function seeded() {
  const db = await makeTestDb();
  await persist(db, normalize({
    data: {
      metrics: [{ name: "step_count", units: "count", data: [
        { date: "2026-06-01 08:00:00 +0000", qty: 100 },
        { date: "2026-06-02 08:00:00 +0000", qty: 250 },
      ] }],
      workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [],
    },
  }));
  return db;
}

describe("latest_snapshot", () => {
  it("returns the most recent value per metric", async () => {
    const snap = await latestSnapshot(await seeded());
    const step = snap.find((s: any) => s.metricName === "step_count");
    expect(step.value).toBe("250");
  });
});

describe("health_sql guard", () => {
  it("allows a single SELECT", () => {
    expect(() => assertReadOnly("SELECT count(*) FROM metric_samples")).not.toThrow();
  });
  it("allows a WITH/CTE select", () => {
    expect(() => assertReadOnly("WITH x AS (SELECT 1) SELECT * FROM x")).not.toThrow();
  });
  it("rejects INSERT", () => {
    expect(() => assertReadOnly("INSERT INTO metric_samples DEFAULT VALUES")).toThrow();
  });
  it("rejects multi-statement", () => {
    expect(() => assertReadOnly("SELECT 1; DROP TABLE workouts")).toThrow();
  });
  it("runs a select and returns rows", async () => {
    const rows = await healthSql(await seeded(), "SELECT count(*)::int AS n FROM metric_samples");
    expect(rows[0].n).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshot-sql.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `lib/tools/latest-snapshot.ts`**

```typescript
import { sql } from "drizzle-orm";
import { metricSamples } from "@/db/schema";

// Most-recent sample per metric — the quick "how am I doing right now" answer.
// DISTINCT ON (metric_name) ordered by date DESC picks the latest row per metric.
export async function latestSnapshot(db: any) {
  return db.execute(sql`
    SELECT DISTINCT ON (metric_name)
      metric_name AS "metricName",
      units,
      date,
      coalesce(qty, avg)::text AS value
    FROM metric_samples
    ORDER BY metric_name, date DESC
  `).then((r: any) => r.rows ?? r);
}
```

> Note: `db.execute` returns `{ rows }` on neon-http and an array-like on PGlite; the `.then` normalizes both. Keep this shape consistent in `health_sql` below.

- [ ] **Step 4: Create `lib/tools/health-sql.ts`**

```typescript
import { sql } from "drizzle-orm";

// Read-only guard: the statement must be a single SELECT or WITH…SELECT, with no
// statement separator. This is the code-level safety net; the README also documents
// pointing health_sql at a Postgres role granted only SELECT for defense in depth.
export function assertReadOnly(query: string): void {
  const trimmed = query.trim().replace(/;\s*$/, ""); // allow one trailing semicolon
  if (trimmed.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error("Only read-only SELECT/WITH queries are allowed.");
  return;
}

export async function healthSql(db: any, query: string) {
  assertReadOnly(query);
  const result = await db.execute(sql.raw(query));
  return result.rows ?? result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/snapshot-sql.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/tools/latest-snapshot.ts lib/tools/health-sql.ts tests/snapshot-sql.test.ts
git commit -m "feat: latest_snapshot + read-only health_sql tools"
```

---

## Task 11: MCP route (registers 6 tools, auth-wrapped)

**Files:**
- Create: `app/api/[transport]/route.ts`
- Test: `tests/mcp-route.test.ts`

- [ ] **Step 1: Write the failing test** (auth gating of the exported handler)

```typescript
// tests/mcp-route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/[transport]/route";

beforeEach(() => { process.env.MCP_SECRET = "s3cr3t"; process.env.DATABASE_URL = "postgresql://x"; });

describe("mcp route auth", () => {
  it("401s without the secret", async () => {
    const res = await POST(new Request("https://x/api/mcp", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Create `app/api/[transport]/route.ts`**

```typescript
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { secretOk } from "@/lib/auth";
import { db } from "@/lib/db";
import { listMetrics } from "@/lib/tools/list-metrics";
import { queryMetric } from "@/lib/tools/query-metric";
import { listWorkouts } from "@/lib/tools/list-workouts";
import { queryEvents } from "@/lib/tools/query-events";
import { latestSnapshot } from "@/lib/tools/latest-snapshot";
import { healthSql } from "@/lib/tools/health-sql";

export const maxDuration = 60;

// Wrap each tool's JSON result in the MCP text-content envelope.
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true });

const handler = createMcpHandler((server) => {
  server.registerTool("list_metrics",
    { title: "List metrics", description: "List available Apple Health metric types with units, sample counts, and date ranges.", inputSchema: {} },
    async () => ok(await listMetrics(db)));

  server.registerTool("query_metric",
    { title: "Query a metric", description: "Query a metric over a date range. aggregation: raw|hourly|daily|avg|sum|min|max.",
      inputSchema: { name: z.string(), start: z.string(), end: z.string(),
        aggregation: z.enum(["raw", "hourly", "daily", "avg", "sum", "min", "max"]).default("daily") } },
    async (a) => ok(await queryMetric(db, a)));

  server.registerTool("list_workouts",
    { title: "List workouts", description: "List workouts in a date range, optionally filtered by type.",
      inputSchema: { start: z.string(), end: z.string(), type: z.string().optional() } },
    async (a) => ok(await listWorkouts(db, a)));

  server.registerTool("query_events",
    { title: "Query health events", description: "Query long-tail data: ecg, stateOfMind, symptoms, medications, cycleTracking, heartRateNotifications.",
      inputSchema: { eventType: z.enum(["ecg", "stateOfMind", "symptoms", "medications", "cycleTracking", "heartRateNotifications"]),
        start: z.string(), end: z.string() } },
    async (a) => ok(await queryEvents(db, a)));

  server.registerTool("latest_snapshot",
    { title: "Latest snapshot", description: "Most recent value for every metric — a quick current-status overview.", inputSchema: {} },
    async () => ok(await latestSnapshot(db)));

  server.registerTool("health_sql",
    { title: "Read-only SQL", description: "Run a single read-only SELECT/WITH query over tables: metric_samples, workouts, health_events.",
      inputSchema: { query: z.string() } },
    async ({ query }) => {
      try { return ok(await healthSql(db, query)); }
      catch (e) { return fail(e instanceof Error ? e.message : "query failed"); }
    });
});

// Gate the whole MCP endpoint on the shared secret (header or ?key).
async function authed(req: Request): Promise<Response> {
  if (!secretOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return handler(req);
}

export { authed as GET, authed as POST };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-route.test.ts`
Expected: PASS (1 test). The 401 path returns before any DB/tool call.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/[transport]/route.ts tests/mcp-route.test.ts
git commit -m "feat: remote MCP route with 6 tools, secret-gated"
```

---

## Task 12: README (self-host guide) + minimal root page

**Files:**
- Create: `README.md`, `app/page.tsx`, `app/layout.tsx`

- [ ] **Step 1: Create `app/layout.tsx`** (Next requires a root layout)

```tsx
export const metadata = { title: "apple-health-mcp", description: "Apple Health data as a remote MCP server for Claude." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create `app/page.tsx`** (tiny landing so the deploy has a root)

```tsx
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>apple-health-mcp</h1>
      <p>A remote MCP server that exposes Apple Watch / Apple Health data to Claude. The MCP endpoint is at <code>/api/mcp</code> (secret required). See the README to self-host.</p>
    </main>
  );
}
```

- [ ] **Step 3: Create `README.md`**

````markdown
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
5. **Connect Claude:**
   - **Web / mobile / desktop:** add a Custom Connector with URL
     `https://<your-app>.vercel.app/mcp/<MCP_SECRET>`
   - **Claude Code:**
     `claude mcp add --transport http apple-health https://<your-app>.vercel.app/api/mcp --header "Authorization: Bearer <MCP_SECRET>"`

## Security notes

- The secret-in-URL form (`/mcp/<secret>`) is what makes claude.ai web/mobile work
  without OAuth. Treat that URL like a password; it can appear in logs.
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
````

- [ ] **Step 4: Run the suite once more**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md app/page.tsx app/layout.tsx
git commit -m "docs: README self-host guide + root page"
```

---

## Task 13: Publish + deploy

**Files:** none (operational)

- [ ] **Step 1: Create the public GitHub repo (personal account)**

Run: `cd ~/GitHub/apple-health-mcp && gh repo create apple-health-mcp --public --source=. --remote=origin --description "Apple Watch / Apple Health data as a remote MCP server for Claude" --push`
Expected: repo created under your personal account, `main` pushed.

- [ ] **Step 2: Link the Vercel personal account project**

Run: `vercel link --scope <your-personal-username>`
Expected: prompts to link; choose the personal scope (NOT the team).
> If `vercel` is logged into the team by default, run `vercel switch <personal-username>` first, or `vercel login` with the personal account.

- [ ] **Step 3: Set env vars on Vercel (personal)**

```bash
vercel env add DATABASE_URL production
vercel env add MCP_SECRET production
```
Expected: paste each value when prompted.

- [ ] **Step 4: Provision Neon + run migrations against production**

Provision Neon via the Vercel dashboard (Storage → Marketplace → Neon) on the personal account, then:
Run: `DATABASE_URL="<neon prod url>" npm run db:migrate`
Expected: three tables created.

- [ ] **Step 5: Deploy**

Run: `vercel --prod`
Expected: a production URL. (Build only runs here — never run builds earlier per project policy.)

- [ ] **Step 6: Smoke-test ingest**

```bash
curl -s -X POST "https://<app>.vercel.app/api/ingest" \
  -H "Authorization: Bearer $MCP_SECRET" -H "content-type: application/json" \
  -d '{"data":{"metrics":[{"name":"step_count","units":"count","data":[{"date":"2026-06-01 08:00:00 +0000","qty":123}]}]}}'
```
Expected: `{"metricsStored":1,...}`.

- [ ] **Step 7: Configure Health Auto Export + add the connector to Claude**

Follow README steps 4–5. Verify in Claude: ask "list my health metrics" → `list_metrics` returns the seeded `step_count`.

---

## Self-Review

**Spec coverage:**
- All-surfaces remote MCP → Task 11 (mcp-handler route) + Task 1 rewrite + README connector steps. ✓
- Always-fresh ingest → Task 8 ingest route + README HAE automation. ✓
- Bearer auth (secret-in-URL + header) → Task 4 auth + Task 1 rewrite. ✓
- 3 generic tables → Task 2. ✓
- Comprehensive data (metrics + workouts + 6 event types) → Task 6 normalizer + Task 7 persist. ✓
- 6 tools incl. read-only health_sql → Tasks 9–11. ✓
- Idempotent re-push → Task 7 (metric unique index, workout upsert, event delete-then-insert) + test. ✓
- HAE payload shape (qty / Min,Avg,Max / systolic,diastolic / mealTime / workout value objects / route) → Task 6 tests. ✓
- Public repo, MIT, secrets never committed → Tasks 1 (.gitignore, .env.example, LICENSE), 12 (README), 13 (public repo). ✓
- Vercel personal account → Task 13 explicit scope steps. ✓
- Vitest, no live DB → PGlite harness Task 7. ✓

**Placeholder scan:** none — every code/test step has full content.

**Type consistency:** `normalize` → `NormalizeResult` consumed by `persist`; row field names (`metricName`, `durationS`, `activeEnergy`, …) match `db/schema.ts`; `secretOk` used identically in ingest + mcp routes; `assertReadOnly`/`healthSql` names match across tool + test; `queryMetric` `Aggregation` enum matches the route's `z.enum`. ✓
