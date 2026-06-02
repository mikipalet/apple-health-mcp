import { requireEnv } from "@/lib/env";
import { validateAccessToken } from "@/lib/oauth";

// Static-secret check (Health Auto Export ingest + Claude Code): the shared secret
// as `Authorization: Bearer <secret>` or `?key=<secret>`.
export function secretOk(req: Request): boolean {
  const expected = requireEnv("MCP_SECRET");
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7) === expected) return true;
  const key = new URL(req.url).searchParams.get("key");
  return key === expected;
}

// MCP endpoint authorization: accept EITHER the static secret (Claude Code / ?key)
// OR a valid OAuth access token (claude.ai web/mobile, which require OAuth).
export function isAuthorized(req: Request): boolean {
  if (secretOk(req)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return validateAccessToken(auth.slice(7));
  return false;
}
