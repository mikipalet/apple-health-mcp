import { describe, it, expect } from "vitest";
import { haePayloadSchema } from "@/lib/hae-schema";

describe("haePayloadSchema", () => {
  it("accepts a minimal metrics payload", () => {
    const r = haePayloadSchema.safeParse({
      data: { metrics: [{ name: "step_count", units: "count", data: [{ date: "2026-06-01 08:00:00 +0000", qty: 100 }] }] },
    });
    expect(r.success).toBe(true);
  });
  it("passes through unknown point fields", () => {
    const r = haePayloadSchema.safeParse({
      data: { metrics: [{ name: "blood_glucose", units: "mg/dL", data: [{ date: "2026-06-01 08:00:00 +0000", qty: 95, mealTime: "Before Meal" }] }] },
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-object body", () => {
    expect(haePayloadSchema.safeParse(42).success).toBe(false);
  });
});
