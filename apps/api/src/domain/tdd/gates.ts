import { dedent, stripAnsi, type PathResolver, type TestFailure } from "./report";

export type GateName = "typecheck" | "lint";

const TSC_ERROR = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.*)$/;
const TSC_PRETTY_ERROR = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s*(.*)$/;
const ESLINT_PROBLEM = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/;
const MAX_OUTPUT_LINES = 40;
const MAX_OUTPUT_CHARS = 3_000;

function lines(output: string): string[] {
  return stripAnsi(output).replace(/\r\n?/g, "\n").split("\n");
}

export function parseTypecheckOutput(output: string, paths: PathResolver): TestFailure[] {
  const failures: TestFailure[] = [];
  let current: TestFailure | null = null;
  for (const line of lines(output)) {
    const match = TSC_ERROR.exec(line) ?? TSC_PRETTY_ERROR.exec(line.trim());
    if (match) {
      const file = paths.display(match[1] ?? "");
      const lineNumber = Number(match[2]);
      const column = Number(match[3]);
      const code = match[4] ?? "TS0";
      current = {
        kind: "typecheck",
        file,
        name: `${file}:${lineNumber}:${column} ${code}`,
        errorType: code,
        message: paths.relativize(match[5] ?? ""),
        frames: [{ file, line: lineNumber, column, fn: null }],
        location: { file, line: lineNumber, column },
      };
      failures.push(current);
      continue;
    }
    if (current && /^\s{2,}\S/.test(line) && !/^\s+\d+\s/.test(line)) {
      current.message = `${current.message}\n${paths.relativize(line.trim())}`;
      continue;
    }
    current = null;
  }
  return failures;
}

export function parseLintOutput(output: string, paths: PathResolver): TestFailure[] {
  const failures: TestFailure[] = [];
  let file: string | null = null;
  for (const line of lines(output)) {
    if (/^\S/.test(line) && /\.[cm]?[jt]sx?$|\.vue$|\.svelte$/.test(line.trim())) {
      file = paths.display(line.trim());
      continue;
    }
    const match = ESLINT_PROBLEM.exec(line);
    if (!match || !file || match[3] !== "error") continue;
    const lineNumber = Number(match[1]);
    const column = Number(match[2]);
    const rule = match[5] ?? "lint";
    failures.push({
      kind: "lint",
      file,
      name: `${file}:${lineNumber}:${column} ${rule}`,
      errorType: rule,
      message: match[4] ?? "",
      frames: [{ file, line: lineNumber, column, fn: null }],
      location: { file, line: lineNumber, column },
    });
  }
  return failures;
}

export function outputTail(output: string, paths: PathResolver): string {
  const cleaned = dedent(
    lines(output)
      .map((line) => paths.relativize(line.replace(/\s+$/, "")))
      .filter((line, index, all) => line.length > 0 || (all[index - 1] ?? "").length > 0),
  );
  const kept: string[] = [];
  let chars = 0;
  for (const line of cleaned.reverse()) {
    if (kept.length >= MAX_OUTPUT_LINES || chars + line.length > MAX_OUTPUT_CHARS) break;
    kept.push(line);
    chars += line.length + 1;
  }
  return kept.reverse().join("\n").trim();
}

export function commandFailure(
  name: string,
  output: string,
  exitCode: number | null,
  paths: PathResolver,
): TestFailure {
  const tail = outputTail(output, paths);
  return {
    kind: "run",
    file: "(command)",
    name,
    errorType: exitCode === null ? "Timeout" : `exit ${exitCode}`,
    message: tail.length > 0 ? tail : `${name} failed without output`,
    frames: [],
    location: null,
  };
}
