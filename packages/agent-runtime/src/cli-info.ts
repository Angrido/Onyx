import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeBinary } from "./run-spec";

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[\w.]+)?/;

export function parseCliVersion(output: string): string | null {
  return VERSION_PATTERN.exec(output)?.[0] ?? null;
}

export function detectCliVersion(binary: ClaudeBinary, timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      binary.command,
      [...binary.args, "--version"],
      { timeout: timeoutMs, env: { ...process.env, DISABLE_AUTOUPDATER: "1" } },
      (error, stdout) => {
        resolve(error ? null : parseCliVersion(stdout));
      },
    );
  });
}

export const REQUIRED_PERMISSION_MODES = ["acceptEdits", "plan", "manual"] as const;
export const REQUIRED_COMMANDS = ["setup-token"] as const;

interface FlagProbe {
  flag: string;
  value?: (files: ProbeFiles) => string;
}

interface ProbeFiles {
  dir: string;
  settings: string;
  mcp: string;
  prompt: string;
  agents: string;
}

const FLAG_PROBES: readonly FlagProbe[] = [
  { flag: "--print" },
  { flag: "--output-format", value: () => "stream-json" },
  { flag: "--input-format", value: () => "stream-json" },
  { flag: "--verbose" },
  { flag: "--include-partial-messages" },
  { flag: "--model", value: () => "claude-haiku-4-5" },
  { flag: "--fallback-model", value: () => "claude-sonnet-5-5" },
  { flag: "--permission-mode", value: () => "acceptEdits" },
  { flag: "--max-turns", value: () => "1" },
  { flag: "--session-id", value: () => randomUUID() },
  { flag: "--resume" },
  { flag: "--no-session-persistence" },
  { flag: "--allowedTools", value: () => "Read" },
  { flag: "--disallowedTools", value: () => "Bash" },
  { flag: "--settings", value: (files) => files.settings },
  { flag: "--mcp-config", value: (files) => files.mcp },
  { flag: "--strict-mcp-config" },
  { flag: "--append-system-prompt-file", value: (files) => files.prompt },
  { flag: "--json-schema", value: () => '{"type":"object"}' },
  { flag: "--agents", value: (files) => files.agents },
  { flag: "--max-budget-usd", value: () => "0.01" },
  { flag: "--add-dir", value: (files) => files.dir },
];

const PROBE_BASE = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
];

export interface CliCompatibility {
  version: string | null;
  ok: boolean;
  missingFlags: string[];
  missingModes: string[];
  missingCommands: string[];
  error: string | null;
  checkedAt: string;
}

export function parseHelp(help: string): {
  flags: Set<string>;
  modes: string[] | null;
  commands: Set<string>;
} {
  const flags = new Set<string>();
  const commands = new Set<string>();
  let section: "options" | "commands" | null = null;
  for (const line of help.split("\n")) {
    if (/^Options:/.test(line)) section = "options";
    else if (/^Commands:/.test(line)) section = "commands";
    else if (/^\S/.test(line)) section = null;
    if (section === "options" && /^\s{2}-/.test(line)) {
      const head = line.trim().split(/\s{2,}/)[0] ?? "";
      for (const match of head.matchAll(/--?[A-Za-z][\w-]*/g)) flags.add(match[0]);
    }
    if (section === "commands") {
      const name = /^\s{2}([a-z][\w-]*(?:\|[a-z][\w-]*)*)/.exec(line)?.[1];
      for (const alias of name?.split("|") ?? []) commands.add(alias);
    }
  }
  const choices = /--permission-mode[\s\S]*?\(choices:([^)]*)\)/.exec(help)?.[1];
  const modes = choices ? [...choices.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "") : null;
  return { flags, modes, commands };
}

function run(
  binary: ClaudeBinary,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      binary.command,
      [...binary.args, ...args],
      { timeout: timeoutMs, env, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ code, output: `${stdout}${stderr}` });
      },
    );
    child.stdin?.end();
  });
}

const UNKNOWN_OPTION = /unknown option '(--?[\w-]+)'/;
const INVALID_CHOICE = /argument '([^']*)' is invalid|Allowed choices/i;

export async function checkCliCompatibility(
  binary: ClaudeBinary,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CliCompatibility> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const home = await mkdtemp(join(tmpdir(), "onyx-cli-check-"));
  const files: ProbeFiles = {
    dir: home,
    settings: join(home, "settings.json"),
    mcp: join(home, "mcp.json"),
    prompt: join(home, "prompt.md"),
    agents: join(home, "agents.json"),
  };
  const env: NodeJS.ProcessEnv = {
    PATH: options.env?.PATH ?? process.env.PATH ?? "",
    HOME: home,
    DISABLE_AUTOUPDATER: "1",
    ...Object.fromEntries(
      Object.entries(options.env ?? {}).filter(([key]) => key.startsWith("CLAUDE_STUB_")),
    ),
  };
  const result: CliCompatibility = {
    version: null,
    ok: false,
    missingFlags: [],
    missingModes: [],
    missingCommands: [],
    error: null,
    checkedAt: new Date().toISOString(),
  };
  try {
    await writeFile(files.settings, "{}\n");
    await writeFile(files.mcp, '{"mcpServers":{}}\n');
    await writeFile(files.prompt, "\n");
    await writeFile(files.agents, "{}\n");
    const version = await run(binary, ["--version"], env, timeoutMs);
    result.version = version.code === 0 ? parseCliVersion(version.output) : null;
    if (result.version === null) {
      result.error = "Claude Code did not answer --version";
      return result;
    }
    const help = parseHelp((await run(binary, ["--help"], env, timeoutMs)).output);
    result.missingCommands = REQUIRED_COMMANDS.filter((command) => !help.commands.has(command));
    if (help.modes)
      result.missingModes = REQUIRED_PERMISSION_MODES.filter((mode) => !help.modes?.includes(mode));

    let hidden = FLAG_PROBES.filter(
      (probe) => !help.flags.has(probe.flag) && !(probe.flag === "--print" && help.flags.has("-p")),
    ).filter((probe) => probe.flag !== "--resume");
    for (let attempt = 0; attempt <= FLAG_PROBES.length && hidden.length > 0; attempt += 1) {
      const args = [
        ...PROBE_BASE,
        ...hidden
          .filter((probe) => !PROBE_BASE.includes(probe.flag))
          .flatMap((probe) => (probe.value ? [probe.flag, probe.value(files)] : [probe.flag])),
      ];
      const probe = await run(binary, args, env, timeoutMs);
      const unknown = UNKNOWN_OPTION.exec(probe.output)?.[1];
      if (unknown) {
        result.missingFlags.push(unknown);
        hidden = hidden.filter((entry) => entry.flag !== unknown);
        continue;
      }
      if (probe.code !== 0) {
        result.error = `The flag probe failed: ${probe.output.trim().split("\n").at(-1) ?? `exit ${probe.code}`}`;
      }
      break;
    }
    if (!help.flags.has("--resume")) result.missingFlags.push("--resume");
    if (help.modes === null) {
      for (const mode of REQUIRED_PERMISSION_MODES) {
        const probe = await run(binary, [...PROBE_BASE, "--permission-mode", mode], env, timeoutMs);
        if (INVALID_CHOICE.test(probe.output)) result.missingModes.push(mode);
      }
    }
    result.ok =
      result.error === null &&
      result.missingFlags.length === 0 &&
      result.missingModes.length === 0 &&
      result.missingCommands.length === 0;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
