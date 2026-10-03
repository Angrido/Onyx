#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: pnpm --filter @onyx/agent-runtime fixtures:record -- --yes [options]

Runs the installed Claude Code on a handful of tiny prompts and records its
stream-json output as contract fixtures for the parser. It sends real
requests: with the default Haiku model the whole set costs a few cents and
each scenario is capped with --max-budget-usd.

  --yes             required: confirms that real requests may be sent
  --bin <path>      Claude Code binary (default: $CLAUDE_BIN or claude)
  --model <id>      model for every scenario (default: claude-haiku-4-5)
  --out <dir>       output directory (default: fixtures/recorded)
`;

interface Scenario {
  name: string;
  prompt: string;
  args: string[];
}

const FRUIT_SCHEMA = JSON.stringify({
  type: "object",
  properties: { fruit: { type: "string" } },
  required: ["fruit"],
  additionalProperties: false,
});

const SCENARIOS: readonly Scenario[] = [
  { name: "quick", prompt: "Reply with exactly one word: ready", args: ["--max-turns", "1"] },
  {
    name: "partial",
    prompt: "Reply with exactly three words.",
    args: ["--max-turns", "1", "--include-partial-messages"],
  },
  {
    name: "tool",
    prompt: "Use the Read tool on notes.txt and answer with its first word only.",
    args: ["--max-turns", "3", "--allowedTools", "Read"],
  },
  {
    name: "structured",
    prompt: "Name one fruit.",
    args: ["--max-turns", "3", "--json-schema", FRUIT_SCHEMA],
  },
  {
    name: "error-max-turns",
    prompt: "Read notes.txt, then list the files here with Glob, then summarise both.",
    args: ["--max-turns", "1", "--allowedTools", "Read", "Glob"],
  },
];

const PLACEHOLDER_SESSION = "00000000-0000-4000-8000-000000000000";
const DROPPED_KEYS = /email|account|organization|org_id|user_id/i;

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

function version(bin: string): Promise<string | null> {
  return new Promise((done) => {
    execFile(bin, ["--version"], { timeout: 20_000 }, (error, stdout) => {
      done(error ? null : (/\d+\.\d+\.\d+(?:-[\w.]+)?/.exec(stdout)?.[0] ?? null));
    });
  });
}

function help(bin: string): Promise<string> {
  return new Promise((done) => {
    execFile(bin, ["--help"], { timeout: 20_000 }, (_error, stdout) => done(stdout));
  });
}

export function sanitize(value: unknown, workspace: string, home: string, key = ""): unknown {
  if (typeof value === "string") {
    if (key === "session_id") return PLACEHOLDER_SESSION;
    return value.split(workspace).join("/workspace").split(home).join("/home/onyx");
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, workspace, home));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value)) {
      if (DROPPED_KEYS.test(name)) continue;
      result[name] = sanitize(entry, workspace, home, name);
    }
    return result;
  }
  return value;
}

function record(
  bin: string,
  scenario: Scenario,
  model: string,
  workspace: string,
): Promise<{ lines: string[]; costUsd: number }> {
  return new Promise((done, fail) => {
    const child = spawn(
      bin,
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--permission-mode",
        "manual",
        "--max-budget-usd",
        "0.05",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        ...scenario.args,
        scenario.prompt,
      ],
      {
        cwd: workspace,
        env: { ...process.env, DISABLE_AUTOUPDATER: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
    child.on("error", fail);
    child.on("close", () => {
      clearTimeout(timer);
      const lines: string[] = [];
      let costUsd = 0;
      for (const line of stdout.split("\n")) {
        if (line.trim().length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const clean = sanitize(parsed, workspace, homedir()) as Record<string, unknown>;
        if (clean["type"] === "result" && typeof clean["total_cost_usd"] === "number")
          costUsd += clean["total_cost_usd"];
        lines.push(JSON.stringify(clean));
      }
      if (lines.length === 0) fail(new Error(`${scenario.name}: no output. ${stderr.trim()}`));
      else done({ lines, costUsd });
    });
  });
}

async function main(argv: string[]): Promise<number> {
  if (!argv.includes("--yes")) {
    process.stdout.write(USAGE);
    return 2;
  }
  const bin = option(argv, "--bin") ?? process.env.CLAUDE_BIN ?? "claude";
  const model = option(argv, "--model") ?? "claude-haiku-4-5";
  const out = resolve(
    option(argv, "--out") ?? fileURLToPath(new URL("../fixtures/recorded", import.meta.url)),
  );
  const detected = await version(bin);
  if (!detected) {
    process.stderr.write(`${bin} did not answer --version\n`);
    return 1;
  }
  const target = join(out, detected);
  mkdirSync(target, { recursive: true });
  const workspace = mkdtempSync(join(tmpdir(), "onyx-fixtures-"));
  writeFileSync(join(workspace, "notes.txt"), "pineapple is the first word of this note.\n");
  let total = 0;
  try {
    writeFileSync(join(target, "help.txt"), await help(bin));
    for (const scenario of SCENARIOS) {
      process.stdout.write(`recording ${scenario.name}…\n`);
      const { lines, costUsd } = await record(bin, scenario, model, workspace);
      writeFileSync(join(target, `${scenario.name}.ndjson`), `${lines.join("\n")}\n`);
      total += costUsd;
    }
    writeFileSync(
      join(target, "recording.json"),
      `${JSON.stringify({ version: detected, model, recordedAt: new Date().toISOString(), costUsd: total }, null, 2)}\n`,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  process.stdout.write(
    `Recorded ${SCENARIOS.length} transcripts of Claude Code ${detected} in ${target} ($${total.toFixed(4)})\n`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
