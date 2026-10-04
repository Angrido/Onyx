#!/usr/bin/env node
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    resultLine(text, [], process.env.CLAUDE_STUB_PLAN_AS_TEXT === "1" ? undefined : plan),
  );
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

function missingCredentials(): boolean {
  if (process.env.CLAUDE_STUB_REQUIRE_AUTH !== "1") return false;
  return !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY;
}

async function main(): Promise<void> {
  if (argv[0] === "setup-token") return runSetupToken();
  if (!argv.includes("-p")) return runInteractive();
  const prompt = await readPrompt();
  if (flagValue("--input-format") === "stream-json" && prompt.length === 0) return;
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
  if (prompt.includes("Onyx TDD loop")) {
    await runTddScenario(prompt);
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
