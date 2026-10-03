import { policyHash } from "./hash";
import { ContextPolicy } from "./policy";
import type { PolicyRule } from "./rules";

export type CompileMode = "pass-through" | "materialized";

export interface CompiledPolicy {
  mode: CompileMode;
  readDeny: string[];
  editDeny: string[];
  hash: string;
  truncated: boolean;
}

export interface CompileOptions {
  projectRoot: string;
  files?: readonly string[];
  maxRules?: number;
}

const DEFAULT_MAX_RULES = 1_500;

function absoluteBase(projectRoot: string): string {
  const root = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return `/${root.startsWith("/") ? root : `/${root}`}`;
}

export function permissionPaths(pattern: string, projectRoot: string): string[] {
  const base = absoluteBase(projectRoot);
  const directoryOnly = pattern.endsWith("/");
  const trimmed = pattern.replace(/\/+$/, "");
  const anchored = trimmed.startsWith("/") || trimmed.includes("/");
  const body = trimmed.replace(/^\/+/, "");
  if (body.length === 0) return [];
  const target = anchored ? `${base}/${body}` : `${base}/**/${body}`;
  if (body.endsWith("/**")) return [target];
  return directoryOnly ? [`${target}/**`] : [target, `${target}/**`];
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function collapsePaths(excluded: ReadonlySet<string>, files: readonly string[]): string[] {
  const totals = new Map<string, number>();
  const hidden = new Map<string, number>();
  for (const file of files) {
    const segments = file.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const directory = segments.slice(0, depth).join("/");
      totals.set(directory, (totals.get(directory) ?? 0) + 1);
      if (excluded.has(file)) hidden.set(directory, (hidden.get(directory) ?? 0) + 1);
    }
  }
  const result: string[] = [];
  const covered = new Set<string>();
  for (const file of [...excluded].sort()) {
    const segments = file.split("/");
    let emitted = false;
    for (let depth = 1; depth < segments.length; depth += 1) {
      const directory = segments.slice(0, depth).join("/");
      if (covered.has(directory)) {
        emitted = true;
        break;
      }
      if (totals.get(directory) === hidden.get(directory)) {
        covered.add(directory);
        result.push(`/${directory}/`);
        emitted = true;
        break;
      }
    }
    if (!emitted) result.push(`/${file}`);
  }
  return result;
}

function exclusionsMatchingNothing(
  rules: readonly PolicyRule[],
  files: readonly string[],
): PolicyRule[] {
  return rules.filter((candidate) => {
    if (candidate.action !== "EXCLUDE") return false;
    const single = new ContextPolicy([candidate]);
    return !files.some((file) => single.isExcluded(file));
  });
}

export function compilePolicy(policy: ContextPolicy, options: CompileOptions): CompiledPolicy {
  const maxRules = options.maxRules ?? DEFAULT_MAX_RULES;
  const toRules = (tool: "Read" | "Edit", patterns: readonly string[]) =>
    unique(patterns.flatMap((pattern) => permissionPaths(pattern, options.projectRoot))).map(
      (path) => `${tool}(${path})`,
    );
  const locked = policy.rules.filter(
    (candidate) => candidate.locked && candidate.action === "EXCLUDE",
  );
  const editDeny = toRules(
    "Edit",
    locked.map((candidate) => candidate.pattern),
  );

  if (!policy.hasNegations || options.files === undefined) {
    const patterns = policy.rules
      .filter((candidate) => candidate.action === "EXCLUDE")
      .map((candidate) => candidate.pattern);
    const readDeny = toRules("Read", patterns);
    return {
      mode: "pass-through",
      readDeny: readDeny.slice(0, maxRules),
      editDeny,
      hash: policyHash(policy),
      truncated: readDeny.length > maxRules,
    };
  }

  const files = [...options.files].sort();
  const excluded = new Set(files.filter((file) => policy.isExcluded(file)));
  const patterns = [
    ...locked.map((candidate) => candidate.pattern),
    ...exclusionsMatchingNothing(policy.rules, files).map((candidate) => candidate.pattern),
    ...collapsePaths(excluded, files),
  ];
  const readDeny = toRules("Read", patterns);
  return {
    mode: "materialized",
    readDeny: readDeny.slice(0, maxRules),
    editDeny,
    hash: policyHash(policy),
    truncated: readDeny.length > maxRules,
  };
}
