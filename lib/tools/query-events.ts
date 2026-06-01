import { and, asc, eq, gte, lt } from "drizzle-orm";
import { healthEvents } from "@/db/schema";

export type QueryEventsArgs = { eventType: string; start: string; end: string };

export async function queryEvents(db: any, args: QueryEventsArgs) {
  return db
    .select({ eventType: healthEvents.eventType, date: healthEvents.date, source: healthEvents.source, payload: healthEvents.payload })
    .from(healthEvents)
    .where(and(eq(healthEvents.eventType, args.eventType), gte(healthEvents.date, new Date(args.start)), lt(healthEvents.date, new Date(args.end))))
    .orderBy(asc(healthEvents.date));
}
