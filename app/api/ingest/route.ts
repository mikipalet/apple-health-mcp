import { secretOk } from "@/lib/auth";
import { haePayloadSchema } from "@/lib/hae-schema";
import { normalize } from "@/lib/ingest";
import { persist } from "@/lib/persist";
import { getDb } from "@/lib/db";

export const maxDuration = 60; // App Router: must be a route export, not vercel.json.

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
  const parsed = haePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", detail: parsed.error.issues }, { status: 400 });
  }
  const normalized = normalize(parsed.data);
  const summary = await persist(getDbFn(), normalized);
  // 200 with a summary so Health Auto Export never retry-storms on partial skips.
  return Response.json({ ...summary, skipped: normalized.skipped }, { status: 200 });
}

export function POST(req: Request) {
  return handleIngest(req, getDb);
}
