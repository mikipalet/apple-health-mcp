import { sql } from "drizzle-orm";

// Most-recent sample per metric — the quick "how am I doing right now" answer.
// DISTINCT ON (metric_name) ordered by date DESC picks the latest row per metric.
export async function latestSnapshot(db: any) {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (metric_name)
      metric_name AS "metricName",
      units,
      date,
      coalesce(qty, avg)::text AS value
    FROM metric_samples
    ORDER BY metric_name, date DESC
  `);
  // db.execute returns { rows } on neon-http and an array-like on PGlite.
  return result.rows ?? result;
}
