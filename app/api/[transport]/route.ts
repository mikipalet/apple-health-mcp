import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { baseUrl } from "@/lib/oauth";
import { getDb } from "@/lib/db";
import { listMetrics } from "@/lib/tools/list-metrics";
import { queryMetric } from "@/lib/tools/query-metric";
import { listWorkouts } from "@/lib/tools/list-workouts";
import { queryEvents } from "@/lib/tools/query-events";
import { latestSnapshot } from "@/lib/tools/latest-snapshot";
import { healthSql } from "@/lib/tools/health-sql";

export const maxDuration = 60;

// Wrap each tool's JSON result in the MCP text-content envelope.
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true });

const handler = createMcpHandler((server) => {
  server.registerTool("list_metrics",
    { title: "List metrics", description: "List available Apple Health metric types with units, sample counts, and date ranges.", inputSchema: {} },
    async () => ok(await listMetrics(getDb())));

  server.registerTool("query_metric",
    { title: "Query a metric", description: "Query a metric over a date range. aggregation: raw|hourly|daily|avg|sum|min|max.",
      inputSchema: { name: z.string(), start: z.string(), end: z.string(),
        aggregation: z.enum(["raw", "hourly", "daily", "avg", "sum", "min", "max"]).default("daily") } },
    async (a) => ok(await queryMetric(getDb(), a)));

  server.registerTool("list_workouts",
    { title: "List workouts", description: "List workouts in a date range, optionally filtered by type.",
      inputSchema: { start: z.string(), end: z.string(), type: z.string().optional() } },
    async (a) => ok(await listWorkouts(getDb(), a)));

  server.registerTool("query_events",
    { title: "Query health events", description: "Query long-tail data: ecg, stateOfMind, symptoms, medications, cycleTracking, heartRateNotifications.",
      inputSchema: { eventType: z.enum(["ecg", "stateOfMind", "symptoms", "medications", "cycleTracking", "heartRateNotifications"]),
        start: z.string(), end: z.string() } },
    async (a) => ok(await queryEvents(getDb(), a)));

  server.registerTool("latest_snapshot",
    { title: "Latest snapshot", description: "Most recent value for every metric — a quick current-status overview.", inputSchema: {} },
    async () => ok(await latestSnapshot(getDb())));

  server.registerTool("health_sql",
    { title: "Read-only SQL", description: "Run a single read-only SELECT/WITH query over tables: metric_samples, workouts, health_events.",
      inputSchema: { query: z.string() } },
    async ({ query }) => {
      try { return ok(await healthSql(getDb(), query)); }
      catch (e) { return fail(e instanceof Error ? e.message : "query failed"); }
    });
}, undefined, {
  // basePath MUST match where the [transport] segment is mounted, else the handler
  // 404s every request. Our route lives at app/api/[transport]/route.ts → "/api".
  basePath: "/api",
  maxDuration: 60,
});

// Gate the MCP endpoint. Accept the static secret (Claude Code / ?key) OR a valid
// OAuth access token (claude.ai web/mobile). On rejection, return a 401 with a
// WWW-Authenticate challenge pointing at our protected-resource metadata, which is
// what makes claude.ai start the OAuth flow.
async function authed(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`,
      },
    });
  }
  return handler(req);
}

export { authed as GET, authed as POST };
