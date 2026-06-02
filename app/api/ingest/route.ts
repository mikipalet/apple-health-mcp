import { secretOk } from "@/lib/auth";
import { haePayloadSchema } from "@/lib/hae-schema";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { getDb } from "@/lib/db";

export const maxDuration = 300; // First HAE sync can be large; allow headroom.

// The db type is the structural shape persist() accepts, so both the neon-http
// client (prod) and a PGlite client (tests) satisfy it.
type Db = Parameters<typeof persist>[0];

// Core handler takes a db *factory* (not a resolved db) so the database is only
// touched AFTER auth + validation pass. This keeps unauthenticated/malformed
// requests from opening a DB connection (and from 500ing when DATABASE_URL is
// absent). Tests inject `() => pgliteDb`.
export async function handleIngest(req: Request, getDbFn: () => Db): Promise<Response> {
  if (!secretOk(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Diagnostic: log the RAW body shape (before Zod defaults fill missing arrays),
  // so we can see exactly which keys/sizes each automation actually sends.
  const rawData = (body as { data?: Record<string, unknown> })?.data ?? {};
  const rawShape = Object.fromEntries(
    Object.entries(rawData).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]),
  );
  console.log("[ingest] RAW body.data shape:", JSON.stringify(rawShape));
  const parsed = haePayloadSchema.safeParse(body);
  if (!parsed.success) {
    console.warn("[ingest] validation failed:", JSON.stringify(parsed.error.issues.slice(0, 5)));
    return Response.json({ error: "invalid payload", detail: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data.data;
  // Diagnostic: log the shape of every incoming payload so we can see exactly what
  // each Health Auto Export automation sends (which arrays, how many items).
  console.log("[ingest] received", JSON.stringify({
    metrics: d.metrics.length, workouts: d.workouts.length, ecg: d.ecg.length,
    stateOfMind: d.stateOfMind.length, symptoms: d.symptoms.length,
    medications: d.medications.length, cycleTracking: d.cycleTracking.length,
    heartRateNotifications: d.heartRateNotifications.length,
    topLevelKeys: Object.keys(parsed.data.data),
  }));
  const normalized = normalize(parsed.data);
  try {
    const summary = await persist(getDbFn(), normalized);
    // 200 with a summary so Health Auto Export never retry-storms on partial skips.
    return Response.json({ ...summary, skipped: normalized.skipped }, { status: 200 });
  } catch (err) {
    // Surface the real reason (param limits, timeouts, bad data) instead of a blank
    // 500, so failures are diagnosable from the app's response and the Vercel logs.
    const message = err instanceof Error ? err.message : "persist failed";
    console.error("[ingest] persist error:", message);
    return Response.json({ error: "ingest failed", detail: message }, { status: 500 });
  }
}

export function POST(req: Request) {
  return handleIngest(req, getDb);
}
