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
          // jsonb semantic equality (ignores whitespace + key order), unlike a
          // ::text compare against JSON.stringify which would never match.
          sql`${healthEvents.payload} = ${JSON.stringify(e.payload)}::jsonb`,
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
