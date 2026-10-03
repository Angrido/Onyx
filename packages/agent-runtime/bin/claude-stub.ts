#!/usr/bin/env node
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  const marker = /\[stub:([a-z-]+)\]/.exec(prompt);
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

function writeLine(line: string): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.write(`${line}\n`)) resolve();
    else process.stdout.once("drain", () => resolve());
  });
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

function resultLine(text: string, denials: PermissionDenial[] = []): string {
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
    /\b(read|grep|glob|bash|edit|write):(\{[^}]*\}|\S+)/g,
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
  if (attempt.tool === "Read") {
    try {
      return readFileSync(String(attempt.input.file_path), "utf8").slice(0, 400);
    } catch (error) {
      return `read failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (attempt.tool === "Edit" || attempt.tool === "Write") {
    return `(stub) ${attempt.tool === "Edit" ? "edited" : "wrote"} ${String(attempt.input.file_path)}`;
  }
  return "(stub) tool not executed";
}

async function runGuardScenario(prompt: string): Promise<void> {
  const hook = readPreToolUseHook();
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
                  ? simulateTool(attempt)
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
  say(`Claude Code stub · ${model} · session ${current}`);
  showContext(
    await interactiveSessionStart(argv.includes("--resume") ? "resume" : "startup", current),
  );
  await reportStatus();
  process.stdout.write("> ");
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
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
      say(`Stub reply: ${text}`);
    }
    await reportStatus();
    process.stdout.write("> ");
  }
}

async function runSetupToken(): Promise<void> {
  const say = (text: string) => process.stdout.write(`${text}\r\n`);
  say("Opening browser to sign in with your Claude account…");
  say("");
  say("Browse to: https://claude.ai/oauth/authorize?code=true&client_id=onyx-stub&state=stub");
  say("");
  process.stdout.write("Paste code here if prompted > ");
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    const code = line.trim();
    if (code.length === 0) continue;
    if (code === "bad") {
      say("");
      say("OAuth error: Invalid code. Please make sure the full code was copied.");
      process.exit(1);
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
    process.exit(0);
  }
}

function missingCredentials(): boolean {
  if (process.env.CLAUDE_STUB_REQUIRE_AUTH !== "1") return false;
  return !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY;
}

async function main(): Promise<void> {
  if (argv[0] === "setup-token") return runSetupToken();
  if (!argv.includes("-p")) return runInteractive();
  const prompt = await readPrompt();
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
  const scenario = scenarioFor(prompt);
  switch (scenario) {
    case "success":
    case "quick":
    case "error-max-turns":
    case "partial":
      await replay(renderFixture(scenario, prompt));
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
    default:
      process.stderr.write(`unknown stub scenario: ${scenario}\n`);
      process.exit(2);
  }
}

await main();
process.stdin.destroy();
