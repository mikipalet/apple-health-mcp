import { z } from "zod";

// Lenient on purpose: HAE has 150+ metric types and adds fields per type
// (Min/Avg/Max, systolic/diastolic, mealTime, ...). We validate the envelope and
// let the normalizer (lib/ingest.ts) branch on the actual fields. `.passthrough`
// keeps unknown keys so nothing is dropped before normalization.
const point = z.object({ date: z.string() }).passthrough();

const metric = z.object({
  name: z.string(),
  units: z.string().optional(),
  data: z.array(point).default([]),
});

const valueWithUnits = z.object({ qty: z.number(), units: z.string().optional() }).passthrough();

const workout = z.object({
  id: z.string(),
  name: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  duration: z.number().optional(),
  activeEnergyBurned: valueWithUnits.optional(),
  distance: valueWithUnits.optional(),
  avgHeartRate: valueWithUnits.optional(),
  maxHeartRate: valueWithUnits.optional(),
  stepCount: valueWithUnits.optional(),
  route: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough();

const event = z.object({ date: z.string().optional() }).passthrough();

export const haePayloadSchema = z.object({
  data: z.object({
    metrics: z.array(metric).default([]),
    workouts: z.array(workout).default([]),
    ecg: z.array(event).default([]),
    stateOfMind: z.array(event).default([]),
    symptoms: z.array(event).default([]),
    medications: z.array(event).default([]),
    cycleTracking: z.array(event).default([]),
    heartRateNotifications: z.array(event).default([]),
  }),
});

export type HaePayload = z.infer<typeof haePayloadSchema>;
