import { describe, it, expect } from "vitest";
import { parseHaeDate } from "@/lib/hae-date";

describe("parseHaeDate", () => {
  it("parses UTC offset", () => {
    const d = parseHaeDate("2026-06-01 08:00:00 +0000");
    expect(d.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });
  it("parses positive offset into UTC", () => {
    const d = parseHaeDate("2026-06-01 10:00:00 +0200");
    expect(d.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });
  it("throws on garbage", () => {
    expect(() => parseHaeDate("not a date")).toThrow();
  });
});
