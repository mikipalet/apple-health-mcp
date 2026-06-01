import { requireEnv } from "@/lib/env";

// Accepts the shared secret either as `Authorization: Bearer <secret>` (clean for
// Claude Code) or as a `?key=<secret>` query param (claude.ai web/mobile, where the
// connector URL is /mcp/<secret> rewritten to /api/mcp?key=<secret>). A single
// personal user, so a length+equality compare is sufficient.
export function secretOk(req: Request): boolean {
  const expected = requireEnv("MCP_SECRET");
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7) === expected) return true;
  const key = new URL(req.url).searchParams.get("key");
  return key === expected;
}
