import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkCliCompatibility, parseCliVersion, parseHelp } from "../src/cli-info";
import { stubBinary } from "../src/testing";

const HELP = readFileSync(new URL("../fixtures/cli/help-2.1.288.txt", import.meta.url), "utf8");

describe("Claude Code compatibility", () => {
  it("reads flags, permission modes and commands from the recorded help", () => {
    const help = parseHelp(HELP);
    for (const flag of [
      "-p",
      "--print",
      "--json-schema",
      "--agents",
      "--max-budget-usd",
      "--resume",
    ])
      expect(help.flags.has(flag)).toBe(true);
    expect(help.flags.has("--max-turns")).toBe(false);
    expect(help.modes).toEqual([
      "acceptEdits",
      "auto",
      "bypassPermissions",
      "manual",
      "dontAsk",
      "plan",
    ]);
    expect(help.commands.has("setup-token")).toBe(true);
    expect(help.commands.has("upgrade")).toBe(true);
    expect(parseCliVersion("2.1.288 (Claude Code)")).toBe("2.1.288");
  });

  it("accepts a CLI with every flag Onyx passes, probing the hidden ones", async () => {
    const result = await checkCliCompatibility(stubBinary());
    expect(result).toMatchObject({
      version: "0.0.0-stub",
      ok: true,
      missingFlags: [],
      missingModes: [],
      missingCommands: [],
      error: null,
    });
  });

  it("names the flags a different CLI no longer accepts", async () => {
    const result = await checkCliCompatibility(stubBinary(), {
      env: { CLAUDE_STUB_UNKNOWN_FLAGS: "--append-system-prompt-file,--agents" },
    });
    expect(result.ok).toBe(false);
    expect(result.missingFlags.sort()).toEqual(["--agents", "--append-system-prompt-file"]);
  });

  it("reports a binary that does not answer", async () => {
    const result = await checkCliCompatibility({ command: "/nonexistent/claude", args: [] });
    expect(result).toMatchObject({
      ok: false,
      version: null,
      error: "Claude Code did not answer --version",
    });
  });
});
