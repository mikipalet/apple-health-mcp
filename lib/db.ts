import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/db/schema";
import { requireEnv } from "@/lib/env";

// Neon HTTP driver — serverless-friendly (no pooled connection to manage on Vercel).
// Lazily constructed: importing a route must not require DATABASE_URL at import time
// (keeps unit tests hermetic; the DB is only touched when a request actually runs).
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb(): ReturnType<typeof drizzle> {
  if (!_db) _db = drizzle(neon(requireEnv("DATABASE_URL")), { schema });
  return _db;
}
