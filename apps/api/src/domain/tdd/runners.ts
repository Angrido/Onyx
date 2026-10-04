import { separateLines, withoutKeywords } from "@onyx/ignore-compiler";
import { parse, type ParseEntry } from "shell-quote";

export type TestRunnerName = "VITEST" | "JEST";
export type TestScope = "related" | "full";
export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export const PROTECTED_TEST_GLOBS: readonly string[] = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__snapshots__/**",
  "**/__mocks__/**",
  "**/test/**",
  "**/tests/**",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/vitest.setup.*",
  "**/vite.config.*",
  "**/jest.config.*",
  "**/jest.setup.*",
  "**/setupTests.*",
];

export const TEST_COMMAND_DENY_RULES: readonly string[] = [
  "Bash(npx vitest)",
  "Bash(npx vitest *)",
  "Bash(npx jest)",
  "Bash(npx jest *)",
  "Bash(vitest *)",
  "Bash(jest *)",
  "Bash(pnpm test)",
  "Bash(pnpm test *)",
  "Bash(pnpm run test *)",
  "Bash(pnpm vitest *)",
  "Bash(pnpm exec vitest *)",
  "Bash(pnpm jest *)",
  "Bash(pnpm exec jest *)",
  "Bash(npm test)",
  "Bash(npm test *)",
  "Bash(npm run test *)",
  "Bash(yarn test)",
  "Bash(yarn test *)",
  "Bash(yarn vitest *)",
  "Bash(yarn jest *)",
  "Bash(bun test *)",
];

const TEST_PROGRAMS = /^(?:vitest|jest)(?:\.[cm]?js)?$/;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_RUNNERS = new Set(["npx", "pnpx", "bunx"]);
const WRAPPERS = new Set(["sudo", "env", "nice", "time", "command", "exec", "nohup", "timeout"]);

function quote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.split("'").join(`'\\''`)}'`;
}

export function shellLine(words: readonly string[]): string {
  return words.map(quote).join(" ");
}

export function testCommandLine(input: {
  runner: TestRunnerName;
  base: string;
  scope: TestScope;
  files: readonly string[];
  reportPath: string;
}): string {
  const files = input.files.map(quote).join(" ");
  if (input.runner === "VITEST") {
    const reporters = `--passWithNoTests --reporter=default --reporter=json --outputFile.json=${quote(input.reportPath)}`;
    return input.scope === "related"
      ? `${input.base} related ${files} --run ${reporters}`
      : `${input.base} run ${reporters}`;
  }
  const flags = `--ci --passWithNoTests --json --outputFile=${quote(input.reportPath)}`;
  return input.scope === "related"
    ? `${input.base} ${flags} --findRelatedTests ${files}`
    : `${input.base} ${flags}`;
}

export interface ProjectFacts {
  packageJson: Record<string, unknown> | null;
  files: ReadonlySet<string>;
}

function dependencyNames(packageJson: Record<string, unknown> | null): Set<string> {
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const block = packageJson?.[key];
    if (typeof block === "object" && block !== null)
      for (const name of Object.keys(block)) names.add(name);
  }
  return names;
}

function hasFile(files: ReadonlySet<string>, prefix: string): boolean {
  for (const file of files) if (file.startsWith(prefix)) return true;
  return false;
}

export function detectRunner(facts: ProjectFacts): TestRunnerName | null {
  const deps = dependencyNames(facts.packageJson);
  if (hasFile(facts.files, "vitest.config.") || hasFile(facts.files, "vitest.workspace."))
    return "VITEST";
  if (hasFile(facts.files, "jest.config.")) return "JEST";
  if (deps.has("vitest")) return "VITEST";
  if (deps.has("jest") || facts.packageJson?.["jest"] !== undefined) return "JEST";
  return null;
}

export function detectPackageManager(files: ReadonlySet<string>): PackageManager {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun";
  return "npm";
}

export function binaryInvocation(name: string, localBinaries: ReadonlySet<string>): string {
  return localBinaries.has(name) ? `node_modules/.bin/${name}` : `npx --no-install ${name}`;
}

export function defaultTypecheckCommand(localBinaries: ReadonlySet<string>): string {
  return `${binaryInvocation("tsc", localBinaries)} --noEmit --pretty false`;
}

export function defaultLintCommand(
  packageJson: Record<string, unknown> | null,
  manager: PackageManager,
  localBinaries: ReadonlySet<string>,
): string {
  const scripts = packageJson?.["scripts"];
  if (typeof scripts === "object" && scripts !== null && "lint" in scripts)
    return `${manager} run lint`;
  return `${binaryInvocation("eslint", localBinaries)} .`;
}

function words(command: string): string[][] {
  let entries: ParseEntry[];
  try {
    entries = parse(separateLines(command), (name) => `$${name}`);
  } catch {
    return [command.split(/\s+/)];
  }
  const segments: string[][] = [];
  let current: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") current.push(entry);
    else if ("op" in entry && entry.op === "glob") current.push(entry.pattern);
    else if ("op" in entry) {
      segments.push(current);
      current = [];
    }
  }
  segments.push(current);
  return segments.map(withoutKeywords).filter((segment) => segment.length > 0);
}

const FLAGS_WITH_VALUE = new Set([
  "--filter",
  "-F",
  "-C",
  "--dir",
  "--prefix",
  "--cwd",
  "-w",
  "--workspace",
]);

function skipFlags(segment: readonly string[], start: number): number {
  let index = start;
  while (index < segment.length && (segment[index] ?? "").startsWith("-")) {
    index += FLAGS_WITH_VALUE.has(segment[index] ?? "") ? 2 : 1;
  }
  return index;
}

function invokesTests(segment: readonly string[]): boolean {
  let index = 0;
  while (
    index < segment.length &&
    (WRAPPERS.has(segment[index] ?? "") || /^\w+=/.test(segment[index] ?? ""))
  ) {
    index += 1;
  }
  const program = (segment[index] ?? "").split("/").pop() ?? "";
  if (TEST_PROGRAMS.test(program)) return true;
  if (PACKAGE_RUNNERS.has(program) || program === "node") {
    const target = segment[skipFlags(segment, index + 1)] ?? "";
    return TEST_PROGRAMS.test(target.split("/").pop() ?? "") || /\/(?:vitest|jest)\//.test(target);
  }
  if (PACKAGE_MANAGERS.has(program)) {
    const next = skipFlags(segment, index + 1);
    const verb = segment[next] ?? "";
    if (verb === "test" || verb === "t") return true;
    if (verb === "exec" || verb === "dlx" || verb === "x") {
      const target = segment[skipFlags(segment, next + 1)] ?? "";
      return TEST_PROGRAMS.test(target.split("/").pop() ?? "");
    }
    if (verb === "run" || verb === "run-script") {
      const script = segment[skipFlags(segment, next + 1)] ?? "";
      return /^test\b|^test[:-]/.test(script) || TEST_PROGRAMS.test(script);
    }
    return TEST_PROGRAMS.test(verb);
  }
  if (program === "turbo" || program === "nx") {
    return segment.slice(index + 1).some((word) => word === "test" || word.startsWith("test:"));
  }
  return false;
}

export function isTestCommand(command: string): boolean {
  return words(command).some(invokesTests);
}

export const TEST_COMMAND_REASON =
  "Onyx runs the tests itself during a TDD loop and sends you a digest of the failures after each attempt. Do not run tests: fix the implementation and finish your turn.";

export const PROTECTED_FILE_REASON = (relPath: string): string =>
  `${relPath} is a test file or part of the test setup. During a TDD loop the tests are the specification and are read-only: change the implementation so they pass.`;
