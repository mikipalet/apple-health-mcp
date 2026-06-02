import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "./helpers/db";
import { handleIngest } from "@/app/api/ingest/route";
import { metricSamples } from "@/db/schema";

const D = "2026-06-01 08:00:00 +0000";
beforeEach(() => { process.env.MCP_SECRET = "s3cr3t"; });

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://x/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("handleIngest", () => {
  it("401s without the secret", async () => {
    const db = await makeTestDb();
    const res = await handleIngest(post({ data: { metrics: [] } }), () => db);
    expect(res.status).toBe(401);
  });

  it("stores metrics and returns a summary", async () => {
    const db = await makeTestDb();
    const body = { data: { metrics: [{ name: "step_count", units: "count", data: [{ date: D, qty: 100 }] }] } };
    const res = await handleIngest(post(body, { authorization: "Bearer s3cr3t" }), () => db);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ metricsStored: 1 });
    expect(await db.select().from(metricSamples)).toHaveLength(1);
  });

  it("400s on a malformed body", async () => {
    const db = await makeTestDb();
    const res = await handleIngest(post(42, { authorization: "Bearer s3cr3t" }), () => db);
    expect(res.status).toBe(400);
  });

  it("does not resolve the db when auth fails", async () => {
    let resolved = false;
    const res = await handleIngest(post({ data: {} }), () => { resolved = true; return null as never; });
    expect(res.status).toBe(401);
    expect(resolved).toBe(false);
  });
});
