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
