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

  it("handles a large batch beyond the 65535-bind-parameter single-insert limit", async () => {
    const db = await makeTestDb();
    // 7000 metric points × ~11 columns = 77000 params > 65535: must be chunked.
    const pad = (n: number) => String(n).padStart(2, "0");
    const data = Array.from({ length: 7000 }, (_, i) => {
      const base = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 60000);
      const d = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())} ${pad(base.getUTCHours())}:${pad(base.getUTCMinutes())}:${pad(base.getUTCSeconds())} +0000`;
      return { date: d, qty: i };
    });
    const summary = await persist(db, normalize({
      data: { metrics: [{ name: "step_count", units: "count", data }],
        workouts: [], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    }));
    expect(summary.metricsStored).toBe(7000);
    expect(await db.select().from(metricSamples)).toHaveLength(7000);
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
