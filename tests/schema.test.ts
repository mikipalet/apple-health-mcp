import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";

describe("schema", () => {
  it("exports the three tables", () => {
    expect(schema.metricSamples).toBeDefined();
    expect(schema.workouts).toBeDefined();
    expect(schema.healthEvents).toBeDefined();
  });
});
