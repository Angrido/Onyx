#!/usr/bin/env node
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);

function flagValue(flag: string): string | null {
  const index = argv.indexOf(flag);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write("0.0.0-stub (Claude Code stub)\n");
  process.exit(0);
}

const unknownFlags = (process.env.CLAUDE_STUB_UNKNOWN_FLAGS ?? "")
  .split(",")
  .map((flag) => flag.trim())
  .filter((flag) => flag.length > 0);

if (argv.includes("--help") || argv.includes("-h")) {
  const help = readFileSync(
    fileURLToPath(new URL("../fixtures/cli/help-2.1.288.txt", import.meta.url)),
    "utf8",
  );
  process.stdout.write(
    help
      .split("\n")
      .filter((line) => !unknownFlags.some((flag) => line.includes(`${flag} `)))
      .join("\n"),
  );
  process.exit(0);
}

const rejected = argv.find((arg) => unknownFlags.includes(arg));
if (rejected) {
  process.stderr.write(`error: unknown option '${rejected}'\n`);
  process.exit(1);
}

const fixturesDir =
  process.env.CLAUDE_STUB_FIXTURES ??
  fileURLToPath(new URL("../fixtures/synthetic", import.meta.url));
const delayMs = Number(process.env.CLAUDE_STUB_DELAY_MS ?? "40");
const argsFile = process.env.CLAUDE_STUB_ARGS_FILE;
if (argsFile) writeFileSync(argsFile, JSON.stringify(argv));
const envFile = process.env.CLAUDE_STUB_ENV_FILE;
if (envFile) writeFileSync(envFile, JSON.stringify(Object.keys(process.env).sort()));

const sessionId = flagValue("--session-id") ?? flagValue("--resume") ?? randomUUID();
const model = flagValue("--model") ?? "claude-sonnet-5-5";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractUserText(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.type !== "user" || !isRecord(parsed.message)) return null;
  const content = parsed.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("\n");
}

function readPrompt(): Promise<string> {
  if (flagValue("--input-format") !== "stream-json") return Promise.resolve(argv.at(-1) ?? "");
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const settle = (text: string): void => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const text = extractUserText(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (text !== null) settle(text);
        newline = buffer.indexOf("\n");
      }
    });
    process.stdin.on("end", () => settle(extractUserText(buffer) ?? ""));
  });
}

function scenarioFor(prompt: string): string {
  const marker = /\[stub:([a-z-]+)\]/.exec(taskSection(prompt));
  const name = marker?.[1] ?? "";
  if (/^(fail-task|skip-task|qa-|resolve-)/.test(name)) return "success";
  return marker?.[1] ?? process.env.CLAUDE_STUB_SCENARIO ?? "success";
}

function escapeJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function renderFixture(name: string, prompt: string): string[] {
  return readFileSync(join(fixturesDir, `${name}.ndjson`), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line
        .replaceAll("{{SESSION_ID}}", escapeJson(sessionId))
        .replaceAll("{{MODEL}}", escapeJson(model))
        .replaceAll("{{CWD}}", escapeJson(process.cwd()))
        .replaceAll("{{PROMPT}}", escapeJson(prompt)),
    );
}

function initLine(): string {
  const [line] = renderFixture("quick", "");
  if (!line) throw new Error("quick fixture is empty");
  return line;
}

interface StubSessionState {
  historyTokens: number;
  prefixKey: string;
  lastAt: number;
}

interface StubUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  service_tier: string;
}

const MODEL_INPUT_PRICE: readonly [RegExp, number][] = [
  [/opus/, 4],
  [/haiku/, 1],
  [/./, 2],
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readOptionalFile(path: string | null): string {
  if (path === null) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

class UsageModel {
  private readonly stateDir =
    process.env.CLAUDE_STUB_STATE_DIR ?? join(tmpdir(), "onyx-claude-stub");
  private readonly ttlMs = Number(process.env.CLAUDE_STUB_CACHE_TTL_MS ?? "300000");
  private readonly systemTokens: number;
  private readonly prefixKey: string;
  private readonly resumed = flagValue("--resume") !== null;
  private context = 0;
  private pending = 0;
  private turns = 0;
  private readonly userTokens: number;
  private readonly totals: StubUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    service_tier: "standard",
  };

  constructor(userTokens: number) {
    this.userTokens = userTokens;
    const appended = readOptionalFile(flagValue("--append-system-prompt-file"));
    const agents = readOptionalFile(flagValue("--agents"));
    this.systemTokens =
      Number(process.env.CLAUDE_STUB_SYSTEM_TOKENS ?? "14000") +
      estimateTokens(appended) +
      estimateTokens(agents);
    this.prefixKey = createHash("sha256").update(`${model}\0${appended}\0${agents}`).digest("hex");
  }

  transform(line: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return line;
    }
    if (!isRecord(parsed)) return line;
    if (parsed.type === "user" && !parsed.parent_tool_use_id) {
      this.pending += estimateTokens(JSON.stringify(parsed.message ?? ""));
      return line;
    }
    if (parsed.type === "assistant" && !parsed.parent_tool_use_id && isRecord(parsed.message)) {
      parsed.message.usage = this.turn(
        estimateTokens(JSON.stringify(parsed.message.content ?? "")),
      );
      return JSON.stringify(parsed);
    }
    if (parsed.type === "result") {
      this.save();
      const cost = this.cost(this.totals);
      parsed.usage = { ...this.totals };
      parsed.total_cost_usd = cost;
      parsed.modelUsage = {
        [model]: {
          inputTokens: this.totals.input_tokens,
          outputTokens: this.totals.output_tokens,
          cacheReadInputTokens: this.totals.cache_read_input_tokens,
          cacheCreationInputTokens: this.totals.cache_creation_input_tokens,
          webSearchRequests: 0,
          costUSD: cost,
          contextWindow: 1_000_000,
        },
      };
      return JSON.stringify(parsed);
    }
    return line;
  }

  private turn(outputTokens: number): StubUsage {
    const output = Math.max(8, outputTokens);
    let read: number;
    let created: number;
    if (this.turns === 0) {
      const previous = this.resumed ? this.load() : null;
      const history = previous?.historyTokens ?? 0;
      const warmPrefix = this.resumed
        ? previous !== null &&
          previous.prefixKey === this.prefixKey &&
          Date.now() - previous.lastAt <= this.ttlMs
        : this.prefixWarm();
      const cached = this.systemTokens + history;
      read = warmPrefix ? cached : 0;
      created = warmPrefix ? this.userTokens : cached + this.userTokens;
    } else {
      read = this.context;
      created = this.pending;
    }
    this.turns += 1;
    this.pending = output;
    this.context = read + created;
    const usage: StubUsage = {
      input_tokens: 3,
      cache_creation_input_tokens: created,
      cache_read_input_tokens: read,
      output_tokens: output,
      service_tier: "standard",
    };
    this.totals.input_tokens += usage.input_tokens;
    this.totals.cache_creation_input_tokens += created;
    this.totals.cache_read_input_tokens += read;
    this.totals.output_tokens += output;
    return usage;
  }

  private cost(usage: StubUsage): number {
    const price = MODEL_INPUT_PRICE.find(([pattern]) => pattern.test(model))?.[1] ?? 2;
    const units =
      usage.input_tokens +
      usage.cache_creation_input_tokens * 1.25 +
      usage.cache_read_input_tokens * 0.1 +
      usage.output_tokens * 5;
    return Math.round(((units * price) / 1_000_000) * 1_000_000) / 1_000_000;
  }

  private sessionFile(): string {
    return join(this.stateDir, `${sessionId}.json`);
  }

  private prefixFile(): string {
    return join(this.stateDir, `prefix-${this.prefixKey}.json`);
  }

  private load(): StubSessionState | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.sessionFile(), "utf8"));
      return isRecord(parsed) &&
        typeof parsed.historyTokens === "number" &&
        typeof parsed.prefixKey === "string" &&
        typeof parsed.lastAt === "number"
        ? {
            historyTokens: parsed.historyTokens,
            prefixKey: parsed.prefixKey,
            lastAt: parsed.lastAt,
          }
        : null;
    } catch {
      return null;
    }
  }

  private prefixWarm(): boolean {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.prefixFile(), "utf8"));
      return isRecord(parsed) && typeof parsed.lastAt === "number"
        ? Date.now() - parsed.lastAt <= this.ttlMs
        : false;
    } catch {
      return false;
    }
  }

  private save(): void {
    const now = Date.now();
    const state: StubSessionState = {
      historyTokens: Math.max(0, this.context + this.pending - this.systemTokens),
      prefixKey: this.prefixKey,
      lastAt: now,
    };
    try {
      mkdirSync(this.stateDir, { recursive: true });
      for (const [file, content] of [
        [this.sessionFile(), state],
        [this.prefixFile(), { lastAt: now }],
      ] as const) {
        const partial = `${file}.${process.pid}.partial`;
        writeFileSync(partial, JSON.stringify(content));
        renameSync(partial, file);
      }
    } catch {
      return;
    }
  }
}

let usageModel: UsageModel | null = null;
let rateLimitSent = false;

function rateLimitSpec(): string | null {
  const value = process.env.CLAUDE_STUB_RATE_LIMIT?.trim();
  if (!value) return null;
  if (!value.startsWith("@")) return value;
  try {
    return readFileSync(value.slice(1), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function rateLimitLine(): string | null {
  const spec = rateLimitSpec();
  if (spec === null) return null;
  const [status = "allowed", utilization, type = "five_hour", resetsIn = "3600"] = spec.split(":");
  return JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: {
      status,
      resetsAt: Date.now() + Number(resetsIn) * 1_000,
      utilization: utilization ? Number(utilization) : null,
      rateLimitType: type,
      overageStatus: null,
      overageResetsAt: null,
      overageDisabledReason: null,
      isUsingOverage: false,
    },
    uuid: randomUUID(),
    session_id: sessionId,
  });
}

function emit(line: string): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.write(`${line}\n`)) resolve();
    else process.stdout.once("drain", () => resolve());
  });
}

async function writeLine(raw: string): Promise<void> {
  await emit(usageModel ? usageModel.transform(raw) : raw);
  if (rateLimitSent || !raw.includes('"subtype":"init"')) return;
  rateLimitSent = true;
  const limit = rateLimitLine();
  if (limit !== null) await emit(limit);
}

async function replay(lines: readonly string[]): Promise<void> {
  for (const line of lines) {
    await sleep(delayMs);
    await writeLine(line);
  }
}

function hangForever(): Promise<never> {
  setInterval(() => undefined, 60_000);
  return new Promise<never>(() => undefined);
}

async function writeInChunks(payload: string, chunkSize: number): Promise<void> {
  for (let index = 0; index < payload.length; index += chunkSize) {
    process.stdout.write(payload.slice(index, index + chunkSize));
    if (index % (chunkSize * 10) === 0) await sleep(1);
  }
}

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

type RpcMessage = Record<string, unknown>;

function readMcpServers(): Record<string, McpServerConfig> {
  const file = flagValue("--mcp-config");
  if (!file) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(parsed) && isRecord(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, McpServerConfig>)
      : {};
  } catch {
    return {};
  }
}

class StdioRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: RpcMessage) => void>();
  private nextId = 1;
  private buffer = "";

  constructor(config: McpServerConfig) {
    this.child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.dispatch(line);
        newline = this.buffer.indexOf("\n");
      }
    });
  }

  request(method: string, params: RpcMessage): Promise<RpcMessage> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 15_000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (isRecord(message.error)) reject(new Error(String(message.error.message)));
        else resolve(isRecord(message.result) ? message.result : {});
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: RpcMessage): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }

  private dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.id !== "number") return;
    this.pending.get(message.id)?.(message);
    this.pending.delete(message.id);
  }
}

const STUB_USAGE = {
  input_tokens: 6,
  cache_creation_input_tokens: 1800,
  cache_read_input_tokens: 2400,
  output_tokens: 40,
  service_tier: "standard",
};

function assistantLine(messageId: string, content: unknown[]): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: STUB_USAGE,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
}

interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

function resultLine(
  text: string,
  denials: PermissionDenial[] = [],
  structured: unknown = undefined,
): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 900,
    duration_api_ms: 700,
    num_turns: 2,
    session_id: sessionId,
    total_cost_usd: 0.004,
    usage: STUB_USAGE,
    modelUsage: {},
    permission_denials: denials,
    result: text,
    ...(structured === undefined ? {} : { structured_output: structured }),
  });
}

async function runMcpScenario(prompt: string): Promise<void> {
  const onyx = readMcpServers()["onyx"];
  const handle = /…#([0-9a-z]{8})/.exec(prompt)?.[1] ?? null;
  const rpc = onyx ? new StdioRpc(onyx) : null;
  let tools: string[] = [];
  if (rpc) {
    await rpc.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-stub", version: "0.0.0" },
    });
    rpc.notify("notifications/initialized", {});
    const listed = await rpc.request("tools/list", {});
    tools = (Array.isArray(listed.tools) ? listed.tools : [])
      .filter(isRecord)
      .map((tool) => `mcp__onyx__${String(tool.name)}`);
  }
  await writeLine(
    JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: process.cwd(),
      session_id: sessionId,
      tools: ["Read", "Edit", "Bash", ...tools],
      mcp_servers: rpc ? [{ name: "onyx", status: "connected" }] : [],
      model,
      permissionMode: flagValue("--permission-mode") ?? "default",
      apiKeySource: "none",
      claude_code_version: "0.0.0-stub",
    }),
  );
  if (!rpc || handle === null) {
    const reason = rpc ? "no symbol handle in the prompt" : "no onyx MCP server configured";
    await writeLine(
      assistantLine("msg_stub_mcp_0", [{ type: "text", text: `Skipped: ${reason}.` }]),
    );
    await writeLine(resultLine(`Skipped: ${reason}.`));
    rpc?.close();
    return;
  }

  const toolUseId = "toolu_stub_mcp_1";
  await writeLine(
    assistantLine("msg_stub_mcp_1", [
      { type: "tool_use", id: toolUseId, name: "mcp__onyx__expand_symbol", input: { handle } },
    ]),
  );
  const called = await rpc.request("tools/call", { name: "expand_symbol", arguments: { handle } });
  const text = (Array.isArray(called.content) ? called.content : [])
    .filter(isRecord)
    .map((part) => String(part.text ?? ""))
    .join("\n");
  await writeLine(
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: toolUseId,
            type: "tool_result",
            content: text,
            is_error: called.isError === true,
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: sessionId,
    }),
  );
  const summary = `Expanded #${handle} through the onyx MCP server (${text.split("\n").length} lines).`;
  await writeLine(assistantLine("msg_stub_mcp_2", [{ type: "text", text: summary }]));
  await writeLine(resultLine(summary));
  rpc.close();
}

interface HttpHookSettings {
  url: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
}

interface ToolAttempt {
  tool: string;
  input: Record<string, unknown>;
  fails?: boolean;
}

function readSettings(): Record<string, unknown> | null {
  const file = flagValue("--settings");
  if (!file) return null;
  try {
    const settings: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(settings) ? settings : null;
  } catch {
    return null;
  }
}

function readPreToolUseHook(): HttpHookSettings | null {
  return readHttpHook("PreToolUse");
}

function readHttpHook(event: string): HttpHookSettings | null {
  try {
    const settings = readSettings();
    if (!settings || !isRecord(settings.hooks)) return null;
    const matchers = settings.hooks[event];
    if (!Array.isArray(matchers)) return null;
    for (const matcher of matchers) {
      if (!isRecord(matcher) || !Array.isArray(matcher.hooks)) continue;
      for (const hook of matcher.hooks) {
        if (!isRecord(hook) || hook.type !== "http" || typeof hook.url !== "string") continue;
        return {
          url: hook.url,
          headers: isRecord(hook.headers) ? (hook.headers as Record<string, string>) : {},
          allowedEnvVars: Array.isArray(hook.allowedEnvVars)
            ? hook.allowedEnvVars.filter((name): name is string => typeof name === "string")
            : [],
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function interpolate(value: string, allowed: readonly string[]): string {
  return value.replace(/\$\{?(\w+)\}?/g, (_, name: string) =>
    allowed.includes(name) ? (process.env[name] ?? "") : "",
  );
}

function taskSection(prompt: string): string {
  const marker = "\n# Task\n\n";
  const index = prompt.lastIndexOf(marker);
  return index === -1 ? prompt : prompt.slice(index + marker.length);
}

function stubNotes(prompt: string): string[] {
  return [...taskSection(prompt).matchAll(/\bnote:\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

function parseAttempts(prompt: string): ToolAttempt[] {
  const attempts: ToolAttempt[] = [];
  for (const match of taskSection(prompt).matchAll(
    /\b(read|grep|glob|bash|fail|edit|write):(\{[^}]*\}|\S+)/g,
  )) {
    const kind = match[1];
    const raw = match[2] ?? "";
    const value = raw.startsWith("{") ? raw.slice(1, -1) : raw;
    if (kind === "read")
      attempts.push({ tool: "Read", input: { file_path: resolve(process.cwd(), value) } });
    if (kind === "grep")
      attempts.push({
        tool: "Grep",
        input: { pattern: "TODO", path: resolve(process.cwd(), value) },
      });
    if (kind === "glob") attempts.push({ tool: "Glob", input: { pattern: value } });
    if (kind === "bash") attempts.push({ tool: "Bash", input: { command: value } });
    if (kind === "fail") attempts.push({ tool: "Bash", input: { command: value }, fails: true });
    if (kind === "edit")
      attempts.push({
        tool: "Edit",
        input: { file_path: resolve(process.cwd(), value), old_string: "a", new_string: "b" },
      });
    if (kind === "write")
      attempts.push({
        tool: "Write",
        input: { file_path: resolve(process.cwd(), value), content: "stub" },
      });
  }
  return attempts;
}

async function askHook(
  hook: HttpHookSettings,
  attempt: ToolAttempt,
  toolUseId: string,
): Promise<string | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [name, value] of Object.entries(hook.headers))
    headers[name] = interpolate(value, hook.allowedEnvVars);
  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        cwd: process.cwd(),
        hook_event_name: "PreToolUse",
        tool_name: attempt.tool,
        tool_input: attempt.input,
        tool_use_id: toolUseId,
        permission_mode: flagValue("--permission-mode") ?? "default",
      }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.hookSpecificOutput)) return null;
    const output = payload.hookSpecificOutput;
    return output.permissionDecision === "deny"
      ? String(output.permissionDecisionReason ?? "denied")
      : null;
  } catch {
    return null;
  }
}

function simulateTool(attempt: ToolAttempt): string {
  if (attempt.fails)
    return `Exit code 1\n> ${String(attempt.input.command)}\nError: Cannot find module './generated/client' from src/db.ts`;
  if (attempt.tool === "Read") {
    try {
      return readFileSync(String(attempt.input.file_path), "utf8").slice(0, 400);
    } catch (error) {
      return `read failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (attempt.tool === "Edit" || attempt.tool === "Write") {
    const target = String(attempt.input.file_path);
    if (process.env.CLAUDE_STUB_APPLY_EDITS === "1") {
      try {
        mkdirSync(dirname(target), { recursive: true });
        if (attempt.tool === "Write") writeFileSync(target, "export const created = true;\n");
        else appendFileSync(target, `export const stubEdit${Date.now()} = true;\n`);
      } catch (error) {
        return `edit failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return `(stub) ${attempt.tool === "Edit" ? "edited" : "wrote"} ${target}`;
  }
  return "(stub) tool not executed";
}

function allowedBashRules(): string[] {
  const start = argv.indexOf("--allowedTools");
  if (start === -1) return [];
  const rules: string[] = [];
  for (const value of argv.slice(start + 1)) {
    if (value.startsWith("--")) break;
    const match = /^Bash\((.+)\)$/.exec(value);
    if (match?.[1]) rules.push(match[1]);
  }
  return rules;
}

function bashAllowed(command: string, rules: readonly string[]): boolean {
  return rules.some((rule) =>
    rule.endsWith(" *")
      ? command === rule.slice(0, -2) || command.startsWith(rule.slice(0, -1))
      : command === rule,
  );
}

async function runGuardScenario(prompt: string, enforceAllowlist = false): Promise<void> {
  const hook = readPreToolUseHook();
  const bashRules = allowedBashRules();
  const attempts = parseAttempts(prompt);
  await writeLine(
    JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: process.cwd(),
      session_id: sessionId,
      tools: ["Read", "Grep", "Glob", "Bash"],
      mcp_servers: [],
      model,
      permissionMode: flagValue("--permission-mode") ?? "default",
      apiKeySource: "none",
      claude_code_version: "0.0.0-stub",
    }),
  );
  const denials: PermissionDenial[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const toolUseId = `toolu_stub_guard_${index + 1}`;
    await writeLine(
      assistantLine(`msg_stub_guard_${index + 1}`, [
        { type: "tool_use", id: toolUseId, name: attempt.tool, input: attempt.input },
      ]),
    );
    const unlisted =
      enforceAllowlist &&
      attempt.tool === "Bash" &&
      !bashAllowed(String(attempt.input.command), bashRules);
    const denial = unlisted
      ? "This command requires approval"
      : hook
        ? await askHook(hook, attempt, toolUseId)
        : null;
    if (denial !== null)
      denials.push({ tool_name: attempt.tool, tool_use_id: toolUseId, tool_input: attempt.input });
    await writeLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: toolUseId,
              type: "tool_result",
              content:
                denial === null
                  ? simulateTool(attempt)
                  : `PreToolUse hook denied this tool call: ${denial}`,
              is_error: denial !== null || attempt.fails === true,
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: sessionId,
      }),
    );
  }
  const summary = [
    `Blocked ${denials.length} of ${attempts.length} tool calls.`,
    ...stubNotes(prompt),
  ].join("\n");
  await writeLine(assistantLine("msg_stub_guard_done", [{ type: "text", text: summary }]));
  await writeLine(resultLine(summary, denials));
}

async function postHook(hook: HttpHookSettings, body: object): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [name, value] of Object.entries(hook.headers))
    headers[name] = interpolate(value, hook.allowedEnvVars);
  try {
    const response = await fetch(hook.url, { method: "POST", headers, body: JSON.stringify(body) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function interactiveSessionStart(source: string, id: string): Promise<string | null> {
  const hook = readHttpHook("SessionStart");
  if (!hook) return null;
  const payload = await postHook(hook, {
    session_id: id,
    transcript_path: join(process.cwd(), `.stub-${id}.jsonl`),
    cwd: process.cwd(),
    hook_event_name: "SessionStart",
    source,
    model,
  });
  if (!isRecord(payload) || !isRecord(payload.hookSpecificOutput)) return null;
  const context = payload.hookSpecificOutput.additionalContext;
  return typeof context === "string" && context.length > 0 ? context : null;
}

function statusLineCommand(): string | null {
  const settings = readSettings();
  if (!settings || !isRecord(settings.statusLine)) return null;
  const command = settings.statusLine.command;
  return typeof command === "string" ? command : null;
}

function runStatusLine(command: string, payload: object): Promise<string> {
  return new Promise((resolveStatus) => {
    const child = exec(command, { timeout: 5_000 }, (error, stdout) => {
      resolveStatus(error ? "" : stdout.trim());
    });
    child.stdin?.end(JSON.stringify(payload));
  });
}

function rememberTranscript(id: string): void {
  const transcripts = process.env.CLAUDE_STUB_TRANSCRIPTS;
  if (!transcripts) return;
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(join(transcripts, id), "");
}

async function runInteractive(): Promise<void> {
  const baseTokens = Number(process.env.CLAUDE_STUB_BASE_TOKENS ?? "4000");
  const perMessage = Number(process.env.CLAUDE_STUB_TOKENS_PER_MESSAGE ?? "1500");
  let current = sessionId;
  let contextTokens = baseTokens;
  const say = (text: string) => process.stdout.write(`${text}\n`);
  const showContext = (context: string | null) => {
    if (context) say(`[context] ${context.split("\n")[0] ?? ""} (${context.length} chars)`);
  };
  const reportStatus = async () => {
    const command = statusLineCommand();
    if (!command) return;
    const status = await runStatusLine(command, {
      session_id: current,
      model: { id: model, display_name: model },
      cwd: process.cwd(),
      context_window: {
        context_window_size: 200_000,
        current_usage: {
          input_tokens: contextTokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 120,
        },
      },
    });
    if (status) say(`[status] ${status}`);
  };
  const transcripts = process.env.CLAUDE_STUB_TRANSCRIPTS;
  if (transcripts && argv.includes("--resume") && !existsSync(join(transcripts, current))) {
    process.stderr.write(`No conversation found with session ID: ${current}\n`);
    process.exit(1);
  }
  say(`Claude Code stub · ${model} · session ${current}`);
  showContext(
    await interactiveSessionStart(argv.includes("--resume") ? "resume" : "startup", current),
  );
  await reportStatus();
  process.stdout.write("> ");
  const lines = createInterface({ input: process.stdin, terminal: false });
  let pasted: string[] | null = null;
  for await (const raw of lines) {
    let line = raw;
    if (pasted !== null || line.includes("\u001b[200~")) {
      pasted = [...(pasted ?? []), line];
      if (!line.includes("\u001b[201~")) continue;
      line = pasted.join(" ").replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "");
      pasted = null;
    }
    const text = line.trim();
    if (text === "/exit") process.exit(0);
    if (text === "/clear") {
      current = randomUUID();
      contextTokens = baseTokens;
      say(`[cleared] session ${current}`);
      showContext(await interactiveSessionStart("clear", current));
    } else if (text.startsWith("/compact")) {
      contextTokens = baseTokens;
      say(`[compacted] ${text.slice("/compact".length).trim()}`);
      showContext(await interactiveSessionStart("compact", current));
    } else if (text.length > 0) {
      const promptHook = readHttpHook("UserPromptSubmit");
      if (promptHook)
        await postHook(promptHook, {
          session_id: current,
          hook_event_name: "UserPromptSubmit",
          cwd: process.cwd(),
          prompt: text,
        });
      contextTokens += perMessage;
      rememberTranscript(current);
      say(`Stub reply: ${text}`);
    }
    await reportStatus();
    process.stdout.write("> ");
  }
}

function promptSection(prompt: string, title: string): string {
  const start = prompt.indexOf(`## ${title}\n`);
  if (start === -1) return "";
  const rest = prompt.slice(start + title.length + 4);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

async function runRoadmapScenario(prompt: string): Promise<void> {
  const italian = prompt.includes("in Italian");
  const map = promptSection(prompt, "Project map");
  const files = [...map.matchAll(/([\w./-]+\.(?:tsx|ts|jsx|js|py|css))\b/g)].map(
    (match) => match[1] ?? "",
  );
  const code = files.find((file) => !file.endsWith(".css")) ?? "src/index.ts";
  const style =
    files.find((file) => file.endsWith(".css")) ??
    files.find((file) => file.endsWith(".tsx")) ??
    code;
  const workspace = /^- (\w+) \(/m.exec(promptSection(prompt, "Workspaces"))?.[1] ?? null;
  const todo = /^([^\s:]+):\d+ (?:TODO|FIXME|HACK|XXX): (.+)$/m.exec(
    promptSection(prompt, "TODO and FIXME notes"),
  );
  const items = [
    {
      title: italian ? `Coprire ${code} con i test` : `Cover ${code} with tests`,
      description: italian
        ? `Aggiungere test unitari per ${code} e verificarli con il test runner del progetto.`
        : `Add unit tests for ${code} and run them with the project test runner.`,
      kind: "test",
      priority: "high",
      effort: "M",
      workspace,
      targetPaths: [code],
      rationale: italian
        ? "Il file è centrale e non ha test."
        : "The file is central and untested.",
    },
    ...(todo
      ? [
          {
            title: italian ? `Risolvere: ${todo[2]}` : `Resolve: ${todo[2]}`,
            description: italian
              ? `Chiudere il TODO in ${todo[1]}.`
              : `Close the TODO in ${todo[1]}.`,
            kind: "bug",
            priority: "medium",
            effort: "S",
            workspace,
            targetPaths: [todo[1]],
            rationale: italian ? "Lasciato aperto nel codice." : "Left open in the code.",
          },
        ]
      : []),
    {
      title: italian ? "Rifinire gli stili dell'interfaccia" : "Polish the UI styles",
      description: italian
        ? `Uniformare spaziature e colori in ${style}.`
        : `Make spacing and colours consistent in ${style}.`,
      kind: "ui",
      priority: "medium",
      effort: "S",
      workspace: "Frontend",
      targetPaths: [style],
      rationale: null,
    },
    {
      title: italian ? "Documentare l'avvio del progetto" : "Document the project setup",
      description: italian
        ? "Spiegare nel README come installare, avviare e testare il progetto."
        : "Explain in the README how to install, run and test the project.",
      kind: "docs",
      priority: "low",
      effort: "S",
      workspace: null,
      targetPaths: ["README.md"],
      rationale: null,
    },
  ];
  const summary = italian
    ? "Progetto piccolo e leggibile; mancano test e documentazione."
    : "Small, readable project; tests and documentation are missing.";
  const answer = `\`\`\`json\n${JSON.stringify({ summary, items }, null, 2)}\n\`\`\``;
  await writeLine(initLine());
  await sleep(delayMs);
  await writeLine(
    assistantLine("msg_stub_roadmap_1", [
      {
        type: "tool_use",
        id: "toolu_stub_roadmap_1",
        name: "Read",
        input: { file_path: join(process.cwd(), "README.md") },
      },
    ]),
  );
  await sleep(delayMs);
  await writeLine(
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: "toolu_stub_roadmap_1",
            type: "tool_result",
            content: "(stub) README",
            is_error: false,
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: sessionId,
    }),
  );
  await sleep(delayMs);
  await writeLine(assistantLine("msg_stub_roadmap_2", [{ type: "text", text: answer }]));
  await writeLine(resultLine(answer));
}

function applyLikelyEdits(prompt: string): void {
  if (process.env.CLAUDE_STUB_APPLY_EDITS !== "1") return;
  const listed = /Files likely involved: (.+)$/m.exec(prompt)?.[1] ?? "";
  for (const path of listed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)) {
    const target = resolve(process.cwd(), path);
    if (!target.startsWith(process.cwd())) continue;
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, `\nexport const stubEdit${Date.now()} = true;\n`);
  }
}

interface TddEdit {
  tool: "Edit" | "Write" | "Bash";
  file?: string;
  command?: string;
  find?: string;
  replace?: string;
  content?: string;
}

interface TddStep {
  edits: TddEdit[];
  text?: string;
  hang?: boolean;
}

function takeTddStep(): TddStep | null {
  const planFile = process.env.CLAUDE_STUB_TDD_PLAN;
  if (!planFile) return null;
  try {
    const plan: unknown = JSON.parse(readFileSync(planFile, "utf8"));
    if (!Array.isArray(plan) || plan.length === 0) return null;
    const [first, ...rest] = plan;
    writeFileSync(planFile, JSON.stringify(rest));
    if (!isRecord(first) || !Array.isArray(first.edits)) return null;
    return {
      edits: first.edits.filter(
        (edit): edit is TddEdit =>
          isRecord(edit) && (typeof edit.file === "string" || typeof edit.command === "string"),
      ),
      ...(typeof first.text === "string" ? { text: first.text } : {}),
      ...(first.hang === true ? { hang: true } : {}),
    };
  } catch {
    return null;
  }
}

function tddAttempt(edit: TddEdit): ToolAttempt {
  const file = edit.file ?? "";
  const target = resolve(process.cwd(), file);
  if (edit.command !== undefined) return { tool: "Bash", input: { command: edit.command } };
  if (edit.tool === "Bash") {
    const script = `const fs=require("fs");const p=${JSON.stringify(file)};fs.writeFileSync(p,fs.readFileSync(p,"utf8").split(${JSON.stringify(edit.find ?? "")}).join(${JSON.stringify(edit.replace ?? "")}))`;
    return { tool: "Bash", input: { command: `node -e '${script.replaceAll("'", "'\\''")}'` } };
  }
  if (edit.tool === "Write")
    return { tool: "Write", input: { file_path: target, content: edit.content ?? "" } };
  return {
    tool: "Edit",
    input: { file_path: target, old_string: edit.find ?? "", new_string: edit.replace ?? "" },
  };
}

function applyTddEdit(edit: TddEdit): string {
  if (edit.command !== undefined) return "(stub) command not executed";
  const target = resolve(process.cwd(), edit.file ?? "");
  try {
    if (edit.tool === "Write") {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, edit.content ?? "");
      return `File created successfully at: ${target}`;
    }
    const before = readFileSync(target, "utf8");
    const find = edit.find ?? "";
    if (find.length > 0 && !before.includes(find))
      return `String to replace not found in ${target}`;
    writeFileSync(target, before.split(find).join(edit.replace ?? ""));
    return `The file ${target} has been updated.`;
  } catch (error) {
    return `edit failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function editInitLine(): string {
  return JSON.stringify({
    type: "system",
    subtype: "init",
    cwd: process.cwd(),
    session_id: sessionId,
    tools: ["Read", "Edit", "Write", "Bash"],
    mcp_servers: [],
    model,
    permissionMode: flagValue("--permission-mode") ?? "default",
    apiKeySource: "none",
    claude_code_version: "0.0.0-stub",
  });
}

function isTddEdit(edit: unknown): edit is TddEdit {
  return isRecord(edit) && (typeof edit.file === "string" || typeof edit.command === "string");
}

async function runTddScenario(prompt: string): Promise<void> {
  await writeLine(editInitLine());
  const step = takeTddStep();
  const firstFailure = /^### 1\. (.+)$/m.exec(prompt)?.[1] ?? "the failures";
  await runEditStep(
    step,
    step?.text ??
      (step
        ? `Fixed the implementation for ${firstFailure}.`
        : `Looked at ${firstFailure}; no change.`),
  );
}

async function runEditStep(step: TddStep | null, summary: string): Promise<void> {
  const hook = readPreToolUseHook();
  const denials: PermissionDenial[] = [];
  for (const [index, edit] of (step?.edits ?? []).entries()) {
    const attempt = tddAttempt(edit);
    const toolUseId = `toolu_stub_tdd_${index + 1}`;
    await writeLine(
      assistantLine(`msg_stub_tdd_${index + 1}`, [
        { type: "tool_use", id: toolUseId, name: attempt.tool, input: attempt.input },
      ]),
    );
    const denial = hook ? await askHook(hook, attempt, toolUseId) : null;
    if (denial !== null)
      denials.push({ tool_name: attempt.tool, tool_use_id: toolUseId, tool_input: attempt.input });
    await writeLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: toolUseId,
              type: "tool_result",
              content:
                denial === null
                  ? applyTddEdit(edit)
                  : `PreToolUse hook denied this tool call: ${denial}`,
              is_error: denial !== null,
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: sessionId,
      }),
    );
  }
  if (step?.hang) return hangForever();
  await writeLine(assistantLine("msg_stub_tdd_done", [{ type: "text", text: summary }]));
  await writeLine(resultLine(summary, denials));
}

function taskBody(prompt: string): string {
  const marker = prompt.lastIndexOf("# Task\n\n");
  const body = marker === -1 ? prompt : prompt.slice(marker + "# Task\n\n".length);
  const end = body.indexOf("\n## Context");
  return end === -1 ? body : body.slice(0, end);
}

interface KeyedStep extends TddStep {
  delayMs: number;
  scenario: string | null;
}

function keyedStep(prompt: string): KeyedStep | null {
  const file = process.env.CLAUDE_STUB_EDITS;
  if (!file) return null;
  try {
    const map: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(map)) return null;
    const body = taskBody(prompt);
    for (const [key, value] of Object.entries(map)) {
      if (!body.includes(key) || !isRecord(value)) continue;
      return {
        edits: Array.isArray(value.edits) ? value.edits.filter(isTddEdit) : [],
        delayMs: typeof value.delayMs === "number" ? value.delayMs : 0,
        scenario: typeof value.scenario === "string" ? value.scenario : null,
        ...(typeof value.text === "string" ? { text: value.text } : {}),
        ...(value.hang === true ? { hang: true } : {}),
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function runKeyedScenario(step: KeyedStep): Promise<void> {
  await writeLine(editInitLine());
  await sleep(step.delayMs);
  await runEditStep(step, step.text ?? `Applied ${step.edits.length} change(s).`);
}

function stubPlan(prompt: string): unknown {
  const planFile = process.env.CLAUDE_STUB_PLAN;
  if (planFile) {
    try {
      return JSON.parse(readFileSync(planFile, "utf8"));
    } catch {
      return null;
    }
  }
  const goal = promptSection(prompt, "Feature").trim();
  const workspaces = [
    ...promptSection(prompt, "Workspaces").matchAll(/^- (.+?) \((\w+)\): (.+)$/gm),
  ].map((match) => match[1] ?? "");
  const parts = workspaces.slice(0, 2).map((workspace, index) => ({
    key: `part-${index + 1}`,
    title: `${workspace}: ${goal.slice(0, 60)}`,
    description: `Implement the ${workspace} side of: ${goal}`,
    workspace,
    kind: "FEATURE",
    tier: "BUILDER",
    dependsOn: [],
    targetPaths: [],
    acceptance: ["The project tests pass"],
  }));
  return {
    summary: `Split the feature by workspace and connect the parts at the end.`,
    tasks: [
      ...parts,
      {
        key: "wire-up",
        title: "Connect the parts",
        description: `Connect the parts of: ${goal}`,
        workspace: workspaces[0] ?? "",
        kind: "FEATURE",
        tier: "BUILDER",
        dependsOn: parts.map((part) => part.key),
        targetPaths: [],
        acceptance: ["The project tests pass"],
      },
    ],
  };
}

async function runPlanScenario(prompt: string): Promise<void> {
  await writeLine(initLine());
  await sleep(delayMs);
  for (const [index, tool] of ["Glob", "Read"].entries()) {
    const id = `toolu_stub_plan_${index + 1}`;
    await writeLine(
      assistantLine(`msg_stub_plan_${index + 1}`, [
        {
          type: "tool_use",
          id,
          name: tool,
          input:
            tool === "Glob"
              ? { pattern: "**/*.ts" }
              : { file_path: join(process.cwd(), "README.md") },
        },
      ]),
    );
    await writeLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ tool_use_id: id, type: "tool_result", content: "(stub)", is_error: false }],
        },
        parent_tool_use_id: null,
        session_id: sessionId,
      }),
    );
    await sleep(delayMs);
  }
  const plan = stubPlan(prompt);
  if (plan === null) {
    await writeLine(assistantLine("msg_stub_plan_done", [{ type: "text", text: "No plan." }]));
    await writeLine(resultLine("I could not produce a plan."));
    return;
  }
  const text = JSON.stringify(plan);
  await writeLine(assistantLine("msg_stub_plan_done", [{ type: "text", text }]));
  await writeLine(
    withExplorerUsage(
      resultLine(text, [], process.env.CLAUDE_STUB_PLAN_AS_TEXT === "1" ? undefined : plan),
    ),
  );
}

async function runBatchScenario(prompt: string): Promise<void> {
  await writeLine(initLine());
  await sleep(delayMs);
  const sections = prompt.split(/^## Task \d+: /m).slice(1);
  const lines = sections.flatMap((section, index) => {
    if (section.includes("[stub:skip-task]")) return [];
    if (section.includes("[stub:fail-task]"))
      return [`TASK ${index + 1}: FAILED the stub could not do this one`];
    return [`TASK ${index + 1}: DONE`];
  });
  const text = ["Worked through the grouped tasks.", ...lines].join("\n");
  await writeLine(assistantLine("msg_stub_batch_done", [{ type: "text", text }]));
  await writeLine(resultLine(text));
}

function headingSection(prompt: string, title: string): string {
  const start = prompt.indexOf(`# ${title}\n`);
  if (start === -1) return "";
  const rest = prompt.slice(start + title.length + 3);
  const end = rest.search(/\n# /);
  return end === -1 ? rest : rest.slice(0, end);
}

async function runQaScenario(prompt: string): Promise<void> {
  await writeLine(initLine());
  await sleep(delayMs);
  const criteria = [...headingSection(prompt, "Acceptance criteria").matchAll(/^(\d+)\. /gm)].map(
    (match) => Number(match[1]),
  );
  const files = [...headingSection(prompt, "Changed files").matchAll(/^- (.+)$/gm)].map(
    (match) => match[1] ?? "",
  );
  const attempt = Number(/Review attempt: (\d+)/.exec(prompt)?.[1] ?? "1");
  const fail =
    prompt.includes("[stub:qa-fail]") || (prompt.includes("[stub:qa-fail-once]") && attempt === 1);
  const file = files[0] ?? "README.md";
  const verdict = {
    verdict: fail ? "fail" : "pass",
    summary: fail ? "The change misses the empty case." : "The change does what the task asks.",
    criteria: criteria.map((index) => ({
      index,
      met: !(fail && index === 1),
      evidence: prompt.includes("[stub:qa-no-evidence]")
        ? "Looks right to me"
        : `${file}:1 the change is in the diff`,
    })),
    issues: fail ? [{ file, problem: "The empty case is not handled" }] : [],
  };
  const text = JSON.stringify(verdict);
  await writeLine(assistantLine("msg_stub_qa", [{ type: "text", text }]));
  await writeLine(resultLine(text, [], verdict));
}

async function runResolutionScenario(prompt: string): Promise<void> {
  await writeLine(initLine());
  await sleep(delayMs);
  const files = [...headingSection(prompt, "Conflicted files").matchAll(/^- (.+)$/gm)].map(
    (match) => match[1] ?? "",
  );
  if (!prompt.includes("[stub:resolve-leave]"))
    for (const file of files) {
      const path = join(process.cwd(), file);
      const content = readFileSync(path, "utf8");
      writeFileSync(
        path,
        content.replace(
          /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}[^\n]*\n/gm,
          (_block, ours: string, theirs: string) => `${ours}${theirs}`,
        ),
      );
    }
  const text = `Kept both sides in ${files.join(", ")}.`;
  await writeLine(assistantLine("msg_stub_resolve", [{ type: "text", text }]));
  await writeLine(resultLine(text));
}

async function runInsightScenario(prompt: string): Promise<void> {
  await writeLine(initLine());
  await sleep(delayMs);
  const found = headingSection(prompt, "What the Onyx index already found");
  const cited = /`([\w@./-]+\.[a-z]{1,5}(?::\d+)?)`/.exec(found)?.[1] ?? "README.md:1";
  const question = headingSection(prompt, "Question").trim();
  const text = `From the code: \`${cited}\` answers "${question}".`;
  await writeLine(assistantLine("msg_stub_insight", [{ type: "text", text }]));
  await writeLine(resultLine(text));
}

async function runIdeationScenario(prompt: string): Promise<void> {
  await writeLine(initLine());
  await sleep(delayMs);
  const items = [
    ...prompt.matchAll(/^## Item (\d+): [^\n]*\n([\s\S]*?)(?=^## Item |\nAnswer with)/gm),
  ];
  const verdict = {
    findings: items.map((match) => {
      const flagged = /^\s*\d+> .*$/m.exec(match[2] ?? "")?.[0] ?? "";
      const falsePositive = flagged.includes("stub-fp");
      return {
        id: match[1] ?? "",
        verdict: falsePositive ? "false_positive" : "real",
        confidence: falsePositive ? 0.1 : 0.85,
        explanation: falsePositive
          ? "The value never comes from outside."
          : "Outside input reaches this call.",
        ...(falsePositive ? {} : { fix: "Pass the value as a parameter instead." }),
      };
    }),
  };
  const text = JSON.stringify(verdict);
  await writeLine(assistantLine("msg_stub_ideation", [{ type: "text", text }]));
  await writeLine(resultLine(text, [], verdict));
}

function withExplorerUsage(line: string): string {
  const agentsPath = flagValue("--agents");
  if (!agentsPath) return line;
  let agents: unknown;
  try {
    agents = JSON.parse(readFileSync(agentsPath, "utf8"));
  } catch {
    return line;
  }
  if (!isRecord(agents) || !isRecord(agents.explorer)) return line;
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const usage = (tokens: number) => ({
    inputTokens: tokens,
    outputTokens: Math.round(tokens / 10),
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    contextWindow: 200_000,
  });
  parsed.modelUsage = {
    [model]: { ...usage(600), costUSD: 0.0025 },
    "claude-haiku-4-5": { ...usage(900), costUSD: 0.0006 },
  };
  parsed.total_cost_usd = 0.0031;
  return JSON.stringify(parsed);
}

function base64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function inkText(column: number, text: string): string {
  let position = column;
  return text
    .split(" ")
    .map((word) => {
      const placed = `\u001b[${position}G${word}`;
      position += word.length + 1;
      return placed;
    })
    .join("");
}

function stubSignInUrl(): string {
  return [
    "https://claude.com/cai/oauth/authorize?code=true",
    "client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    "response_type=code",
    "redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback",
    "scope=user%3Ainference",
    `code_challenge=${base64Url(32)}`,
    "code_challenge_method=S256",
    `state=${base64Url(32)}`,
  ].join("&");
}

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const LONG_TYPED_CHUNK = 64;

async function runSetupToken(): Promise<void> {
  const say = (text: string) => process.stdout.write(`${text}\r\n`);
  const grey = (text: string) => `\u001b[38;2;153;153;153m${text}\u001b[39m`;
  const offerLink = () => {
    const url = stubSignInUrl();
    say(grey("Browser didn't open? Use the url below to sign in (c to copy)"));
    say("");
    say(`\u001b]8;id=stub;${url}\u0007${grey(url)}\u001b]8;;\u0007`);
    say("");
    process.stdout.write(`${inkText(2, "Paste code here if prompted >")} `);
  };
  process.stdout.write("\u001b[?2004h");
  say(`Welcome to Claude Code ${grey("v0.0.0-stub")}`);
  say("");
  say(
    `\u001b[1m${inkText(2, "This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required.")}\u001b[22m`,
  );
  say("");
  say(inkText(2, "· Opening browser to sign in…"));
  say("");
  offerLink();
  let failed = false;
  let buffer = "";
  let pasting = false;
  const submit = () => {
    const code = buffer.trim();
    buffer = "";
    if (failed) {
      failed = false;
      say("");
      offerLink();
      return;
    }
    if (code.length === 0) return;
    if (code === "bad") {
      failed = true;
      say("");
      say("OAuth error: Request failed with status code 400");
      say("Press Enter to retry.");
      return;
    }
    const token = `sk-ant-oat01-${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}-stubAA`;
    say("");
    say("✓ Long-lived authentication token created successfully!");
    say("");
    say("Your OAuth token (valid for 1 year):");
    say("");
    say(token);
    say("");
    say("Store this token securely. You won't be able to see it again.");
    setTimeout(() => process.exit(0), 500);
  };
  const typed = (text: string) => {
    if (text.length > LONG_TYPED_CHUNK) {
      buffer += text;
      return;
    }
    for (const char of text) {
      if (char === "\r" || char === "\n") submit();
      else if (char === "\u007f") buffer = buffer.slice(0, -1);
      else if (char === "\u0003") process.exit(130);
      else buffer += char;
    }
  };
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    let text = chunk;
    while (text.length > 0) {
      if (pasting) {
        const end = text.indexOf(PASTE_END);
        buffer += end === -1 ? text : text.slice(0, end);
        text = end === -1 ? "" : text.slice(end + PASTE_END.length);
        pasting = end === -1;
        continue;
      }
      const begin = text.indexOf(PASTE_START);
      if (begin === -1) {
        typed(text);
        text = "";
      } else {
        typed(text.slice(0, begin));
        text = text.slice(begin + PASTE_START.length);
        pasting = true;
      }
    }
  });
  await new Promise<never>(() => undefined);
}

interface ProbeStep {
  path: string;
  action: "read" | "write" | "list";
}

function probe(step: ProbeStep): {
  path: string;
  action: string;
  ok: boolean;
  code: string | null;
} {
  try {
    if (step.action === "read") readFileSync(step.path);
    else if (step.action === "list") readdirSync(step.path);
    else writeFileSync(step.path, "written by the agent\n");
    return { ...step, ok: true, code: null };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "ERROR";
    return { ...step, ok: false, code };
  }
}

async function runProbeScenario(): Promise<void> {
  const file = process.env.CLAUDE_STUB_PROBE;
  const steps: ProbeStep[] = file ? (JSON.parse(readFileSync(file, "utf8")) as ProbeStep[]) : [];
  const report = JSON.stringify({
    uid: process.getuid?.() ?? null,
    home: process.env.HOME ?? null,
    results: steps.map(probe),
  });
  await replay([
    initLine(),
    assistantLine("msg_stub_probe", [{ type: "text", text: report }]),
    resultLine(report),
  ]);
}

function missingCredentials(): boolean {
  if (process.env.CLAUDE_STUB_REQUIRE_AUTH !== "1") return false;
  return !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY;
}

async function main(): Promise<void> {
  if (argv[0] === "setup-token") return runSetupToken();
  if (!argv.includes("-p")) return runInteractive();
  const prompt = await readPrompt();
  if (flagValue("--input-format") === "stream-json" && prompt.length === 0) return;
  rememberTranscript(sessionId);
  if (process.env.CLAUDE_STUB_USAGE === "model")
    usageModel = new UsageModel(estimateTokens(prompt));
  if (missingCredentials()) {
    await writeLine(initLine());
    await writeLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        duration_ms: 40,
        duration_api_ms: 0,
        num_turns: 1,
        session_id: sessionId,
        total_cost_usd: 0,
        usage: STUB_USAGE,
        modelUsage: {},
        permission_denials: [],
        result: "Invalid API key · Please run /login",
      }),
    );
    return;
  }
  if (prompt.includes("ONYX_ROADMAP_REQUEST")) {
    await runRoadmapScenario(prompt);
    return;
  }
  if (prompt.includes("ONYX_PLAN_REQUEST")) {
    await runPlanScenario(prompt);
    return;
  }
  if (prompt.startsWith("ONYX_INSIGHT_QUESTION")) {
    await runInsightScenario(prompt);
    return;
  }
  if (prompt.startsWith("ONYX_IDEATION_REVIEW")) {
    await runIdeationScenario(prompt);
    return;
  }
  if (prompt.startsWith("ONYX_QA_REQUEST")) {
    await runQaScenario(prompt);
    return;
  }
  if (prompt.startsWith("ONYX_MERGE_RESOLUTION")) {
    await runResolutionScenario(prompt);
    return;
  }
  if (prompt.includes("Onyx TDD loop")) {
    await runTddScenario(prompt);
    return;
  }
  if (/^# \d+ small tasks$/m.test(prompt)) {
    await runBatchScenario(prompt);
    return;
  }
  const keyed = keyedStep(prompt);
  if (keyed && keyed.scenario === null) {
    await runKeyedScenario(keyed);
    return;
  }
  const scenario = keyed?.scenario ?? scenarioFor(prompt);
  switch (scenario) {
    case "success":
    case "quick":
    case "error-max-turns":
    case "partial":
      applyLikelyEdits(prompt);
      await replay(renderFixture(scenario, prompt));
      return;
    case "lost-session":
      if (flagValue("--resume") !== null) {
        process.stderr.write(`No conversation found with session ID: ${sessionId}\n`);
        await writeLine(
          JSON.stringify({
            type: "result",
            subtype: "error_during_execution",
            duration_ms: 0,
            duration_api_ms: 0,
            is_error: true,
            num_turns: 0,
            stop_reason: null,
            session_id: sessionId,
            total_cost_usd: 0,
            usage: {
              input_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 0,
            },
            modelUsage: {},
            permission_denials: [],
            errors: [`No conversation found with session ID: ${sessionId}`],
          }),
        );
        process.exit(1);
      }
      await replay(renderFixture("quick", prompt));
      return;
    case "compact": {
      const lines = renderFixture("quick", prompt);
      const boundary = JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        session_id: sessionId,
        compact_metadata: { trigger: "auto", pre_tokens: 150_000 },
      });
      await replay([...lines.slice(0, -1), boundary, ...lines.slice(-1)]);
      return;
    }
    case "probe":
      await runProbeScenario();
      return;
    case "crash":
      await replay([initLine()]);
      process.stderr.write("fatal: simulated crash\n");
      process.exit(3);
      return;
    case "hang":
      await replay([initLine()]);
      return hangForever();
    case "stubborn":
      process.on("SIGINT", () => undefined);
      process.on("SIGTERM", () => undefined);
      await replay([initLine()]);
      return hangForever();
    case "grandchild": {
      await replay([initLine()]);
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      await writeLine(
        JSON.stringify({ type: "system", subtype: "stub_grandchild", pid: child.pid }),
      );
      return hangForever();
    }
    case "split-lines":
      await writeInChunks(`${renderFixture("success", prompt).join("\n")}\n`, 7);
      return;
    case "garbage":
      await writeLine("this is not json");
      await replay(renderFixture("quick", prompt));
      return;
    case "silent":
      return hangForever();
    case "mcp":
      await runMcpScenario(prompt);
      return;
    case "guard":
      await runGuardScenario(prompt);
      return;
    case "allowlist":
      await runGuardScenario(prompt, true);
      return;
    default:
      process.stderr.write(`unknown stub scenario: ${scenario}\n`);
      process.exit(2);
  }
}

await main();
process.stdin.destroy();
