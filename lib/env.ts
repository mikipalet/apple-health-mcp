// Central, validated access to required env vars. Throws early with a clear
// message instead of leaking `undefined` into queries or auth checks.
export function requireEnv(name: "DATABASE_URL" | "MCP_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
