import { secretOk } from "@/lib/auth";
import { haePayloadSchema } from "@/lib/hae-schema";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { getDb } from "@/lib/db";

export const maxDuration = 60; // App Router: must be a route export, not vercel.json.

// The db param is the structural type persist() accepts, so both the neon-http
// client (prod) and a PGlite client (tests) satisfy it.
type Db = Parameters<typeof persist>[0];

// Core handler takes the db explicitly so tests can inject a PGlite instance.
export async function handleIngest(req: Request, db: Db): Promise<Response> {
  if (!secretOk(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = haePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", detail: parsed.error.issues }, { status: 400 });
  }
  const normalized = normalize(parsed.data);
  const summary = await persist(db, normalized);
  // 200 with a summary so Health Auto Export never retry-storms on partial skips.
  return Response.json({ ...summary, skipped: normalized.skipped }, { status: 200 });
}

export function POST(req: Request) {
  return handleIngest(req, getDb());
}
