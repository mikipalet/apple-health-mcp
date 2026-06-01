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
