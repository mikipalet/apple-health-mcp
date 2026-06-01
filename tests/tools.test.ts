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
