import { lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import picomatch from "picomatch";
import { parse, type ParseEntry } from "shell-quote";
import { permissionPaths } from "./compiler";
import type { GuardDecision, ToolCall } from "./guard";
import {
  DirectoryTracker,
  commandStart,
  isGitMetadata,
  pathWithin,
  programName,
  separateLines,
  withoutKeywords,
} from "./shell";

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
const VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  touch: ["-r", "--reference", "-d", "--date", "-t"],
  install: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory"],
  truncate: ["-s", "--size", "-r", "--reference"],
  shred: ["-n", "--iterations", "-s", "--size"],
};
const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>"]);
const GLOB_CHARS = /[*?[{]/;
const FIND_WRITERS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]);
const FORMATTERS = new Set([
  "prettier",
  "biome",
  "eslint",
  "ruff",
  "black",
  "isort",
  "gofmt",
  "rustfmt",
  "stylelint",
]);
const FORMATTER_WRITE_FLAGS = new Set(["--write", "-w", "--fix", "--apply", "format"]);
const WALK_LIMIT = 20_000;
const WALK_SKIPPED = new Set([".git", "node_modules"]);

interface WriteTarget {
  path: string;
  tree: boolean;
}

function valueOf(words: readonly string[], flags: readonly string[]): string[] {
  const values: string[] = [];
  words.forEach((word, index) => {
    if (flags.includes(word) && words[index + 1] !== undefined) values.push(words[index + 1] ?? "");
  });
  return values;
}

function findRoots(rest: readonly string[]): string[] {
  const roots: string[] = [];
  for (const word of rest) {
    if (word.startsWith("-") || word === "(" || word === "!") break;
    roots.push(word);
  }
  return roots.length > 0 ? roots : ["."];
}

function* ancestors(file: string): Generator<string> {
  let index = file.indexOf("/");
  while (index > 0) {
    yield file.slice(0, index);
    index = file.indexOf("/", index + 1);
  }
}

function walkFiles(start: string, root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (files.length >= WALK_LIMIT || depth > 12) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= WALK_LIMIT) return;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIPPED.has(entry.name)) visit(path, depth + 1);
      } else {
        files.push(relative(root, path).split("\\").join("/"));
      }
    }
  };
  try {
    if (lstatSync(start).isDirectory()) visit(start, 0);
  } catch {
    return files;
  }
  return files;
}
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
    private readonly protectedPaths: readonly string[] = [],
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
      entries = parse(separateLines(command), (name) => `$${name}`);
    } catch {
      return ALLOW;
    }
    const tracker = new DirectoryTracker(cwd, this.projectRoot, homedir());
    let segment: string[] = [];
    let redirects: string[] = [];
    let pendingRedirect = false;
    let pendingInput = false;
    const flush = (): GuardDecision => {
      const words = withoutKeywords(segment);
      const directories = [...tracker.candidates()];
      tracker.enter(words);
      const targets: WriteTarget[] = [
        ...redirects
          .filter((target) => !target.startsWith("&") && target !== "/dev/null")
          .map((path) => ({ path, tree: false })),
        ...this.writeTargets(words),
      ];
      segment = [];
      redirects = [];
      for (const target of targets) {
        for (const directory of directories) {
          const decision = this.checkTarget(target, directory);
          if (!decision.allowed) return decision;
        }
      }
      return ALLOW;
    };
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (pendingRedirect) {
          redirects.push(entry);
          pendingRedirect = false;
          continue;
        }
        if (pendingInput) {
          pendingInput = false;
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
          pendingInput = true;
        } else {
          const decision = flush();
          if (!decision.allowed) return decision;
          if (entry.op === "(") tracker.open();
          else if (entry.op === ")") tracker.close();
        }
      }
    }
    return flush();
  }

  private writeTargets(words: readonly string[]): WriteTarget[] {
    const index = commandStart(words);
    const program = programName(words[index] ?? "");
    const rest = words.slice(index + 1);
    const valued = VALUE_FLAGS[program] ?? [];
    const args = rest.filter(
      (word, position) => !word.startsWith("-") && !valued.includes(rest[position - 1] ?? ""),
    );
    const plain = (paths: readonly string[]) => paths.map((path) => ({ path, tree: false }));
    const trees = (paths: readonly string[]) => paths.map((path) => ({ path, tree: true }));
    const recursive =
      rest.some((word) => /^-[A-Za-z]*[rR]/.test(word)) || rest.includes("--recursive");
    if (program === "rm") return recursive ? trees(args) : plain(args);
    if (ALL_ARGUMENT_WRITERS.has(program)) return plain(args);
    if (MODE_FIRST_WRITERS.has(program))
      return recursive ? trees(args.slice(1)) : plain(args.slice(1));
    if (DESTINATION_WRITERS.has(program)) return plain(this.destinations(rest, args));
    if ((program === "sed" || program === "perl") && hasInPlaceFlag(rest))
      return plain(args.slice(1));
    if (program === "dd")
      return plain(rest.filter((word) => word.startsWith("of=")).map((word) => word.slice(3)));
    if (program === "unzip") return trees(valueOf(rest, ["-d"]));
    if (program === "tar") return this.tarTargets(rest);
    if (program === "find" && rest.some((word) => FIND_WRITERS.has(word)))
      return trees(findRoots(rest));
    if (FORMATTERS.has(program) && rest.some((word) => FORMATTER_WRITE_FLAGS.has(word)))
      return trees(args);
    if (program === "git") return this.gitTargets(rest);
    return [];
  }

  private destinations(rest: readonly string[], args: readonly string[]): string[] {
    const flagged = valueOf(rest, ["-t", "--target-directory"]);
    const inline = rest
      .filter((word) => word.startsWith("--target-directory="))
      .map((word) => word.slice("--target-directory=".length));
    const directory = flagged[0] ?? inline[0];
    const sources = directory === undefined ? args.slice(0, -1) : args;
    const destination = directory ?? args.at(-1);
    if (destination === undefined) return [];
    return [destination, ...sources.map((source) => join(destination, basename(source)))];
  }

  private tarTargets(rest: readonly string[]): WriteTarget[] {
    const mode = (rest[0] ?? "").replace(/^-/, "");
    const directory = valueOf(rest, ["-C", "--directory"]);
    if (/^[A-Za-z]+$/.test(mode) && mode.includes("x"))
      return directory.map((path) => ({ path, tree: true }));
    if (/^[A-Za-z]+$/.test(mode) && /[cru]/.test(mode) && mode.includes("f") && rest[1])
      return [{ path: rest[1], tree: false }];
    return valueOf(rest, ["-f", "--file"]).map((path) => ({ path, tree: false }));
  }

  private gitTargets(rest: readonly string[]): WriteTarget[] {
    let index = 0;
    let directory = ".";
    while (index < rest.length && (rest[index] ?? "").startsWith("-")) {
      const option = rest[index] ?? "";
      if (option === "-C") directory = join(directory, rest[index + 1] ?? ".");
      index += option === "-C" || option === "-c" ? 2 : 1;
    }
    const sub = rest[index] ?? "";
    const paths = rest
      .slice(index + 1)
      .filter((word) => !word.startsWith("-") && word !== "--")
      .map((path) => join(directory, path));
    if (sub === "checkout" || sub === "restore") {
      const separator = rest.indexOf("--");
      if (separator > index) return paths.map((path) => ({ path, tree: true }));
      if (sub === "restore" && paths.length > 0) return paths.map((path) => ({ path, tree: true }));
      return [{ path: paths.find((path) => path.endsWith(".")) ?? directory, tree: true }];
    }
    if (sub === "clean" || sub === "stash" || (sub === "reset" && rest.includes("--hard")))
      return [{ path: paths[0] ?? directory, tree: true }];
    if (sub === "rm" || sub === "mv") return paths.map((path) => ({ path, tree: true }));
    return [];
  }

  private checkTarget(target: WriteTarget, cwd: string): GuardDecision {
    if (GLOB_CHARS.test(target.path)) {
      for (const match of this.expand(target.path, cwd)) {
        const decision = this.check(match, this.projectRoot, "Bash");
        if (!decision.allowed) return decision;
      }
      return this.check(
        target.path.slice(0, target.path.search(GLOB_CHARS)) || ".",
        cwd,
        "Bash",
        true,
      );
    }
    const direct = this.check(target.path, cwd, "Bash", target.tree);
    if (!direct.allowed || !target.tree) return direct;
    const absolute = this.absolute(target.path, cwd);
    if (absolute === null) return ALLOW;
    for (const file of walkFiles(absolute, this.projectRoot)) {
      const decision = this.check(file, this.projectRoot, "Bash");
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  private expand(pattern: string, cwd: string): string[] {
    const absolute = this.absolute(pattern, cwd);
    if (absolute === null) return [];
    const inside = relative(this.projectRoot, absolute).split("\\").join("/");
    if (inside.startsWith("..") || isAbsolute(inside)) return [];
    const prefix = inside.slice(0, inside.search(GLOB_CHARS));
    const base = prefix.slice(0, prefix.lastIndexOf("/") + 1);
    const matcher = picomatch(inside, { dot: true });
    return walkFiles(join(this.projectRoot, base), this.projectRoot).filter(
      (file) => matcher(file) || [...ancestors(file)].some((directory) => matcher(directory)),
    );
  }

  private absolute(rawPath: string, cwd: string): string | null {
    if (rawPath.startsWith("~") && rawPath !== "~" && !rawPath.startsWith("~/")) return null;
    const expanded = rawPath.startsWith("~") ? resolve(homedir(), rawPath.slice(2)) : rawPath;
    return normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
  }

  private refuse(target: string, reason: string): GuardDecision {
    return { allowed: false, target, rule: null, reason };
  }

  private check(rawPath: string, cwd: string, toolName: string, tree = false): GuardDecision {
    if (rawPath.length === 0 || rawPath.startsWith("$")) return ALLOW;
    const absolute = this.absolute(rawPath, cwd);
    if (absolute === null) return ALLOW;
    if (
      this.protectedPaths.some(
        (path) => pathWithin(absolute, path) || (tree && pathWithin(path, absolute)),
      )
    )
      return this.refuse(absolute, `${absolute} holds Onyx's own data: agents cannot change it.`);
    const inside = relative(this.projectRoot, absolute);
    if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return ALLOW;
    const relPath = inside.split("\\").join("/");
    if (isGitMetadata(relPath))
      return this.refuse(
        relPath,
        `${relPath} is git metadata: Onyx makes the commits, merges and branches, so agents cannot change .git.`,
      );
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
