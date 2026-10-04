import { describe, expect, it } from "vitest";
import {
  clampCount,
  defaultPanels,
  fitPanels,
  gridColumns,
  parseLayout,
  sourceFromKey,
  sourceKey,
} from "../lib/grid";

describe("agent grid layout", () => {
  it("reads a saved layout and ignores anything malformed", () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout("{not json")).toBeNull();
    expect(
      parseLayout(
        JSON.stringify({
          count: 40,
          panels: [{ kind: "run", runId: "r1" }, { kind: "terminal" }, "x", null],
        }),
      ),
    ).toEqual({ count: 9, panels: [{ kind: "run", runId: "r1" }, null, null, null] });
    expect(clampCount(0)).toBe(1);
    expect(clampCount(Number.NaN)).toBe(1);
  });

  it("fills the panels with live runs first, then running terminals", () => {
    expect(
      defaultPanels(
        4,
        [{ runId: "r1" }, { runId: null }],
        [
          { workspaceId: "w1", state: "running" },
          { workspaceId: "w2", state: "exited" },
        ],
      ),
    ).toEqual([{ kind: "run", runId: "r1" }, { kind: "terminal", workspaceId: "w1" }, null, null]);
    expect(fitPanels([{ kind: "run", runId: "r1" }], 2)).toEqual([
      { kind: "run", runId: "r1" },
      null,
    ]);
  });

  it("round-trips panel keys and picks the columns", () => {
    for (const source of [
      { kind: "run" as const, runId: "abc" },
      { kind: "terminal" as const, workspaceId: "w:1" },
    ])
      expect(sourceFromKey(sourceKey(source))).toEqual(source);
    expect(sourceKey(null)).toBe("");
    expect(sourceFromKey("")).toBeNull();
    expect(gridColumns(1)).toBe("grid-cols-1");
    expect(gridColumns(4)).toBe("grid-cols-1 lg:grid-cols-2");
    expect(gridColumns(6)).toContain("2xl:grid-cols-3");
  });
});
