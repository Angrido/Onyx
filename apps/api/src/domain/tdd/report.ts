export type FailureKind = "test" | "suite" | "typecheck" | "lint" | "run";

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface StackFrame extends SourceLocation {
  fn: string | null;
}

export interface TestFailure {
  kind: FailureKind;
  file: string;
  name: string;
  errorType: string;
  message: string;
  frames: StackFrame[];
  location: SourceLocation | null;
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
  passedIds: string[];
}

export const MAX_FRAMES = 5;
const MAX_MESSAGE_LINES = 24;
const MAX_MESSAGE_CHARS = 1_600;
const MAX_SUITE_LINES = 20;
const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);

export function stripAnsi(text: string): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char !== ESCAPE) {
      output += char;
      index += 1;
      continue;
    }
    const next = text[index + 1];
    if (next === "[") {
      index += 2;
      while (index < text.length) {
        const code = text.charCodeAt(index);
        index += 1;
        if (code >= 0x40 && code <= 0x7e) break;
      }
      continue;
    }
    if (next === "]") {
      index += 2;
      while (index < text.length) {
        if (text[index] === BELL) {
          index += 1;
          break;
        }
        if (text[index] === ESCAPE && text[index + 1] === "\\") {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 2;
  }
  return output;
}

export function failureId(failure: Pick<TestFailure, "file" | "name">): string {
  return `${failure.file}::${failure.name}`;
}

export class PathResolver {
  private readonly roots: string[];

  constructor(roots: readonly string[]) {
    this.roots = [...new Set(roots.map((root) => root.replace(/\/+$/, "")))].sort(
      (a, b) => b.length - a.length,
    );
  }

  relative(rawPath: string): string | null {
    let path = rawPath.trim();
    if (path.startsWith("file://")) path = decodeURIComponent(path.slice("file://".length));
    if (path.length === 0 || path.startsWith("node:") || path.includes("<anonymous>")) return null;
    if (path.includes("/node_modules/") || path.startsWith("node_modules/")) return null;
    if (path.startsWith("/")) {
      for (const root of this.roots) {
        if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
      }
      return null;
    }
    const cleaned = path.replace(/^\.\//, "");
    if (cleaned.startsWith("../") || cleaned.startsWith("internal/")) return null;
    return cleaned;
  }

  display(rawPath: string): string {
    return this.relative(rawPath) ?? rawPath;
  }

  relativize(text: string): string {
    let output = text;
    for (const root of this.roots) output = output.split(`${root}/`).join("");
    return output;
  }
}

const FRAME_WITH_FUNCTION = /^\s*at\s+(.*?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const FRAME_BARE = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;
const FRAME_LINE = /^\s*at\s+/;
const POINTER_FRAME = /^\s*❯\s+(?:(\S+)\s+)?(\S+):(\d+):(\d+)\s*$/;

export function parseFrame(line: string, paths: PathResolver): StackFrame | null {
  const withFunction = FRAME_WITH_FUNCTION.exec(line);
  const bare = withFunction ? null : FRAME_BARE.exec(line);
  const pointer = withFunction || bare ? null : POINTER_FRAME.exec(line);
  const raw = withFunction
    ? {
        fn: withFunction[1] ?? null,
        path: withFunction[2],
        line: withFunction[3],
        col: withFunction[4],
      }
    : bare
      ? { fn: null, path: bare[1], line: bare[2], col: bare[3] }
      : pointer
        ? { fn: pointer[1] ?? null, path: pointer[2], line: pointer[3], col: pointer[4] }
        : null;
  if (!raw?.path) return null;
  const file = paths.relative(raw.path);
  if (file === null) return null;
  return {
    file,
    line: Number(raw.line),
    column: Number(raw.col),
    fn: raw.fn && raw.fn !== "Object.<anonymous>" ? raw.fn : null,
  };
}

export function errorTypeOf(message: string): string {
  const first =
    message
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "";
  if (/\bexpect\(/.test(first) || /^AssertionError\b/.test(first)) return "AssertionError";
  const named = /^([A-Z][A-Za-z0-9_]*(?:Error|Exception))\b/.exec(first);
  if (named?.[1]) return named[1];
  const prefixed = /^([A-Za-z_][\w.]*):/.exec(first);
  if (prefixed?.[1] && prefixed[1] !== "Error") return prefixed[1];
  return "Error";
}

function clipLines(lines: readonly string[], maxLines: number, maxChars: number): string {
  const kept: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (kept.length >= maxLines || chars + line.length > maxChars) {
      kept.push("… (truncated)");
      break;
    }
    kept.push(line);
    chars += line.length + 1;
  }
  while (kept.length > 0 && (kept.at(-1) ?? "").trim().length === 0) kept.pop();
  return kept.join("\n");
}

function collapseBlankRuns(lines: readonly string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0 && (output.at(-1) ?? "").trim().length === 0) continue;
    output.push(line.replace(/\s+$/, ""));
  }
  while (output.length > 0 && (output[0] ?? "").trim().length === 0) output.shift();
  return output;
}

export function dedent(lines: readonly string[]): string[] {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const shift = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(Math.min(shift, /^\s*/.exec(line)?.[0].length ?? 0)));
}

export interface ParsedError {
  errorType: string;
  message: string;
  frames: StackFrame[];
}

export function parseErrorText(raw: string, paths: PathResolver): ParsedError {
  const lines = stripAnsi(raw).replace(/\r\n?/g, "\n").split("\n");
  const firstFrame = lines.findIndex((line) => FRAME_LINE.test(line));
  const messageLines = collapseBlankRuns(
    dedent(firstFrame === -1 ? lines : lines.slice(0, firstFrame)),
  );
  const frames: StackFrame[] = [];
  for (const line of firstFrame === -1 ? [] : lines.slice(firstFrame)) {
    const frame = parseFrame(line, paths);
    if (!frame) continue;
    if (frames.some((seen) => seen.file === frame.file && seen.line === frame.line)) continue;
    frames.push(frame);
    if (frames.length >= MAX_FRAMES) break;
  }
  const message = clipLines(
    messageLines.map((line) => paths.relativize(line)),
    MAX_MESSAGE_LINES,
    MAX_MESSAGE_CHARS,
  );
  return { errorType: errorTypeOf(message), message, frames };
}

export function parseSuiteMessage(raw: string, paths: PathResolver): ParsedError {
  const text = stripAnsi(raw).replace(/\r\n?/g, "\n");
  const detailsAt = text.search(/^\s*Details:\s*$/m);
  const relevant = detailsAt === -1 ? text : text.slice(detailsAt).replace(/^\s*Details:\s*\n/, "");
  const lines = relevant.split("\n");
  const frames: StackFrame[] = [];
  const body: string[] = [];
  for (const line of lines) {
    if (FRAME_LINE.test(line) || POINTER_FRAME.test(line)) {
      const frame = parseFrame(line, paths);
      if (frame && frames.length < MAX_FRAMES) frames.push(frame);
      continue;
    }
    if (/^\s*●\s*Test suite failed to run\s*$/.test(line)) continue;
    body.push(paths.relativize(line));
  }
  const message = clipLines(collapseBlankRuns(dedent(body)), MAX_SUITE_LINES, MAX_MESSAGE_CHARS);
  const location =
    /([\w./@-]+\.[cm]?[jt]sx?)[:(](\d+)[:,](\d+)/.exec(message) ??
    /([\w./@-]+\.[cm]?[jt]sx?)\s+\((\d+):(\d+)\)/.exec(message);
  if (location?.[1] && frames.length === 0) {
    const file = paths.relative(location[1]);
    if (file !== null)
      frames.push({ file, line: Number(location[2]), column: Number(location[3]), fn: null });
  }
  return { errorType: errorTypeOf(message), message, frames };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function testName(assertion: Record<string, unknown>): string {
  const ancestors = Array.isArray(assertion.ancestorTitles)
    ? assertion.ancestorTitles.filter((title): title is string => typeof title === "string")
    : [];
  const title = stringField(assertion, "title");
  const parts = [...ancestors, title].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" › ") : stringField(assertion, "fullName") || "(unnamed)";
}

function locationFrom(frames: readonly StackFrame[]): SourceLocation | null {
  const frame = frames[0];
  return frame ? { file: frame.file, line: frame.line, column: frame.column } : null;
}

export function parseJsonReport(raw: unknown, paths: PathResolver): TestReport | null {
  if (!isRecord(raw) || !Array.isArray(raw.testResults)) return null;
  const failures: TestFailure[] = [];
  const passedIds: string[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const suite of raw.testResults) {
    if (!isRecord(suite)) continue;
    const file = paths.display(stringField(suite, "name") || stringField(suite, "testFilePath"));
    const assertions = Array.isArray(suite.assertionResults)
      ? suite.assertionResults.filter(isRecord)
      : [];
    let suiteFailures = 0;
    for (const assertion of assertions) {
      const status = stringField(assertion, "status");
      const name = testName(assertion);
      if (status === "passed") {
        passed += 1;
        passedIds.push(failureId({ file, name }));
        continue;
      }
      if (status !== "failed") {
        skipped += 1;
        continue;
      }
      failed += 1;
      suiteFailures += 1;
      const messages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.filter((entry): entry is string => typeof entry === "string")
        : [];
      const parsed = parseErrorText(
        messages.join("\n\n") || "Test failed without a message",
        paths,
      );
      failures.push({
        kind: "test",
        file,
        name,
        errorType: parsed.errorType,
        message: parsed.message,
        frames: parsed.frames,
        location: locationFrom(parsed.frames),
      });
    }
    const suiteMessage = stringField(suite, "message");
    const suiteFailed = stringField(suite, "status") === "failed";
    if (suiteFailed && suiteFailures === 0) {
      const parsed = parseSuiteMessage(
        suiteMessage.trim().length > 0 ? suiteMessage : "The test file failed to run",
        paths,
      );
      failed += 1;
      failures.push({
        kind: "suite",
        file,
        name: "(test file failed to run)",
        errorType: parsed.errorType,
        message: parsed.message,
        frames: parsed.frames,
        location: locationFrom(parsed.frames),
      });
    }
  }
  const total = passed + failed + skipped;
  return {
    total: Math.max(total, numberField(raw, "numTotalTests")),
    passed,
    failed,
    skipped,
    failures,
    passedIds,
  };
}
