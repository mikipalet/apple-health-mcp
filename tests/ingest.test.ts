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

  it("handles workout fields that arrive as arrays (e.g. stepCount) without rejecting", () => {
    const { workoutRows } = normalize({
      data: { metrics: [], workouts: [{
        id: "w2", name: "Walking", start: D, end: D, duration: 600,
        activeEnergyBurned: { qty: 50, units: "kcal" },
        // HAE can send stepCount as an array of per-interval samples:
        stepCount: [{ date: D, qty: 100 }, { date: D, qty: 200 }],
      }], ecg: [], stateOfMind: [], symptoms: [], medications: [], cycleTracking: [], heartRateNotifications: [] },
    });
    expect(workoutRows).toHaveLength(1);
    expect(workoutRows[0]).toMatchObject({ id: "w2", activeEnergy: "50", stepCount: "300" }); // summed
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
