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
