import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { parse, type ParseEntry } from "shell-quote";
import type { ContextPolicy, Explanation } from "./policy";
import type { PolicyRule } from "./rules";
import {
  DirectoryTracker,
  commandStart,
  pathWithin,
  programName,
  separateLines,
  withoutKeywords,
} from "./shell";

export interface ToolCall {
  toolName: string;
  toolInput: unknown;
  cwd: string | null;
}

export interface GuardDecision {
  allowed: boolean;
  target: string | null;
  rule: PolicyRule | null;
  reason: string | null;
}

const ALLOW: GuardDecision = { allowed: true, target: null, rule: null, reason: null };
const UNREADABLE: GuardDecision = {
  allowed: false,
  target: null,
  rule: null,
  reason: "Onyx could not read this tool call, so it cannot tell which files it opens.",
};

const FILE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  Read: ["file_path"],
  NotebookRead: ["notebook_path"],
  LS: ["path"],
  Grep: ["path"],
  Glob: ["path"],
  LSP: ["file_path", "path"],
};

const READ_COMMANDS = new Set([
  "cat",
  "tac",
  "less",
  "more",
  "head",
  "tail",
  "nl",
  "od",
  "xxd",
  "hexdump",
  "strings",
  "base64",
  "bat",
  "batcat",
  "view",
  "cp",
  "rsync",
  "scp",
  "tar",
  "zip",
  "diff",
  "cmp",
  "jq",
  "yq",
  "sort",
  "uniq",
  "cut",
  "wc",
  "md5sum",
  "sha256sum",
  "file",
  "stat",
  "ls",
  "find",
  "tree",
  "du",
]);

const COPY_COMMANDS = new Set(["cp", "rsync", "scp"]);
const SCRIPTED_COMMANDS = new Set(["sed", "awk", "gawk"]);
const SEARCH_COMMANDS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "git"]);
const GLOB_CHARS = /[*?[{]/;
const NON_READERS = new Set([
  "echo",
  "printf",
  "mkdir",
  "rmdir",
  "touch",
  "rm",
  "mv",
  "ln",
  "chmod",
  "chown",
  "chgrp",
  "cd",
  "pushd",
  "popd",
  "export",
  "unset",
  "set",
  "true",
  "false",
  "test",
  "[",
  "[[",
  "sleep",
  "kill",
  "pkill",
  "which",
  "type",
  "wait",
  "exit",
  "return",
  "trap",
  "shift",
  "alias",
  "umask",
  "ulimit",
  "date",
  "pwd",
  "whoami",
  "id",
  "uname",
  "seq",
  "yes",
  "clear",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "mktemp",
]);
const BUILD_TOOLS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "npx",
  "pnpx",
  "bunx",
  "corepack",
  "tsc",
  "tsx",
  "vite",
  "vitest",
  "jest",
  "eslint",
  "prettier",
  "biome",
  "webpack",
  "rollup",
  "esbuild",
  "turbo",
  "nx",
  "next",
  "playwright",
  "make",
  "cmake",
  "cargo",
  "go",
  "rustc",
  "gcc",
  "g++",
  "cc",
  "clang",
  "javac",
  "mvn",
  "gradle",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "pytest",
  "ruff",
  "mypy",
  "black",
  "isort",
  "docker",
  "podman",
  "kubectl",
  "helm",
  "terraform",
  "gh",
  "prisma",
]);
const SOURCE_COMMANDS = new Set(["source", "."]);
const RECURSIVE_SEARCH = new Set(["grep", "egrep", "fgrep"]);
const UNRESTRICTED_SEARCH = /^(?:--hidden|--no-ignore\S*|--unrestricted|-u+|-\.|--all-types)$/;
const EXCLUSION_FLAG =
  /^--?(?:exclude|exclude-dir|exclude-from|ignore|ignore-dir|iglob|glob|x)(?:=|$)/;
const PROC_CWD = /^\/proc\/(?:self|thread-self|\d+)\/cwd(?=\/|$)/;
const PROC_ROOT = /^\/proc\/(?:self|thread-self|\d+)\/root(?=\/|$)/;
const IFS_VARIABLE = /\$\{IFS\}|\$IFS\b/g;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const WALK_LIMIT = 20_000;
const WALK_DEPTH = 8;
const WALK_TTL_MS = 3_000;
const WALK_SKIPPED = new Set([".git", "node_modules"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const INTERPRETERS = new Set(["python", "python3", "node", "perl", "ruby", "php", "deno", "bun"]);
const CODE_FLAGS = new Set(["-c", "-e", "-E", "--eval", "-r", "-p", "--print"]);
const SUBSTITUTIONS = [/\$\(([^()]*)\)/g, /`([^`]*)`/g];
const STRING_LITERAL = /'([^'\n]*)'|"([^"\n]*)"/g;
const MAX_NESTING = 3;
const SEARCH_VALUE_FLAGS = new Set([
  "-A",
  "-B",
  "-C",
  "-m",
  "-d",
  "-D",
  "-t",
  "-T",
  "-g",
  "-j",
  "-M",
  "-E",
  "--max-count",
  "--after-context",
  "--before-context",
  "--context",
  "--include",
  "--exclude",
  "--exclude-dir",
  "--type",
  "--type-not",
  "--glob",
  "--iglob",
  "--threads",
  "--max-columns",
  "--encoding",
  "--color",
  "--colour",
]);
const TREE_VALUE_FLAGS = new Set(["-L", "-P", "-I", "-o", "--filelimit", "--charset", "--timefmt"]);
const FIND_LEADING_FLAGS = /^-(?:[HLP]|O\d*|D)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += glob[index + 2] === "/" ? "(?:.*/)?" : ".*";
        index += glob[index + 2] === "/" ? 2 : 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[" && glob.indexOf("]", index + 2) > index) {
      const end = glob.indexOf("]", index + 2);
      const body = glob.slice(index + 1, end);
      const negated = body.startsWith("!") || body.startsWith("^");
      const members = (negated ? body.slice(1) : body).replace(/[\\\]^]/g, "\\$&");
      source += negated ? `[^/${members}]` : `[${members}]`;
      index = end;
    } else if (char === "{") {
      const end = glob.indexOf("}", index);
      if (end < 0) {
        source += "\\{";
        continue;
      }
      const options = glob
        .slice(index + 1, end)
        .split(",")
        .map((option) => option.replace(/[.+^$()|[\]\\]/g, "\\$&"));
      source += `(?:${options.join("|")})`;
      index = end;
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function staticPrefix(path: string): string {
  const index = path.search(GLOB_CHARS);
  if (index < 0) return path;
  const prefix = path.slice(0, index);
  return prefix.slice(0, prefix.lastIndexOf("/") + 1);
}

export class PathGuard {
  private readonly readers = new Set([...READ_COMMANDS, ...SCRIPTED_COMMANDS, ...SEARCH_COMMANDS]);

  private readonly knownFiles: ReadonlySet<string>;
  private readonly coveredDirectories = new Map<string, Explanation | null>();
  private readonly walks = new Map<string, { at: number; files: string[] }>();
  private realRoot: string | null = null;

  constructor(
    private readonly policy: ContextPolicy,
    private readonly projectRoot: string,
    private readonly files: readonly string[] = [],
    private readonly home: string = homedir(),
    private readonly protectedPaths: readonly string[] = [],
  ) {
    this.knownFiles = new Set(files);
  }

  private shielded(absolute: string, pattern: boolean): GuardDecision | null {
    const hit = this.protectedPaths.find(
      (path) => pathWithin(absolute, path) || (pattern && pathWithin(path, absolute)),
    );
    if (hit === undefined) return null;
    return {
      allowed: false,
      target: absolute,
      rule: null,
      reason: `${absolute} holds Onyx's own data (keys, database, backups or run files): agents cannot read it.`,
    };
  }

  private realPath(absolute: string): string | null {
    let real: string;
    try {
      real = realpathSync(absolute);
    } catch {
      return null;
    }
    this.realRoot ??= (() => {
      try {
        return realpathSync(this.projectRoot);
      } catch {
        return this.projectRoot;
      }
    })();
    return pathWithin(real, this.realRoot)
      ? join(this.projectRoot, relative(this.realRoot, real))
      : real;
  }

  private absolutePath(path: string, cwd: string): string | null {
    if (PROC_CWD.test(path)) return resolve(cwd, `.${path.replace(PROC_CWD, "")}`);
    if (PROC_ROOT.test(path)) return resolve("/", `.${path.replace(PROC_ROOT, "")}`);
    if (path === "~") return this.home;
    if (path.startsWith("~/")) return resolve(this.home, path.slice(2));
    if (path.startsWith("~")) return null;
    return isAbsolute(path) ? path : resolve(cwd, path);
  }

  evaluate(call: ToolCall): GuardDecision {
    const checked = call.toolName === "Bash" || FILE_TOOLS[call.toolName] !== undefined;
    if (!isRecord(call.toolInput)) return checked ? UNREADABLE : ALLOW;
    const cwd = call.cwd ?? this.projectRoot;
    if (call.toolName === "Bash") {
      const command = call.toolInput["command"];
      return typeof command === "string" ? this.evaluateCommand(command, cwd) : UNREADABLE;
    }
    const keys = FILE_TOOLS[call.toolName];
    if (!keys) return ALLOW;
    for (const key of keys) {
      const value = call.toolInput[key];
      if (typeof value !== "string" || value.length === 0) continue;
      const decision = this.check(value, cwd, call.toolName);
      if (!decision.allowed) return decision;
    }
    if (call.toolName === "Glob" || call.toolName === "Grep") {
      const pattern = call.toolInput[call.toolName === "Glob" ? "pattern" : "glob"];
      const base =
        typeof call.toolInput["path"] === "string" ? (call.toolInput["path"] as string) : cwd;
      if (typeof pattern === "string" && pattern.length > 0) {
        const decision = this.check(
          isAbsolute(pattern) ? pattern : resolve(base, pattern),
          cwd,
          call.toolName,
          "all",
        );
        if (!decision.allowed) return decision;
      }
    }
    return ALLOW;
  }

  evaluateCommand(command: string, cwd: string, depth = 0): GuardDecision {
    let entries: ParseEntry[];
    try {
      const text = separateLines(command).replace(IFS_VARIABLE, " ");
      const variables = this.variables(
        parse(text, (name) => `$${name}`),
        cwd,
      );
      entries = parse(text, (name) => variables.get(name) ?? `$${name}`);
    } catch {
      return {
        allowed: false,
        target: null,
        rule: null,
        reason:
          "Onyx could not read this command, so it cannot tell which files it opens. Split it into simpler commands.",
      };
    }
    const tracker = new DirectoryTracker(cwd, this.projectRoot, this.home);
    let segment: string[] = [];
    let redirectInput = false;
    const flush = (): GuardDecision => {
      const words = withoutKeywords(segment);
      segment = [];
      if (tracker.enter(words)) return ALLOW;
      return this.inEach(tracker, (directory) => this.evaluateWords(words, directory));
    };
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (redirectInput) {
          redirectInput = false;
          const decision = this.inEach(tracker, (directory) =>
            this.check(entry, directory, "Bash"),
          );
          if (!decision.allowed) return decision;
          continue;
        }
        segment.push(entry);
      } else if ("op" in entry) {
        if (entry.op === "glob") {
          segment.push(entry.pattern);
          continue;
        }
        if (entry.op === "<") {
          redirectInput = true;
          continue;
        }
        const decision = flush();
        if (!decision.allowed) return decision;
        if (entry.op === "(") tracker.open();
        else if (entry.op === ")") tracker.close();
      }
    }
    const last = flush();
    if (!last.allowed) return last;
    if (depth >= MAX_NESTING) return ALLOW;
    for (const pattern of SUBSTITUTIONS) {
      for (const match of command.matchAll(pattern)) {
        const decision = this.evaluateCommand(match[1] ?? "", cwd, depth + 1);
        if (!decision.allowed) return decision;
      }
    }
    return /\bxargs\b/.test(command) ? this.sweep(command, cwd) : ALLOW;
  }

  private variables(entries: readonly ParseEntry[], cwd: string): Map<string, string> {
    const variables = new Map<string, string>([
      ["PWD", cwd],
      ["HOME", this.home],
    ]);
    let atStart = true;
    for (const entry of entries) {
      if (typeof entry !== "string") {
        atStart = "op" in entry && entry.op !== "glob";
        continue;
      }
      const assignment = atStart ? ASSIGNMENT.exec(entry) : null;
      if (assignment?.[1] && assignment[2] !== undefined && !assignment[2].includes("$"))
        variables.set(assignment[1], assignment[2]);
      else atStart = false;
    }
    return variables;
  }

  private nested(program: string, rest: readonly string[], cwd: string): GuardDecision {
    if (program === "eval") return this.evaluateCommand(rest.join(" "), cwd, MAX_NESTING - 1);
    const flag = rest.findIndex((word) => CODE_FLAGS.has(word) || /^-[a-z]*c$/.test(word));
    if (flag === -1) {
      const script = rest.find((word) => !word.startsWith("-"));
      return script === undefined ? ALLOW : this.check(script, cwd, "Bash");
    }
    const code = rest[flag + 1] ?? "";
    if (SHELLS.has(program)) return this.evaluateCommand(code, cwd, MAX_NESTING - 1);
    for (const match of code.matchAll(STRING_LITERAL)) {
      const literal = match[1] ?? match[2] ?? "";
      if (literal.length === 0 || /\s/.test(literal) || !/[./]/.test(literal)) continue;
      const decision = this.check(literal, cwd, "Bash");
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  private searchTargets(rest: readonly string[]): string[] {
    const targets: string[] = [];
    let patternGiven = false;
    let positional = false;
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index] ?? "";
      if (!positional && word === "--") {
        positional = true;
        continue;
      }
      if (!positional && word.startsWith("-") && word.length > 1) {
        if (word === "-e" || word === "--regexp") {
          patternGiven = true;
          index += 1;
        } else if (word === "-f" || word === "--file") {
          patternGiven = true;
          targets.push(rest[index + 1] ?? "");
          index += 1;
        } else if (word.startsWith("--regexp=")) {
          patternGiven = true;
        } else if (word.startsWith("--file=")) {
          patternGiven = true;
          targets.push(word.slice("--file=".length));
        } else if (SEARCH_VALUE_FLAGS.has(word)) {
          index += 1;
        }
        continue;
      }
      if (!patternGiven) {
        patternGiven = true;
        continue;
      }
      targets.push(word);
    }
    return targets;
  }

  private findTargets(rest: readonly string[]): string[] {
    let index = 0;
    while (index < rest.length && FIND_LEADING_FLAGS.test(rest[index] ?? "")) index += 1;
    const targets: string[] = [];
    for (; index < rest.length; index += 1) {
      const word = rest[index] ?? "";
      if (word.startsWith("-") || word === "(" || word === "!" || word === "\\(") break;
      targets.push(word);
    }
    return targets;
  }

  private treeTargets(rest: readonly string[]): string[] {
    const targets: string[] = [];
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index] ?? "";
      if (TREE_VALUE_FLAGS.has(word)) {
        index += 1;
        continue;
      }
      if (word.startsWith("-")) continue;
      targets.push(word);
    }
    return targets;
  }

  private inEach(
    tracker: DirectoryTracker,
    decide: (directory: string) => GuardDecision,
  ): GuardDecision {
    for (const directory of tracker.candidates()) {
      const decision = decide(directory);
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  private sweep(command: string, cwd: string): GuardDecision {
    const tokens = command.split(/[\s;|&()<>`"'=]+/).filter((token) => token.length > 0);
    if (!tokens.some((token) => this.readers.has(token.split("/").pop() ?? ""))) return ALLOW;
    for (const token of tokens) {
      if (token.startsWith("-") || token.startsWith("$") || this.readers.has(token)) continue;
      if (!/[./]/.test(token)) continue;
      const decision = this.check(token, cwd, "Bash");
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  private readArguments(words: readonly string[]): string[] {
    const targets: string[] = [];
    let positional = false;
    for (const word of words) {
      if (!positional && word === "--") {
        positional = true;
        continue;
      }
      if (!positional && word.startsWith("-")) {
        const equals = word.indexOf("=");
        if (word.startsWith("--") && equals > 2) targets.push(word.slice(equals + 1));
        continue;
      }
      const value = word.startsWith("@") ? word.slice(1) : word;
      const assignment = /^[A-Za-z_][\w-]*=(.+)$/.exec(value);
      targets.push(assignment?.[1] ?? value);
    }
    return targets;
  }

  private checkAll(targets: readonly string[], cwd: string): GuardDecision {
    for (const target of targets) {
      if (target.length === 0 || target.startsWith("$")) continue;
      const decision = this.check(target, cwd, "Bash");
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  private evaluateGit(rest: readonly string[], cwd: string): GuardDecision {
    let index = 0;
    let directory = cwd;
    while (index < rest.length && (rest[index] ?? "").startsWith("-")) {
      const option = rest[index] ?? "";
      if (option === "-C") directory = resolve(directory, rest[index + 1] ?? ".");
      index += option === "-C" || option === "-c" ? 2 : 1;
    }
    const sub = rest[index] ?? "";
    const args = rest.slice(index + 1);
    if (sub === "grep") return this.checkAll(this.searchTargets(args), directory);
    if (!["show", "diff", "log", "blame", "cat-file"].includes(sub)) return ALLOW;
    for (const arg of this.readArguments(args)) {
      const revision = /^[^:/]*:(.+)$/.exec(arg);
      const decision = revision?.[1]
        ? this.check(revision[1].replace(/^\.\//, ""), this.projectRoot, "Bash")
        : this.checkAll([arg], directory);
      if (!decision.allowed) return decision;
    }
    return ALLOW;
  }

  private recursiveTargets(program: string, rest: readonly string[]): string[] | null {
    const flags = rest.filter((word) => word.startsWith("-"));
    if (flags.some((flag) => EXCLUSION_FLAG.test(flag))) return null;
    const cluster = (letters: RegExp) =>
      flags.some((flag) => !flag.startsWith("--") && letters.test(flag.slice(1)));
    const args = this.readArguments(rest);
    if (RECURSIVE_SEARCH.has(program)) {
      const recursive =
        cluster(/[rR]/) || flags.some((flag) => /^--(?:dereference-)?recursive$/.test(flag));
      if (!recursive) return null;
      const targets = this.searchTargets(rest);
      return targets.length > 0 ? targets : ["."];
    }
    if (program === "rg" || program === "ag") {
      if (!flags.some((flag) => UNRESTRICTED_SEARCH.test(flag))) return null;
      const targets = this.searchTargets(rest);
      return targets.length > 0 ? targets : ["."];
    }
    if (program === "cp" || program === "scp" || program === "rsync") {
      const recursive =
        cluster(/[rRa]/) || flags.some((flag) => flag === "--recursive" || flag === "--archive");
      return recursive ? args.slice(0, -1) : null;
    }
    if (program === "zip") return cluster(/r/) ? args.slice(1) : null;
    if (program === "tar") {
      const [mode = "", ...others] = rest;
      const letters = mode.replace(/^-/, "");
      if (!/^[A-Za-z]+$/.test(letters) || !/[cru]/.test(letters)) return null;
      const inputs = this.readArguments(others);
      return letters.includes("f") ? inputs.slice(1) : inputs;
    }
    return null;
  }

  private recursiveRead(program: string, targets: readonly string[], cwd: string): GuardDecision {
    for (const target of targets) {
      const absolute = this.absolutePath(target, cwd);
      if (absolute === null) continue;
      const inside = relative(this.projectRoot, normalize(absolute)).split("\\").join("/");
      if (inside.startsWith("..") || isAbsolute(inside)) continue;
      const secret = this.diskFiles(inside === "" ? "." : inside).find((file) => {
        const explanation = this.policy.explain(file, false);
        return explanation.excluded && explanation.rule?.source === "SECURITY";
      });
      if (secret === undefined) continue;
      const explanation = this.policy.explain(secret, false);
      return {
        allowed: false,
        target: secret,
        rule: explanation.rule,
        reason: `${program} would read ${secret} along with ${inside === "" ? "the project" : inside}, and ${secret} is protected (${explanation.rule?.reason ?? "secrets"}). Name the files or folders to read, or exclude it (for example --exclude).`,
      };
    }
    return ALLOW;
  }

  private evaluateWords(words: readonly string[], cwd: string): GuardDecision {
    const start = commandStart(words);
    const head = words[start] ?? "";
    if (head.length === 0) return ALLOW;
    const rest = words.slice(start + 1);
    if (head.startsWith("$")) return this.checkAll(this.readArguments(rest), cwd);
    const program = programName(head);
    if (SOURCE_COMMANDS.has(program)) return this.checkAll(rest.slice(0, 1), cwd);
    if (SHELLS.has(program) || INTERPRETERS.has(program) || program === "eval")
      return this.nested(program, rest, cwd);
    if (program === "git") return this.evaluateGit(rest, cwd);
    if (NON_READERS.has(program) || BUILD_TOOLS.has(program)) return ALLOW;
    let targets: string[];
    if (SEARCH_COMMANDS.has(program)) targets = this.searchTargets(rest);
    else if (program === "find") targets = this.findTargets(rest);
    else if (program === "tree") targets = this.treeTargets(rest);
    else if (SCRIPTED_COMMANDS.has(program)) targets = this.readArguments(rest).slice(1);
    else if (COPY_COMMANDS.has(program)) targets = this.readArguments(rest).slice(0, -1);
    else targets = this.readArguments(rest);
    const decision = this.checkAll(targets, cwd);
    if (!decision.allowed) return decision;
    const recursive = this.recursiveTargets(program, rest);
    return recursive === null ? ALLOW : this.recursiveRead(program, recursive, cwd);
  }

  private diskFiles(relDir: string): string[] {
    const absolute = relDir === "." ? this.projectRoot : join(this.projectRoot, relDir);
    const cached = this.walks.get(absolute);
    if (cached && Date.now() - cached.at < WALK_TTL_MS) return cached.files;
    const files: string[] = [];
    const visit = (directory: string, depth: number): void => {
      if (files.length >= WALK_LIMIT) return;
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
          if (depth < WALK_DEPTH && !WALK_SKIPPED.has(entry.name)) visit(path, depth + 1);
        } else {
          files.push(relative(this.projectRoot, path).split("\\").join("/"));
        }
      }
    };
    try {
      if (lstatSync(absolute).isDirectory()) visit(absolute, 0);
      else files.push(relative(this.projectRoot, absolute).split("\\").join("/"));
    } catch {
      return [];
    }
    this.walks.set(absolute, { at: Date.now(), files });
    return files;
  }

  private checkGlob(
    rawPath: string,
    cwd: string,
    toolName: string,
    quantifier: "any" | "all",
  ): GuardDecision {
    const absolute = this.absolutePath(rawPath, cwd);
    if (absolute === null) return ALLOW;
    const inside = relative(this.projectRoot, absolute).split("\\").join("/");
    if (inside.startsWith("..") || isAbsolute(inside)) return ALLOW;
    const matcher = globToRegExp(inside);
    const prefix = staticPrefix(inside).replace(/\/$/, "");
    const candidates = new Set([...this.files, ...this.diskFiles(prefix === "" ? "." : prefix)]);
    let first: GuardDecision | null = null;
    let matched = 0;
    for (const file of candidates) {
      if (!matcher.test(file)) continue;
      matched += 1;
      const decision = this.check(file, this.projectRoot, toolName, null);
      if (decision.allowed) {
        if (quantifier === "all") return ALLOW;
        continue;
      }
      if (quantifier === "any") return decision;
      first ??= decision;
    }
    return matched > 0 && first ? first : ALLOW;
  }

  private coveredDirectory(relPath: string): Explanation | null {
    const cached = this.coveredDirectories.get(relPath);
    if (cached !== undefined) return cached;
    const prefix = `${relPath}/`;
    let first: Explanation | null = null;
    for (const file of this.files) {
      if (!file.startsWith(prefix)) continue;
      const explanation = this.policy.explain(file, false);
      if (!explanation.excluded) {
        first = null;
        break;
      }
      first ??= explanation;
    }
    this.coveredDirectories.set(relPath, first);
    return first;
  }

  private check(
    rawPath: string,
    cwd: string,
    toolName: string,
    quantifier: "any" | "all" | null = "any",
  ): GuardDecision {
    if (quantifier !== null && GLOB_CHARS.test(rawPath)) {
      const decision = this.checkGlob(rawPath, cwd, toolName, quantifier);
      if (!decision.allowed) return decision;
    }
    const cleaned = staticPrefix(rawPath);
    if (cleaned.length === 0 && rawPath.search(GLOB_CHARS) === 0) return ALLOW;
    const resolved = this.absolutePath(cleaned || ".", cwd);
    if (resolved === null) return ALLOW;
    const absolute = normalize(resolved);
    const shielded = this.shielded(absolute, cleaned !== rawPath);
    if (shielded) return shielded;
    const real = this.realPath(absolute);
    if (real !== null && real !== absolute) {
      const decision = this.check(real, this.projectRoot, toolName, null);
      if (!decision.allowed) return decision;
    }
    const inside = relative(this.projectRoot, absolute);
    if (inside.startsWith("..") || isAbsolute(inside)) return ALLOW;
    const relPath = inside.split("\\").join("/");
    if (relPath.length === 0) return ALLOW;
    const asDirectory = rawPath.endsWith("/") || cleaned !== rawPath;
    const knownFile = this.knownFiles.has(relPath);
    const fileExplanation = asDirectory ? null : this.policy.explain(relPath, false);
    const directoryExplanation = knownFile ? null : this.policy.explain(relPath, true);
    const hit = fileExplanation?.excluded
      ? fileExplanation
      : directoryExplanation?.excluded
        ? directoryExplanation
        : knownFile
          ? null
          : this.coveredDirectory(relPath);
    if (!hit) return ALLOW;
    const pattern = hit.rule
      ? hit.rule.action === "INCLUDE"
        ? `!${hit.rule.pattern}`
        : hit.rule.pattern
      : "profile";
    return {
      allowed: false,
      target: relPath,
      rule: hit.rule,
      reason: `${relPath} is outside the agent's context (Onyx context profile rule "${pattern}"). Use the onyx MCP tools or files that are in scope instead of ${toolName === "Bash" ? "shell reads" : toolName}.`,
    };
  }
}
