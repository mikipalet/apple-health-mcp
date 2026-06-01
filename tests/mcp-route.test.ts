import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/[transport]/route";

beforeEach(() => { process.env.MCP_SECRET = "s3cr3t"; process.env.DATABASE_URL = "postgresql://x"; });

describe("mcp route auth", () => {
  it("401s without the secret", async () => {
    const res = await POST(new Request("https://x/api/mcp", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
});
