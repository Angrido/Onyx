import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import picomatch from "picomatch";
import { parse, type ParseEntry } from "shell-quote";
import { permissionPaths } from "./compiler";
import type { GuardDecision, ToolCall } from "./guard";

export interface FenceZone {
  name: string;
  globs: readonly string[];
}

export interface FenceVerdict {
  allowed: boolean;
  owner: string | null;
}

export interface FenceDenial {
  relPath: string;
  owner: string;
  zone: string;
  toolName: string;
}

export type FenceReason = (denial: FenceDenial) => string;

function defaultReason(denial: FenceDenial): string {
  return `${denial.relPath} belongs to the ${denial.owner} workspace. This ${denial.zone} session can read it but not change it with ${denial.toolName === "Bash" ? "shell commands" : denial.toolName}: leave a note for a ${denial.owner} task instead.`;
}

const ALLOW: GuardDecision = { allowed: true, target: null, rule: null, reason: null };

const EDIT_TOOLS: Readonly<Record<string, readonly string[]>> = {
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["notebook_path"],
};

const ALL_ARGUMENT_WRITERS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "touch",
  "mkdir",
  "truncate",
  "shred",
  "mv",
  "tee",
]);
const MODE_FIRST_WRITERS = new Set(["chmod", "chown", "chgrp"]);
const DESTINATION_WRITERS = new Set(["cp", "rsync", "install", "ln", "scp"]);
const GIT_WRITERS = new Set(["checkout", "restore", "rm", "mv", "clean"]);
const WRAPPERS = new Set(["sudo", "env", "nice", "time", "command", "exec", "xargs"]);
const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>"]);
const DEFAULT_MAX_RULES = 1_500;
const PROBE = "__onyx_fence_probe__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasInPlaceFlag(words: readonly string[]): boolean {
  return words.some((word) => /^-i/.test(word) || word === "--in-place" || /^-[a-z]*i/.test(word));
}

export class WriteFence {
  private readonly own: (path: string) => boolean;
  private readonly others: { name: string; isMatch: (path: string) => boolean }[];

  constructor(
    private readonly projectRoot: string,
    private readonly zone: FenceZone,
    others: readonly FenceZone[],
    private readonly describe: FenceReason = defaultReason,
  ) {
    this.own = zone.globs.length === 0 ? () => false : picomatch([...zone.globs], { dot: true });
    this.others = others
      .filter((other) => other.globs.length > 0)
      .map((other) => ({ name: other.name, isMatch: picomatch([...other.globs], { dot: true }) }));
  }

  get name(): string {
    return this.zone.name;
  }

  verdict(relPath: string): FenceVerdict {
    if (this.own(relPath)) return { allowed: true, owner: this.zone.name };
    const owner = this.others.find((other) => other.isMatch(relPath));
    return owner ? { allowed: false, owner: owner.name } : { allowed: true, owner: null };
  }

  fencedFiles(files: readonly string[]): string[] {
    return files.filter((file) => !this.verdict(file).allowed);
  }

  compile(
    files: readonly string[],
    maxRules = DEFAULT_MAX_RULES,
  ): { editDeny: string[]; truncated: boolean } {
    const sorted = [...files].sort();
    const blocked = new Set(this.fencedFiles(sorted));
    const open = new Set(sorted.filter((file) => !blocked.has(file)));
    const covered = new Set<string>();
    const patterns: string[] = [];
    for (const file of blocked) {
      const segments = file.split("/");
      let emitted = false;
      for (let depth = 1; depth < segments.length; depth += 1) {
        const directory = segments.slice(0, depth).join("/");
        if (covered.has(directory)) {
          emitted = true;
          break;
        }
        if (this.directoryFenced(directory, open)) {
          covered.add(directory);
          patterns.push(`/${directory}/`);
          emitted = true;
          break;
        }
      }
      if (!emitted) patterns.push(`/${file}`);
    }
    const rules = [
      ...new Set(patterns.flatMap((pattern) => permissionPaths(pattern, this.projectRoot))),
    ].map((path) => `Edit(${path})`);
    return { editDeny: rules.slice(0, maxRules), truncated: rules.length > maxRules };
  }

  private directoryFenced(directory: string, open: ReadonlySet<string>): boolean {
    if (this.verdict(`${directory}/${PROBE}`).allowed) return false;
    if (this.verdict(`${directory}/${PROBE}/${PROBE}`).allowed) return false;
    for (const file of open) if (file.startsWith(`${directory}/`)) return false;
    return true;
  }

  evaluate(call: ToolCall): GuardDecision {
    if (!isRecord(call.toolInput)) return ALLOW;
    const cwd = call.cwd ?? this.projectRoot;
    if (call.toolName === "Bash") {
      const command = call.toolInput["command"];
      return typeof command === "string" ? this.evaluateCommand(command, cwd) : ALLOW;
    }
    const keys = EDIT_TOOLS[call.toolName];
    if (!keys) return ALLOW;
    for (const key of keys) {
      const value = call.toolInput[key];
      if (typeof value !== "string" || value.length === 0) continue;
      const decision = this.check(value, cwd, call.toolName);
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  evaluateCommand(command: string, cwd: string): GuardDecision {
    let entries: ParseEntry[];
    try {
      entries = parse(command, (name) => `$${name}`);
    } catch {
      return ALLOW;
    }
    const segments: string[][] = [];
    const redirects: { target: string; segment: number }[] = [];
    let segment: string[] = [];
    let pendingRedirect = false;
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (pendingRedirect) {
          redirects.push({ target: entry, segment: segments.length });
          pendingRedirect = false;
          continue;
        }
        segment.push(entry);
      } else if ("op" in entry) {
        if (entry.op === "glob") {
          segment.push(entry.pattern);
        } else if (WRITE_REDIRECTS.has(entry.op)) {
          pendingRedirect = true;
        } else if (
          entry.op === "<" ||
          entry.op === "<<" ||
          entry.op === ">&" ||
          entry.op === "<&"
        ) {
          pendingRedirect = false;
        } else {
          segments.push(segment);
          segment = [];
        }
      }
    }
    segments.push(segment);

    let current = cwd;
    const directories: string[] = [];
    for (const words of segments) {
      directories.push(current);
      if (words[0] === "cd" || words[0] === "pushd") {
        const target = words.find((word, position) => position > 0 && !word.startsWith("-"));
        current = target === undefined ? this.projectRoot : resolve(current, target);
      }
    }
    for (const redirect of redirects) {
      if (redirect.target.startsWith("&") || redirect.target === "/dev/null") continue;
      const decision = this.check(redirect.target, directories[redirect.segment] ?? cwd, "Bash");
      if (!decision.allowed) return decision;
    }
    for (const [index, words] of segments.entries()) {
      for (const target of this.writeTargets(words)) {
        const decision = this.check(target, directories[index] ?? cwd, "Bash");
        if (!decision.allowed) return decision;
      }
    }
    return ALLOW;
  }

  private writeTargets(words: readonly string[]): string[] {
    let index = 0;
    while (
      index < words.length &&
      (WRAPPERS.has(words[index] ?? "") || /^\w+=/.test(words[index] ?? ""))
    ) {
      index += 1;
    }
    const program = (words[index] ?? "").split("/").pop() ?? "";
    const rest = words.slice(index + 1);
    const args = rest.filter((word) => !word.startsWith("-"));
    if (ALL_ARGUMENT_WRITERS.has(program)) return args;
    if (MODE_FIRST_WRITERS.has(program)) return args.slice(1);
    if (DESTINATION_WRITERS.has(program)) return args.slice(-1);
    if ((program === "sed" || program === "perl") && hasInPlaceFlag(rest)) return args.slice(1);
    if (program === "git" && GIT_WRITERS.has(args[0] ?? "")) {
      return args.slice(1).filter((arg) => arg !== "--");
    }
    return [];
  }

  private check(rawPath: string, cwd: string, toolName: string): GuardDecision {
    if (rawPath.length === 0 || rawPath.startsWith("$")) return ALLOW;
    if (rawPath.startsWith("~") && rawPath !== "~" && !rawPath.startsWith("~/")) return ALLOW;
    const expanded = rawPath.startsWith("~") ? resolve(homedir(), rawPath.slice(2)) : rawPath;
    const absolute = normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
    const inside = relative(this.projectRoot, absolute);
    if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return ALLOW;
    const relPath = inside.split("\\").join("/");
    const verdict = this.verdict(relPath);
    if (verdict.allowed) return ALLOW;
    return {
      allowed: false,
      target: relPath,
      rule: null,
      reason: this.describe({
        relPath,
        owner: verdict.owner ?? "another",
        zone: this.zone.name,
        toolName,
      }),
    };
  }
}
