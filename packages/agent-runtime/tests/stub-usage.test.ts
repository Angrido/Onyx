import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_STUB_PATH } from "../src/testing";

interface Usage {
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface StubRun {
  first: Usage;
  total: Usage;
  costUsd: number;
}

const SESSION = "33333333-1111-4111-8111-111111111111";

let directory: string;

function run(args: string[], extra: Record<string, string> = {}): StubRun {
  const output = execFileSync(
    process.execPath,
    [CLAUDE_STUB_PATH, "-p", "--output-format", "stream-json", "--verbose", ...args],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        CLAUDE_STUB_USAGE: "model",
        CLAUDE_STUB_STATE_DIR: join(directory, "state"),
        CLAUDE_STUB_DELAY_MS: "0",
        ...extra,
      },
    },
  );
  const lines = output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const assistant = lines.find((line) => line.type === "assistant") as {
    message: { usage: Usage };
  };
  const result = lines.find((line) => line.type === "result") as {
    usage: Usage;
    total_cost_usd: number;
  };
  return { first: assistant.message.usage, total: result.usage, costUsd: result.total_cost_usd };
}

function primer(name: string, text: string): string {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "onyx-stub-usage-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("stub usage model", () => {
  it("writes the prompt cache for a new session and reads it back on a prompt resume", () => {
    const map = primer("primer.md", `map ${"x".repeat(8_000)}`);
    const fresh = run(["--session-id", SESSION, "--append-system-prompt-file", map, "fix it"]);
    expect(fresh.first.cache_read_input_tokens).toBe(0);
    expect(fresh.first.cache_creation_input_tokens).toBeGreaterThan(16_000);

    const resumed = run(["--resume", SESSION, "--append-system-prompt-file", map, "go on"]);
    expect(resumed.first.cache_read_input_tokens).toBeGreaterThan(16_000);
    expect(resumed.first.cache_creation_input_tokens).toBeLessThan(10);
    expect(resumed.costUsd).toBeLessThan(fresh.costUsd);
  });

  it("loses the whole cache when the appended system prompt changes", () => {
    const before = primer("a.md", `map ${"x".repeat(8_000)}`);
    const after = primer("b.md", `map ${"y".repeat(8_000)}`);
    run(["--session-id", SESSION, "--append-system-prompt-file", before, "fix it"]);
    const resumed = run(["--resume", SESSION, "--append-system-prompt-file", after, "go on"]);
    expect(resumed.first.cache_read_input_tokens).toBe(0);
    expect(resumed.first.cache_creation_input_tokens).toBeGreaterThan(16_000);
  });

  it("loses the cache when the pause is longer than its lifetime", () => {
    const map = primer("primer.md", "map");
    run(["--session-id", SESSION, "--append-system-prompt-file", map, "fix it"]);
    const resumed = run(["--resume", SESSION, "--append-system-prompt-file", map, "go on"], {
      CLAUDE_STUB_CACHE_TTL_MS: "0",
    });
    expect(resumed.first.cache_read_input_tokens).toBe(0);
  });

  it("charges a longer message as more cache writes", () => {
    const map = primer("primer.md", "map");
    const cold = { CLAUDE_STUB_CACHE_TTL_MS: "0" };
    const short = run(["--session-id", SESSION, "--append-system-prompt-file", map, "fix"], cold);
    const other = "44444444-1111-4111-8111-111111111111";
    const long = run(
      ["--session-id", other, "--append-system-prompt-file", map, `fix ${"z".repeat(40_000)}`],
      cold,
    );
    expect(long.total.cache_creation_input_tokens).toBeGreaterThan(
      short.total.cache_creation_input_tokens + 9_000,
    );
  });
});
