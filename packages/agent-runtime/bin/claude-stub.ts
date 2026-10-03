#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

async function main(): Promise<void> {
  const prompt = await readPrompt();
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
    default:
      process.stderr.write(`unknown stub scenario: ${scenario}\n`);
      process.exit(2);
  }
}

await main();
process.stdin.destroy();
