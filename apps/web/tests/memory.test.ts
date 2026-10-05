import type { MemoryFactDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { budgetShare, factSource, groupFacts } from "../lib/memory";

function fact(id: string, overrides: Partial<MemoryFactDto>): MemoryFactDto {
  return {
    id,
    kind: "COMMAND",
    status: "ACTIVE",
    subject: id,
    detail: null,
    text: null,
    line: id,
    evidence: 1,
    pinned: false,
    sourceRunId: null,
    sourceTaskTitle: null,
    sourcePath: null,
    firstSeenAt: "2026-10-01T00:00:00.000Z",
    lastSeenAt: "2026-10-01T00:00:00.000Z",
    expiresAt: null,
    included: false,
    ...overrides,
  };
}

describe("memory helpers", () => {
  it("groups facts and puts the included ones first", () => {
    const groups = groupFacts([
      fact("a", {}),
      fact("b", { included: true }),
      fact("c", { status: "SUGGESTED" }),
      fact("d", { status: "DISMISSED" }),
      fact("e", { status: "CANDIDATE" }),
      fact("f", { pinned: true }),
    ]);
    expect(groups.active.map((entry) => entry.id)).toEqual(["b", "f", "a"]);
    expect(groups.suggested.map((entry) => entry.id)).toEqual(["c"]);
    expect(groups.dismissed.map((entry) => entry.id)).toEqual(["d"]);
  });

  it("says where a fact comes from", () => {
    expect(
      factSource({
        kind: "COMMAND",
        evidence: 3,
        sourceTaskTitle: "Fix add",
        lastSeenAt: "2026-10-04T10:00:00Z",
      }),
    ).toBe("3 runs · last in “Fix add” · 2026-10-04");
    expect(
      factSource({
        kind: "NOTE",
        evidence: 1,
        sourceTaskTitle: null,
        lastSeenAt: "2026-10-04T10:00:00Z",
      }),
    ).toBe("added by you · 2026-10-04");
    expect(budgetShare(400, 800)).toBe(0.5);
    expect(budgetShare(900, 800)).toBe(1);
  });
});
