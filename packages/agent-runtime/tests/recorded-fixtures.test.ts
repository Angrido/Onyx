import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeClaudeEvent, type RunItem } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { parseHelp } from "../src/cli-info";
import { CLAUDE_STUB_PATH } from "../src/testing";
import { sanitize } from "../scripts/record-fixtures";

const RECORDED_DIR = fileURLToPath(new URL("../fixtures/recorded", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/record-fixtures.ts", import.meta.url));

function transcript(path: string): RunItem[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => normalizeClaudeEvent(JSON.parse(line) as unknown));
}

const recorded = existsSync(RECORDED_DIR)
  ? readdirSync(RECORDED_DIR).flatMap((version) =>
      readdirSync(join(RECORDED_DIR, version))
        .filter((file) => file.endsWith(".ndjson"))
        .map((file) => ({ version, file, path: join(RECORDED_DIR, version, file) })),
    )
  : [];

describe.runIf(recorded.length === 0)("recorded Claude Code transcripts", () => {
  it.skip("none recorded yet: run pnpm --filter @onyx/agent-runtime fixtures:record -- --yes", () =>
    undefined);
});

describe.runIf(recorded.length > 0)("recorded Claude Code transcripts", () => {
  it.each(recorded)(
    "$version/$file has an init, a result and usage the runtime understands",
    ({ file, path }) => {
      const items = transcript(path);
      expect(items.some((item) => item.kind === "init")).toBe(true);
      const result = items.findLast((item) => item.kind === "result");
      expect(result?.kind).toBe("result");
      if (result?.kind !== "result") return;
      expect(result.usage.inputTokens + result.usage.outputTokens).toBeGreaterThan(0);
      if (file === "tool.ndjson") {
        expect(items.some((item) => item.kind === "tool_use")).toBe(true);
        expect(items.some((item) => item.kind === "tool_result")).toBe(true);
      }
      if (file === "structured.ndjson") expect(result.structuredOutput).toBeTruthy();
      if (file === "error-max-turns.ndjson") expect(result.subtype).toBe("error_max_turns");
    },
  );

  it.each([...new Set(recorded.map((entry) => entry.version))])(
    "%s/help.txt lists the options Onyx relies on",
    (version) => {
      const help = parseHelp(readFileSync(join(RECORDED_DIR, version, "help.txt"), "utf8"));
      for (const flag of ["--output-format", "--permission-mode", "--json-schema", "--agents"])
        expect(help.flags.has(flag)).toBe(true);
    },
  );
});

describe("fixture recorder", () => {
  it("refuses to send requests without --yes", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("--yes");
  });

  it("removes local paths, session ids and account fields", () => {
    expect(
      sanitize(
        {
          cwd: "/tmp/onyx-fixtures-abc/src",
          session_id: "1c5a8d1e-0000-4000-8000-123456789abc",
          home: "/root/.claude",
          account: { email: "someone@example.com" },
          nested: [{ email_address: "x", path: "/tmp/onyx-fixtures-abc/notes.txt" }],
        },
        "/tmp/onyx-fixtures-abc",
        "/root",
      ),
    ).toEqual({
      cwd: "/workspace/src",
      session_id: "00000000-0000-4000-8000-000000000000",
      home: "/home/onyx/.claude",
      nested: [{ path: "/workspace/notes.txt" }],
    });
  });

  it("records every scenario with a stand-in CLI", () => {
    const out = mkdtempSync(join(tmpdir(), "onyx-recorded-"));
    try {
      execFileSync(process.execPath, [SCRIPT, "--yes", "--bin", CLAUDE_STUB_PATH, "--out", out], {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_STUB_DELAY_MS: "1" },
      });
      const files = readdirSync(join(out, "0.0.0-stub")).sort();
      expect(files).toEqual([
        "error-max-turns.ndjson",
        "help.txt",
        "partial.ndjson",
        "quick.ndjson",
        "recording.json",
        "structured.ndjson",
        "tool.ndjson",
      ]);
      const items = transcript(join(out, "0.0.0-stub", "quick.ndjson"));
      const init = items.find((item) => item.kind === "init");
      expect(init?.kind === "init" ? init.cwd : null).toBe("/workspace");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
