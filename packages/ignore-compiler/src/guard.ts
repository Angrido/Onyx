import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { parse, type ParseEntry } from "shell-quote";
import type { ContextPolicy, Explanation } from "./policy";
import type { PolicyRule } from "./rules";
import { DirectoryTracker, pathWithin, separateLines, withoutKeywords } from "./shell";

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
const WRAPPERS = new Set(["sudo", "env", "nice", "time", "xargs", "command", "exec"]);
const GLOB_CHARS = /[*?[{]/;
const OBFUSCATION = /\$\(|`|\b(bash|sh|zsh|dash|eval|xargs|python3?|node|perl|ruby)\b/;

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

  private absolutePath(path: string, cwd: string): string | null {
    if (path === "~") return this.home;
    if (path.startsWith("~/")) return resolve(this.home, path.slice(2));
    if (path.startsWith("~")) return null;
    return isAbsolute(path) ? path : resolve(cwd, path);
  }

  evaluate(call: ToolCall): GuardDecision {
    if (!isRecord(call.toolInput)) return ALLOW;
    const cwd = call.cwd ?? this.projectRoot;
    if (call.toolName === "Bash") {
      const command = call.toolInput["command"];
      return typeof command === "string" ? this.evaluateCommand(command, cwd) : ALLOW;
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

  evaluateCommand(command: string, cwd: string): GuardDecision {
    let entries: ParseEntry[];
    try {
      entries = parse(separateLines(command), (name) => `$${name}`);
    } catch {
      return ALLOW;
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
    return OBFUSCATION.test(command) ? this.sweep(command, cwd) : ALLOW;
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

  private evaluateWords(words: readonly string[], cwd: string): GuardDecision {
    let index = 0;
    while (
      index < words.length &&
      (WRAPPERS.has(words[index] ?? "") || /^\w+=/.test(words[index] ?? ""))
    ) {
      index += 1;
    }
    const program = (words[index] ?? "").split("/").pop() ?? "";
    let args = words.slice(index + 1).filter((word) => !word.startsWith("-"));
    if (SCRIPTED_COMMANDS.has(program) || (SEARCH_COMMANDS.has(program) && program !== "git")) {
      args = args.slice(1);
    } else if (COPY_COMMANDS.has(program)) {
      args = args.slice(0, -1);
    } else if (program === "git") {
      const sub = args[0];
      if (sub !== "show" && sub !== "diff" && sub !== "log" && sub !== "blame") return ALLOW;
      args = args.slice(1).map((arg) => arg.replace(/^[^:]*:/, ""));
    } else if (!READ_COMMANDS.has(program)) {
      return ALLOW;
    }
    for (const arg of args) {
      if (arg.length === 0 || arg.startsWith("$")) continue;
      const decision = this.check(arg, cwd, "Bash");
      if (!decision.allowed) return decision;
    }
    return ALLOW;
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
    let first: GuardDecision | null = null;
    let matched = 0;
    for (const file of this.files) {
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
