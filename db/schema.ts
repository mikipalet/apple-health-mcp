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
    // (metric, timestamp, source).
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
