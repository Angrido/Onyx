import { describe, expect, it } from "vitest";
import { searchHint, snippetParts } from "../lib/search";

describe("search helpers", () => {
  it("splits a snippet into marked parts", () => {
    expect(snippetParts("Let \u0001coupon\u0002s apply at \u0001check\u0002out")).toEqual([
      { text: "Let ", mark: false },
      { text: "coupon", mark: true },
      { text: "s apply at ", mark: false },
      { text: "check", mark: true },
      { text: "out", mark: false },
    ]);
    expect(snippetParts("plain")).toEqual([{ text: "plain", mark: false }]);
    expect(snippetParts("open \u0001end")).toEqual([
      { text: "open ", mark: false },
      { text: "end", mark: false },
    ]);
    expect(snippetParts("")).toEqual([]);
  });

  it("names the kind, project and status", () => {
    expect(searchHint({ kind: "RUN", projectName: "shop", status: "TDD_LOOP" })).toBe(
      "run · shop · tdd loop",
    );
    expect(searchHint({ kind: "FILE", projectName: "shop", status: null })).toBe("file · shop");
  });
});
