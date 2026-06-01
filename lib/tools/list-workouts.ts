import { and, asc, eq, gte, lt } from "drizzle-orm";
import { workouts } from "@/db/schema";

export type ListWorkoutsArgs = { start: string; end: string; type?: string };

export async function listWorkouts(db: any, args: ListWorkoutsArgs) {
  const where = [gte(workouts.start, new Date(args.start)), lt(workouts.start, new Date(args.end))];
  if (args.type) where.push(eq(workouts.name, args.type));
  return db
    .select({
      id: workouts.id, name: workouts.name, start: workouts.start, end: workouts.end,
      durationS: workouts.durationS, activeEnergy: workouts.activeEnergy, distance: workouts.distance,
      avgHr: workouts.avgHr, maxHr: workouts.maxHr, stepCount: workouts.stepCount,
    })
    .from(workouts).where(and(...where)).orderBy(asc(workouts.start));
}
