import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TurnUsageLedger,
  extractTextDelta,
  normalizeClaudeEvent,
  type RunItem,
} from "@onyx/contracts";
import { SYNTHETIC_FIXTURES_DIR } from "../src/testing";

function loadFixture(name: string): unknown[] {
  return readFileSync(join(SYNTHETIC_FIXTURES_DIR, name), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

const fixtureFiles = readdirSync(SYNTHETIC_FIXTURES_DIR).filter((file) => file.endsWith(".ndjson"));

describe("stream-json fixtures", () => {
  it.each(fixtureFiles)("%s normalizes without unknown items", (file) => {
    const items: RunItem[] = loadFixture(file).flatMap(normalizeClaudeEvent);
    expect(items.filter((item) => item.kind === "unknown")).toEqual([]);
    expect(items[0]?.kind).toBe("init");
    expect(items.at(-1)?.kind).toBe("result");
  });

  it.each(fixtureFiles)("%s turn usage adds up to the result usage", (file) => {
    const items = loadFixture(file).flatMap(normalizeClaudeEvent);
    const ledger = new TurnUsageLedger();
    ledger.recordItems(items);
    const result = items.find((item) => item.kind === "result");
    expect(result?.kind).toBe("result");
    if (result?.kind !== "result") return;
    expect(ledger.total()).toEqual(result.usage);
  });

  it("pairs every tool_use with a tool_result in the success fixture", () => {
    const items = loadFixture("success.ndjson").flatMap(normalizeClaudeEvent);
    const uses = items.flatMap((item) => (item.kind === "tool_use" ? [item.toolUseId] : []));
    const results = items.flatMap((item) => (item.kind === "tool_result" ? [item.toolUseId] : []));
    expect(results).toEqual(uses);
    expect(items.some((item) => item.kind === "tool_result" && item.isError)).toBe(true);
  });

  it("exposes text deltas in the partial fixture", () => {
    const deltas = loadFixture("partial.ndjson").flatMap((event) => {
      const delta = extractTextDelta(event);
      return delta ? [delta.text] : [];
    });
    expect(deltas.join("")).toBe("Streaming partial output.");
  });
});
