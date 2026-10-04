import type {
  GitSummary,
  HealthCheckDto,
  HealthCheckId,
  IndexState,
  ProjectHealth,
} from "@onyx/contracts";
import { msg, tx, type Params } from "../i18n";

export interface HealthFinding {
  id: HealthCheckId;
  level: ProjectHealth;
  message: string;
  params?: Params;
}

export interface IndexFacts {
  state: IndexState;
  error: string | null;
  indexedAt: Date | null;
}

export interface TestRunnerFacts {
  command: string | null;
  missing: readonly string[];
}

export interface DiskFacts {
  path: string;
  freeBytes: number | null;
  totalBytes: number | null;
  error: string | null;
}

export interface CredentialFacts {
  claude: boolean;
  githubRemote: boolean;
  githubToken: boolean;
}

export interface TestCommandSources {
  allowedRules: readonly string[];
  stackCommands: readonly string[];
  runner: "VITEST" | "JEST" | null;
  packageJson: Record<string, unknown> | null;
}

export const HEALTH_RANK: Record<ProjectHealth, number> = { OK: 0, ATTENTION: 1, ERROR: 2 };
export const STALE_INDEX_DAYS = 14;
export const DISK_ERROR_RATIO = 0.03;
export const DISK_WARN_RATIO = 0.05;
export const DISK_ERROR_BYTES = 1024 ** 3;
export const DISK_WARN_BYTES = 5 * 1024 ** 3;

const DAY_MS = 86_400_000;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_RUNNERS = new Set(["npx", "pnpx", "bunx"]);
const SCRIPT_RUNNERS = new Set(["poetry", "uv", "pipenv", "hatch", "pdm"]);
const TEST_PROGRAMS = new Set([
  "test",
  "pytest",
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "phpunit",
  "rspec",
]);
const SHELL_WORDS = new Set(["cross-env", "env", "dotenv", "time", "nice"]);
const PLACEHOLDER_SCRIPT = /no test specified/i;

export function worstLevel(levels: Iterable<ProjectHealth>): ProjectHealth {
  let worst: ProjectHealth = "OK";
  for (const level of levels) if (HEALTH_RANK[level] > HEALTH_RANK[worst]) worst = level;
  return worst;
}

export function renderFinding(finding: HealthFinding): HealthCheckDto {
  return { id: finding.id, level: finding.level, reason: tx(finding.message, finding.params) };
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function indexCheck(facts: IndexFacts, now: Date): HealthFinding {
  if (facts.state === "failed")
    return {
      id: "index",
      level: "ERROR",
      message: msg("The code index failed: {error}"),
      params: { error: facts.error ?? "?" },
    };
  if (facts.state === "indexing")
    return { id: "index", level: "OK", message: msg("Indexing the code now") };
  if (facts.state === "never" || facts.indexedAt === null)
    return {
      id: "index",
      level: "ATTENTION",
      message: msg("The code is not indexed yet: start it with Re-index on the project page"),
    };
  const days = Math.floor((now.getTime() - facts.indexedAt.getTime()) / DAY_MS);
  if (days >= STALE_INDEX_DAYS)
    return {
      id: "index",
      level: "ATTENTION",
      message: msg("The index is {days} days old: use Re-index on the project page"),
      params: { days },
    };
  if (days < 1) return { id: "index", level: "OK", message: msg("Indexed in the last 24 hours") };
  return days === 1
    ? { id: "index", level: "OK", message: msg("Indexed 1 day ago") }
    : { id: "index", level: "OK", message: msg("Indexed {days} days ago"), params: { days } };
}

export function gitCheck(git: GitSummary): HealthFinding {
  if (git.error)
    return {
      id: "git",
      level: "ERROR",
      message: msg("Git could not read the project: {error}"),
      params: { error: git.error },
    };
  if (!git.isRepo) return { id: "git", level: "ATTENTION", message: msg("Not a git repository") };
  const upstream = git.upstream ?? "upstream";
  if (git.behind > 0)
    return {
      id: "git",
      level: "ATTENTION",
      message:
        git.behind === 1
          ? msg("{count} commit behind {upstream}")
          : msg("{count} commits behind {upstream}"),
      params: { count: git.behind, upstream },
    };
  if (git.branch === null)
    return {
      id: "git",
      level: "ATTENTION",
      message: msg("No branch checked out (detached HEAD)"),
    };
  if (git.upstream === null)
    return {
      id: "git",
      level: "OK",
      message: msg("On {branch}, without an upstream branch"),
      params: { branch: git.branch },
    };
  if (git.ahead > 0)
    return {
      id: "git",
      level: "OK",
      message: msg("On {branch}, {count} ahead of {upstream}"),
      params: { branch: git.branch, count: git.ahead, upstream },
    };
  return {
    id: "git",
    level: "OK",
    message: msg("On {branch}, up to date with {upstream}"),
    params: { branch: git.branch, upstream },
  };
}

export function testsCheck(facts: TestRunnerFacts): HealthFinding {
  if (facts.command === null)
    return {
      id: "tests",
      level: "OK",
      message: msg("No test command found: TDD loops will ask for one"),
    };
  if (facts.missing.length > 0)
    return {
      id: "tests",
      level: "ATTENTION",
      message: msg("{command} cannot run: {missing} not found. Install the project dependencies"),
      params: { command: facts.command, missing: facts.missing.join(", ") },
    };
  return {
    id: "tests",
    level: "OK",
    message: msg("Tests run with {command}"),
    params: { command: facts.command },
  };
}

function diskLevel(disk: DiskFacts): ProjectHealth {
  if (disk.error !== null || disk.freeBytes === null || !disk.totalBytes) return "ATTENTION";
  const ratio = disk.freeBytes / disk.totalBytes;
  if (ratio < DISK_ERROR_RATIO || disk.freeBytes < DISK_ERROR_BYTES) return "ERROR";
  if (ratio < DISK_WARN_RATIO || disk.freeBytes < DISK_WARN_BYTES) return "ATTENTION";
  return "OK";
}

export function diskCheck(disks: readonly DiskFacts[]): HealthFinding {
  const ranked = [...disks].sort((left, right) => {
    const byLevel = HEALTH_RANK[diskLevel(right)] - HEALTH_RANK[diskLevel(left)];
    if (byLevel !== 0) return byLevel;
    return (left.freeBytes ?? 0) - (right.freeBytes ?? 0);
  });
  const worst = ranked[0];
  if (!worst) return { id: "disk", level: "OK", message: msg("No folder to check") };
  const level = diskLevel(worst);
  if (worst.error !== null || worst.freeBytes === null || !worst.totalBytes)
    return {
      id: "disk",
      level,
      message: msg("Could not read the free space of {path}"),
      params: { path: worst.path },
    };
  const params = {
    free: formatBytes(worst.freeBytes),
    percent: Math.round((worst.freeBytes / worst.totalBytes) * 100),
    path: worst.path,
  };
  if (level === "ERROR")
    return {
      id: "disk",
      level,
      message: msg("Almost no space left: {free} free ({percent}%) in {path}"),
      params,
    };
  if (level === "ATTENTION")
    return {
      id: "disk",
      level,
      message: msg("Space is running low: {free} free ({percent}%) in {path}"),
      params,
    };
  return { id: "disk", level, message: msg("{free} free ({percent}%)"), params };
}

export function credentialsCheck(facts: CredentialFacts): HealthFinding {
  const missingGitHub = facts.githubRemote && !facts.githubToken;
  if (!facts.claude && missingGitHub)
    return {
      id: "credentials",
      level: "ATTENTION",
      message: msg("No Claude account and no GitHub token: add them in Settings"),
    };
  if (!facts.claude)
    return {
      id: "credentials",
      level: "ATTENTION",
      message: msg("No Claude account connected: sign in from Settings"),
    };
  if (missingGitHub)
    return {
      id: "credentials",
      level: "ATTENTION",
      message: msg("The project has a GitHub remote but no GitHub token: add one in Settings"),
    };
  return facts.githubRemote
    ? {
        id: "credentials",
        level: "OK",
        message: msg("Claude account and GitHub token are set"),
      }
    : { id: "credentials", level: "OK", message: msg("Claude account connected") };
}

export function ruleCommand(rule: string): string | null {
  const match = /^Bash\((.+?)(?::\*| \*)?\)$/.exec(rule.trim());
  const command = match?.[1]?.trim();
  return command && !command.includes("*") ? command : null;
}

function words(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function withoutPrefixes(list: readonly string[]): string[] {
  let index = 0;
  while (
    index < list.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(list[index] ?? "") || SHELL_WORDS.has(list[index] ?? ""))
  )
    index += 1;
  return list.slice(index);
}

export function isTestCommand(command: string): boolean {
  return words(command).some((word) => TEST_PROGRAMS.has(word.replace(/^.*\//, "")));
}

function scriptsOf(packageJson: Record<string, unknown> | null): Record<string, string> {
  const scripts = packageJson?.["scripts"];
  if (typeof scripts !== "object" || scripts === null) return {};
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function firstProgram(text: string): string | null {
  const segment = text.split(/&&|\|\||;|\|/)[0] ?? "";
  const program = withoutPrefixes(words(segment))[0];
  return program ? program.replace(/^\.\/node_modules\/\.bin\/|^node_modules\/\.bin\//, "") : null;
}

function scriptName(list: readonly string[]): string | null {
  const [manager, verb, next] = list;
  if (!manager || !PACKAGE_MANAGERS.has(manager)) return null;
  if (verb === "run" || verb === "run-script") return next ?? null;
  if (verb === "test" || verb === "t") return "test";
  return null;
}

export function requiredPrograms(
  command: string,
  packageJson: Record<string, unknown> | null,
): string[] | null {
  const list = withoutPrefixes(words(command));
  const [first, second, third] = list;
  if (!first) return null;
  const program = first.replace(/^\.\/node_modules\/\.bin\/|^node_modules\/\.bin\//, "");
  if (PACKAGE_RUNNERS.has(program)) {
    const target = list.slice(1).find((word) => !word.startsWith("-"));
    return target ? [target] : [program];
  }
  if (PACKAGE_MANAGERS.has(program)) {
    const scripts = scriptsOf(packageJson);
    const script = scriptName(list) ?? (second && second in scripts ? second : null);
    if (script !== null) {
      const body = scripts[script];
      if (body === undefined) return [program];
      if (PLACEHOLDER_SCRIPT.test(body)) return null;
      const inner = firstProgram(body);
      return inner && !PACKAGE_MANAGERS.has(inner) ? [program, inner] : [program];
    }
    if ((second === "exec" || second === "x" || second === "dlx") && third) return [program, third];
    return second && !second.startsWith("-") ? [program, second] : [program];
  }
  if (SCRIPT_RUNNERS.has(program)) return [program];
  return [program];
}

export function resolveTestCommand(
  sources: TestCommandSources,
): { command: string; programs: string[] } | null {
  const candidates = [
    ...sources.allowedRules.map(ruleCommand).filter((entry): entry is string => entry !== null),
    ...sources.stackCommands,
  ].filter(isTestCommand);
  if (sources.runner === "VITEST") candidates.push("vitest run");
  if (sources.runner === "JEST") candidates.push("jest");
  for (const command of candidates) {
    const programs = requiredPrograms(command, sources.packageJson);
    if (programs !== null) return { command, programs: [...new Set(programs)] };
  }
  return null;
}
