import { describe, expect, it } from "vitest";
import { limitOptions, projectLimitLabel, slotSummary } from "../lib/queue";

describe("queue helpers", () => {
  it("summarizes the slots in use", () => {
    expect(slotSummary({ active: [], maxConcurrent: 1, reservedSlots: 0 })).toBe(
      "0 of 1 slot in use",
    );
    const active = [{}, {}] as never[];
    expect(slotSummary({ active, maxConcurrent: 3, reservedSlots: 1 })).toBe(
      "3 of 3 slots in use · 1 held by terminals",
    );
  });

  it("offers one limit per slot", () => {
    expect(limitOptions(3)).toEqual([1, 2, 3]);
    expect(limitOptions(0)).toEqual([1]);
  });

  it("names a project limit", () => {
    expect(projectLimitLabel(null)).toBe("no limit");
    expect(projectLimitLabel(1)).toBe("at most 1 run");
    expect(projectLimitLabel(2)).toBe("at most 2 runs");
  });
});
