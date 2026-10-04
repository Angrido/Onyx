import { describe, expect, it } from "vitest";
import {
  baselineKey,
  baselineLabel,
  ignoredNote,
  splitBaseline,
} from "../../src/domain/tdd/baseline";
import type { TestFailure } from "../../src/domain/tdd/report";

function failure(overrides: Partial<TestFailure>): TestFailure {
  return {
    kind: "test",
    file: "src/a.test.ts",
    name: "works",
    errorType: "AssertionError",
    message: "expected 1 to be 2",
    frames: [],
    location: null,
    ...overrides,
  };
}

describe("baseline of failures that predate the work", () => {
  it("identifies a type error by file, code and message, not by line", () => {
    const before = failure({
      kind: "typecheck",
      file: "src/b.ts",
      name: "src/b.ts:3:1 TS2322",
      errorType: "TS2322",
      message: "Type 'string' is not assignable to type 'number'.\nmore detail",
    });
    const after = { ...before, name: "src/b.ts:9:1 TS2322" };
    expect(baselineKey(before)).toBe(baselineKey(after));
    expect(baselineKey(failure({}))).toBe("test::src/a.test.ts::works");
  });

  it("ignores old failures unless they are in the files of the work", () => {
    const old = failure({});
    const fresh = failure({ name: "new case" });
    const own = failure({ file: "src/own.ts", kind: "typecheck", errorType: "TS1" });
    const baseline = new Set([baselineKey(old), baselineKey(own)]);
    expect(splitBaseline([old, fresh, own], baseline, ["src/own.ts"])).toEqual({
      kept: [fresh, own],
      ignored: [old],
    });
    expect(splitBaseline([old], new Set(), [])).toEqual({ kept: [old], ignored: [] });
  });

  it("names what was ignored", () => {
    expect(baselineLabel(failure({}))).toBe("src/a.test.ts › works");
    expect(ignoredNote([])).toBe("");
    expect(ignoredNote(["a", "b", "c", "d", "e"])).toBe(
      " · ignored 5 failures that already failed before this work: a; b; c and 2 more",
    );
  });
});
