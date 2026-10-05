import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDigest, failureSignature, snippet } from "../../src/domain/tdd/digest";
import { commandFailure, parseLintOutput, parseTypecheckOutput } from "../../src/domain/tdd/gates";
import {
  buildFixPrompt,
  decideNext,
  initialProgress,
  madeProgress,
  markEscalated,
  observe,
  recordFix,
  regressionsOf,
  type LoopProgress,
} from "../../src/domain/tdd/loop-policy";
import {
  errorTypeOf,
  parseJsonReport,
  PathResolver,
  stripAnsi,
  type TestFailure,
} from "../../src/domain/tdd/report";
import {
  detectPackageManager,
  detectRunner,
  isTestCommand,
  testCommandLine,
} from "../../src/domain/tdd/runners";

const fixtures = join(import.meta.dirname, "..", "fixtures", "tdd");
const paths = new PathResolver(["/work/demo"]);
const estimate = (text: string) => Math.ceil(text.length / 4);

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

const MATH_SOURCE = [
  "export function add(a: number, b: number): number {",
  "  return a - b;",
  "}",
  "",
  "export function multiply(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "",
  "export function parse(input: string): { value: number } {",
  "  const data = JSON.parse(input) as { value: number };",
  "  return { value: data.value * 2 };",
  "}",
].join("\n");

describe("test report parsing", () => {
  it("reads a Vitest JSON report with project-only frames and suite errors", () => {
    const report = parseJsonReport(JSON.parse(fixture("vitest-report.json")), paths);
    expect(report).not.toBeNull();
    if (!report) return;
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(5);
    expect(report.passedIds).toEqual(["src/ok.test.ts::works"]);
    const suite = report.failures.find((failure) => failure.kind === "suite");
    expect(suite?.file).toBe("src/broken.test.ts");
    expect(suite?.message).toContain("Unexpected token");
    expect(suite?.message).not.toContain("\u001b[");
    const adds = report.failures.find((failure) => failure.name === "math › adds two numbers");
    expect(adds).toMatchObject({
      kind: "test",
      file: "src/math.test.ts",
      errorType: "AssertionError",
      message: "AssertionError: expected -1 to be 5 // Object.is equality",
      location: { file: "src/math.test.ts", line: 6, column: 23 },
    });
    expect(adds?.frames.every((frame) => !frame.file.includes("node_modules"))).toBe(true);
    const thrown = report.failures.find((failure) => failure.name === "math › throws on bad input");
    expect(thrown?.errorType).toBe("SyntaxError");
    expect(thrown?.frames[0]).toMatchObject({ file: "src/math.ts", line: 10, fn: "parse" });
  });

  it("reads a Jest JSON report, strips colours and keeps the diff", () => {
    const report = parseJsonReport(JSON.parse(fixture("jest-report.json")), paths);
    expect(report).not.toBeNull();
    if (!report) return;
    expect(report.failed).toBe(4);
    expect(report.passed).toBe(1);
    const equality = report.failures.find((failure) => failure.name === "math › parses objects");
    expect(equality?.errorType).toBe("AssertionError");
    expect(equality?.message).toContain('-   "extra": true,');
    expect(equality?.message).toContain('+   "value": 4,');
    expect(equality?.location).toEqual({ file: "src/math.test.js", line: 9, column: 35 });
    const suite = report.failures.find((failure) => failure.kind === "suite");
    expect(suite?.message.startsWith("SyntaxError: src/broken.js: Unexpected token (1:26)")).toBe(
      true,
    );
    expect(suite?.message).not.toContain("Out of the box Jest supports Babel");
  });

  it("returns null for something that is not a report", () => {
    expect(parseJsonReport({ hello: "world" }, paths)).toBeNull();
    expect(parseJsonReport(null, paths)).toBeNull();
  });

  it("names error types", () => {
    expect(errorTypeOf("TypeError: x is not a function")).toBe("TypeError");
    expect(errorTypeOf("Error: expect(received).toBe(expected)")).toBe("AssertionError");
    expect(errorTypeOf("Something odd happened")).toBe("Error");
    expect(stripAnsi("\u001b[31mred\u001b[39m \u001b]8;;https://x\u0007link\u001b]8;;\u0007")).toBe(
      "red link",
    );
  });
});

describe("gate output parsing", () => {
  it("reads tsc errors", () => {
    const failures = parseTypecheckOutput(fixture("tsc-output.txt"), paths);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      kind: "typecheck",
      file: "src/typed.ts",
      errorType: "TS2322",
      location: { file: "src/typed.ts", line: 2, column: 3 },
    });
  });

  it("reads ESLint stylish errors and ignores warnings", () => {
    const failures = parseLintOutput(
      `${fixture("eslint-output.txt")}\n/work/demo/src/other.ts\n  1:1  warning  Unexpected console statement  no-console\n`,
      paths,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      file: "src/probe.ts",
      errorType: "@typescript-eslint/no-unused-vars",
      location: { line: 2, column: 9 },
    });
  });

  it("falls back to the output tail for a crashed command", () => {
    const failure = commandFailure(
      "vitest related",
      "\u001b[31mError: Cannot find module '/work/demo/src/missing.ts'\u001b[39m\n",
      1,
      paths,
    );
    expect(failure.message).toBe("Error: Cannot find module 'src/missing.ts'");
    expect(failure.errorType).toBe("exit 1");
  });
});

describe("failure digest", () => {
  const report = parseJsonReport(JSON.parse(fixture("vitest-report.json")), paths);
  const sources = new Map([["src/math.ts", MATH_SOURCE]]);

  it("shows snippets, the first failure of every file first, and stays deterministic", () => {
    if (!report) throw new Error("fixture did not parse");
    const digest = buildDigest({
      failures: report.failures,
      summary: "5 failed, 1 passed",
      sources,
      budgetTokens: 4_000,
      estimate,
    });
    expect(digest.omitted).toBe(0);
    expect(digest.text).toContain("> 10 |   const data = JSON.parse(input)");
    const headings = digest.text.split("\n").filter((line) => line.startsWith("### "));
    expect(headings[0]).toContain("src/broken.test.ts");
    expect(headings[1]).toContain("src/math.test.ts › math › adds two numbers");
    expect(digest.text).not.toContain("node_modules");
    expect(digest.signature).toBe(failureSignature(report.failures));
  });

  it("deduplicates identical errors", () => {
    const failure: TestFailure = {
      kind: "test",
      file: "src/a.test.ts",
      name: "a › one",
      errorType: "TypeError",
      message: "TypeError: boom",
      frames: [],
      location: null,
    };
    const digest = buildDigest({
      failures: [failure, { ...failure, name: "a › two" }, { ...failure, name: "a › three" }],
      summary: "3 failed",
      sources: new Map(),
      budgetTokens: 4_000,
      estimate,
    });
    expect(digest.text.match(/TypeError: boom/g)).toHaveLength(1);
    expect(digest.text).toContain("Same error in: a › two; a › three");
    expect(digest.shown).toBe(3);
  });

  it("respects the token cap and counts what it left out", () => {
    const failures: TestFailure[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "test",
      file: `src/f${index % 8}.test.ts`,
      name: `case ${index}`,
      errorType: "AssertionError",
      message: `AssertionError: expected ${index} to be ${index + 1}\n${"detail ".repeat(60)}`,
      frames: [{ file: `src/f${index % 8}.ts`, line: 3, column: 1, fn: null }],
      location: null,
    }));
    const digest = buildDigest({
      failures,
      summary: "40 failed",
      sources: new Map(),
      budgetTokens: 1_000,
      estimate,
    });
    expect(digest.tokens).toBeLessThanOrEqual(1_100);
    expect(digest.omitted).toBeGreaterThan(0);
    expect(digest.shown + digest.omitted).toBe(40);
    expect(digest.text).toMatch(/Omitted to stay within 1000 tokens: \d+ more failure/);
  });

  it("signs the set of failures independently of order and message details", () => {
    const one: TestFailure = {
      kind: "test",
      file: "a",
      name: "x",
      errorType: "AssertionError",
      message: "expected 1",
      frames: [],
      location: null,
    };
    const two = { ...one, name: "y" };
    expect(failureSignature([one, two])).toBe(
      failureSignature([two, { ...one, message: "expected 2" }]),
    );
    expect(failureSignature([one])).not.toBe(failureSignature([one, two]));
    expect(failureSignature([])).toBeNull();
  });

  it("cuts a snippet around the failing line", () => {
    expect(snippet(MATH_SOURCE, { file: "src/math.ts", line: 2, column: 3 })).toBe(
      [
        "  1 | export function add(a: number, b: number): number {",
        "> 2 |   return a - b;",
        "  3 | }",
        "  4 | ",
        "  5 | export function multiply(a: number, b: number): number {",
      ].join("\n"),
    );
    expect(snippet(undefined, { file: "x", line: 1, column: 1 })).toBeNull();
  });
});

describe("loop policy", () => {
  const limits = { maxIterations: 6, budgetUsd: null, spentUsd: 0 };

  function step(progress: LoopProgress, stage: "related" | "full", failed: number, sig: string) {
    return observe(recordFix(progress), { stage, failed, signature: sig });
  }

  it("measures progress by stage first, then by failures", () => {
    expect(madeProgress(null, { stage: "related", failed: 3, signature: "a" })).toBe(true);
    expect(
      madeProgress(
        { stage: "related", failed: 1, signature: "a" },
        { stage: "full", failed: 4, signature: "b" },
      ),
    ).toBe(true);
    expect(
      madeProgress(
        { stage: "full", failed: 2, signature: "a" },
        { stage: "related", failed: 1, signature: "b" },
      ),
    ).toBe(false);
    expect(
      madeProgress(
        { stage: "related", failed: 2, signature: "a" },
        { stage: "related", failed: 2, signature: "b" },
      ),
    ).toBe(false);
  });

  it("escalates after two attempts without progress, then stalls on a repeated signature", () => {
    let progress = observe(initialProgress(), { stage: "related", failed: 3, signature: "s" });
    expect(decideNext(progress, limits)).toEqual({ action: "fix", escalate: false });
    progress = step(progress, "related", 3, "s");
    expect(decideNext(progress, limits)).toEqual({ action: "fix", escalate: false });
    progress = step(progress, "related", 3, "s");
    expect(decideNext(progress, limits)).toEqual({ action: "fix", escalate: true });
    progress = markEscalated(progress);
    progress = step(progress, "related", 3, "s");
    progress = step(progress, "related", 3, "s");
    expect(decideNext(progress, limits)).toMatchObject({ action: "fix" });
    progress = step(progress, "related", 3, "s");
    expect(decideNext(progress, { ...limits, maxIterations: 10 })).toMatchObject({
      action: "stop",
      status: "STALLED",
    });
  });

  it("stops at the iteration limit and on the budget", () => {
    let progress = observe(initialProgress(), { stage: "full", failed: 5, signature: "a" });
    for (let index = 0; index < 6; index += 1)
      progress = step(progress, "full", 5 - index, `s${index}`);
    expect(decideNext(progress, limits)).toMatchObject({ action: "stop", status: "EXHAUSTED" });
    expect(
      decideNext(initialProgress(), { maxIterations: 6, budgetUsd: 0.5, spentUsd: 0.51 }),
    ).toMatchObject({ action: "stop", status: "ABORTED" });
  });

  it("finds regressions among the tests that passed before", () => {
    expect(regressionsOf(new Set(["a", "b"]), ["b", "c"])).toEqual(["b"]);
    expect(regressionsOf(null, ["b"])).toEqual([]);
  });

  it("builds the fix prompt with the rules, the revert warning and the digest", () => {
    const prompt = buildFixPrompt({
      taskTitle: "Fix math",
      taskPrompt: "Make add work",
      iteration: 2,
      maxIterations: 6,
      stageLabel: "related tests",
      digest: "### 1. src/math.test.ts › adds",
      revertedFiles: ["src/math.test.ts"],
      escalated: false,
      includeTask: true,
    });
    expect(prompt).toContain("fix attempt 2 of 6");
    expect(prompt).toContain("Onyx restored them");
    expect(prompt).toContain("Make add work");
    expect(prompt).toContain("Do not run the tests");
    expect(prompt.endsWith("### 1. src/math.test.ts › adds")).toBe(true);
  });
});

describe("runners", () => {
  it("builds Vitest and Jest commands", () => {
    expect(
      testCommandLine({
        runner: "VITEST",
        base: "node_modules/.bin/vitest",
        scope: "related",
        files: ["src/math.ts", "src/my file.ts"],
        reportPath: "/tmp/r.json",
      }),
    ).toBe(
      "node_modules/.bin/vitest related src/math.ts 'src/my file.ts' --run --passWithNoTests --reporter=default --reporter=json --outputFile.json=/tmp/r.json",
    );
    expect(
      testCommandLine({
        runner: "JEST",
        base: "npx --no-install jest",
        scope: "full",
        files: [],
        reportPath: "/tmp/r.json",
      }),
    ).toBe("npx --no-install jest --ci --passWithNoTests --json --outputFile=/tmp/r.json");
  });

  it("detects the runner and the package manager", () => {
    expect(
      detectRunner({ packageJson: { devDependencies: { vitest: "^5" } }, files: new Set() }),
    ).toBe("VITEST");
    expect(detectRunner({ packageJson: { jest: {} }, files: new Set(["package.json"]) })).toBe(
      "JEST",
    );
    expect(detectRunner({ packageJson: {}, files: new Set(["jest.config.ts"]) })).toBe("JEST");
    expect(detectRunner({ packageJson: null, files: new Set() })).toBeNull();
    expect(detectPackageManager(new Set(["pnpm-lock.yaml"]))).toBe("pnpm");
    expect(detectPackageManager(new Set())).toBe("npm");
  });

  it("recognises test commands without flagging ordinary ones", () => {
    for (const command of [
      "npx vitest run",
      "pnpm test",
      "pnpm --filter web test",
      "npm run test:unit",
      "yarn jest src",
      "CI=1 node_modules/.bin/vitest related src/a.ts",
      "cd app && pnpm exec vitest",
      "node ./node_modules/vitest/vitest.mjs run",
      "turbo run test",
      "bun test",
      "true\nnpx vitest",
      "echo start\n  pnpm test",
      "if true; then npx jest; fi",
    ]) {
      expect(isTestCommand(command), command).toBe(true);
    }
    for (const command of [
      "grep vitest package.json",
      "pnpm install",
      "npm run build",
      "cat src/math.test.ts",
      "git status",
      "cat > notes.md <<'EOF'\nnpx vitest\nEOF",
    ]) {
      expect(isTestCommand(command), command).toBe(false);
    }
  });
});
