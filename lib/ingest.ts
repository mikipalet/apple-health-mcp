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

// Workout value fields are usually `{ qty, units }` objects, but some (e.g.
// stepCount) arrive as arrays of per-interval samples. Extract a scalar total:
// read `.qty` from an object, or sum `.qty` across an array.
function workoutQty(v: unknown): string | null {
  if (Array.isArray(v)) {
    let sum = 0;
    let seen = false;
    for (const item of v) {
      const q = (item as { qty?: unknown })?.qty;
      if (typeof q === "number" && Number.isFinite(q)) { sum += q; seen = true; }
    }
    return seen ? String(sum) : null;
  }
  if (v && typeof v === "object") return num((v as { qty?: unknown }).qty);
  return null;
}

// Units live on the value-object (or the first element of an array form).
function workoutUnits(v: unknown): string | null {
  const obj = Array.isArray(v) ? v[0] : v;
  const u = (obj as { units?: unknown })?.units;
  return typeof u === "string" ? u : null;
}

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
      activeEnergy: workoutQty(w.activeEnergyBurned),
      activeEnergyUnits: workoutUnits(w.activeEnergyBurned),
      distance: workoutQty(w.distance),
      distanceUnits: workoutUnits(w.distance),
      avgHr: workoutQty(w.avgHeartRate),
      maxHr: workoutQty(w.maxHeartRate),
      stepCount: workoutQty(w.stepCount),
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
