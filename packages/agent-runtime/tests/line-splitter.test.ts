import { describe, expect, it } from "vitest";
import { LineSplitter } from "../src";

function collect(maxLineLength?: number) {
  const lines: string[] = [];
  const overflows: number[] = [];
  const splitter = new LineSplitter(
    { onLine: (line) => lines.push(line), onOverflow: (length) => overflows.push(length) },
    maxLineLength,
  );
  return { splitter, lines, overflows };
}

describe("LineSplitter", () => {
  it("reassembles lines split across chunks", () => {
    const { splitter, lines } = collect();
    splitter.push('{"a":');
    splitter.push('1}\n{"b"');
    splitter.push(":2}\n\n");
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("strips carriage returns and skips blank lines", () => {
    const { splitter, lines } = collect();
    splitter.push("one\r\n   \r\ntwo\n");
    expect(lines).toEqual(["one", "two"]);
  });

  it("emits the trailing partial line on flush", () => {
    const { splitter, lines } = collect();
    splitter.push("tail-without-newline");
    expect(lines).toEqual([]);
    splitter.flush();
    expect(lines).toEqual(["tail-without-newline"]);
  });

  it("discards oversized lines and recovers on the next newline", () => {
    const { splitter, lines, overflows } = collect(10);
    splitter.push("0123456789ABC");
    splitter.push("DEF\nok\n");
    expect(overflows).toEqual([16]);
    expect(lines).toEqual(["ok"]);
  });
});
