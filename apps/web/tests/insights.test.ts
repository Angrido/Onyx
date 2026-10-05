import { describe, expect, it } from "vitest";
import { answerBlocks, inlineParts } from "@/lib/insights";

describe("insight answers", () => {
  it("splits code and bold text without rendering HTML", () => {
    expect(inlineParts("Use `add` from **math** <b>now</b>")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "add" },
      { kind: "text", text: " from " },
      { kind: "strong", text: "math" },
      { kind: "text", text: " <b>now</b>" },
    ]);
  });

  it("turns lists, notes and paragraphs into blocks", () => {
    const blocks = answerBlocks(
      "`add` is used in 2 places:\n\n- `a.ts:1`\n- `b.ts:2` — x\n\n_From the import graph._",
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "note"]);
    expect(blocks[1]).toMatchObject({
      kind: "list",
      items: [[{ kind: "code", text: "a.ts:1" }], expect.any(Array)],
    });
    expect(answerBlocks("## Heading\nline two")).toEqual([
      { kind: "paragraph", parts: [{ kind: "text", text: "Heading line two" }] },
    ]);
  });
});
