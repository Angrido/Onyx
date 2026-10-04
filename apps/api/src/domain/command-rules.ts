import {
  WRAPPER_NAMES,
  commandStart,
  programName,
  separateLines,
  withoutKeywords,
} from "@onyx/ignore-compiler";
import { parse, type ParseEntry } from "shell-quote";
import { msg, tx } from "../i18n";

const SEPARATORS = new Set([";", "&&", "||", "|", "&", "|&", "(", ")"]);
const SKIPPED = new Set([
  "cd",
  "pushd",
  "popd",
  "export",
  "set",
  "true",
  "false",
  ":",
  "exit",
  "fi",
  "done",
  "esac",
  "}",
]);
const REFUSED: Readonly<Record<string, string>> = {
  sudo: msg("runs commands as another user"),
  su: msg("runs commands as another user"),
  doas: msg("runs commands as another user"),
  pkexec: msg("runs commands as another user"),
  mkfs: msg("formats disks"),
  shutdown: msg("stops the machine"),
  reboot: msg("restarts the machine"),
  halt: msg("stops the machine"),
  poweroff: msg("stops the machine"),
};
const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "eval",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
  "php",
  "deno",
  "bun",
]);
const NETWORK = new Set(["curl", "wget", "ssh", "scp", "sftp", "nc", "ncat", "rsync", "ftp"]);
const DESTRUCTIVE = new Set(["rm", "rmdir", "chmod", "chown", "chgrp", "dd", "kill", "pkill"]);
const SAFE = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "diff",
  "sort",
  "uniq",
  "jq",
  "echo",
  "printf",
  "pwd",
  "which",
  "mkdir",
  "touch",
  "tree",
  "file",
  "stat",
  "du",
  "df",
  "date",
  "tsc",
  "vitest",
  "jest",
  "eslint",
  "prettier",
  "biome",
  "playwright",
  "pytest",
  "ruff",
  "mypy",
  "black",
  "isort",
  "gofmt",
  "rustfmt",
]);
const SUBCOMMAND_TOOLS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "cargo",
  "go",
  "git",
  "docker",
  "kubectl",
  "gh",
  "poetry",
  "uv",
  "pip",
  "pip3",
  "make",
]);
const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  npm: ["--prefix", "-w", "--workspace"],
  pnpm: ["--filter", "-F", "-C", "--dir"],
  yarn: ["--cwd"],
  git: ["-C", "-c"],
  make: ["-C", "-f", "-j"],
  docker: ["--context", "-H"],
};
const SCRIPT_RUNNERS = new Set(["run", "run-script"]);
const SAFE_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(["test", "run", "run-script", "ls", "outdated", "audit"]),
  pnpm: new Set(["test", "run", "ls", "list", "outdated", "audit", "build", "lint", "typecheck"]),
  yarn: new Set(["test", "run", "list", "outdated", "build", "lint"]),
  bun: new Set(["test", "run"]),
  cargo: new Set(["test", "check", "build", "clippy", "fmt", "doc"]),
  go: new Set(["test", "build", "vet", "fmt", "list"]),
  git: new Set(["status", "diff", "log", "show", "blame", "branch", "rev-parse", "ls-files"]),
  poetry: new Set(["run", "check", "show"]),
  uv: new Set(["run"]),
  make: new Set(["test", "build", "lint", "check", "fmt", "format", "typecheck"]),
};
const ANY_CODE_SUBCOMMANDS = new Set(["exec", "dlx", "x", "create", "init"]);
const INSTALL_SUBCOMMANDS = new Set(["install", "i", "add", "ci", "sync", "update", "upgrade"]);
const MAX_COMMAND_CHARS = 300;

export const BASH_RULE = /^Bash\((.+)\)$/;

export type RuleSafety = "SAFE" | "REVIEW";

export interface RuleSuggestion {
  rule: string;
  program: string;
  safety: RuleSafety;
  reason: string | null;
  command: string;
  risky: boolean;
}

export interface RefusedCommand {
  command: string;
  program: string;
  reason: string;
}

interface Invocation {
  words: string[];
  wrapper: string | null;
}

function invocations(command: string): Invocation[] {
  let entries: ParseEntry[];
  try {
    entries = parse(separateLines(command), (name) => `$${name}`);
  } catch {
    return [];
  }
  const segments: string[][] = [];
  let current: string[] = [];
  let redirectTarget = false;
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (redirectTarget) {
        redirectTarget = false;
        continue;
      }
      current.push(entry);
    } else if ("op" in entry) {
      if (entry.op === "glob") {
        current.push(entry.pattern);
      } else if (SEPARATORS.has(entry.op)) {
        segments.push(current);
        current = [];
      } else {
        redirectTarget = true;
      }
    }
  }
  segments.push(current);
  const result: Invocation[] = [];
  for (const words of segments.map(withoutKeywords)) {
    const start = commandStart(words);
    const head = words[start];
    if (head === undefined || head.length === 0 || head.startsWith("$")) continue;
    if (SKIPPED.has(head)) continue;
    const wrapper = words.slice(0, start).find((word) => WRAPPER_NAMES.has(programName(word)));
    result.push({ words: words.slice(start), wrapper: wrapper ? programName(wrapper) : null });
  }
  return result;
}

export function commandPrograms(command: string): string[] {
  const programs: string[] = [];
  for (const invocation of invocations(command)) {
    const program = invocation.words[0] ?? "";
    if (!programs.includes(program)) programs.push(program);
  }
  return programs;
}

function rulePrefix(words: readonly string[]): { prefix: string; subcommand: string | null } {
  const program = words[0] ?? "";
  const name = programName(program);
  if (!SUBCOMMAND_TOOLS.has(name)) return { prefix: program, subcommand: null };
  const values = VALUE_OPTIONS[name] ?? [];
  const taken = [program];
  let index = 1;
  while (index < words.length && (words[index] ?? "").startsWith("-")) {
    const option = words[index] ?? "";
    taken.push(option);
    index += 1;
    if (values.includes(option) && index < words.length) {
      taken.push(words[index] ?? "");
      index += 1;
    }
  }
  const subcommand = words[index];
  if (subcommand === undefined) return { prefix: taken.join(" "), subcommand: null };
  taken.push(subcommand);
  if (SCRIPT_RUNNERS.has(subcommand) && words[index + 1] && !words[index + 1]?.startsWith("-"))
    taken.push(words[index + 1] ?? "");
  return { prefix: taken.join(" "), subcommand };
}

function classify(
  name: string,
  subcommand: string | null,
  wrapper: string | null,
): { safety: RuleSafety; reason: string | null } {
  if (INTERPRETERS.has(name))
    return { safety: "REVIEW", reason: tx("runs any code it is given, not just one command") };
  if (NETWORK.has(name))
    return { safety: "REVIEW", reason: tx("reaches the network: it can send project files out") };
  if (DESTRUCTIVE.has(name)) return { safety: "REVIEW", reason: tx("can delete or change files") };
  if (SUBCOMMAND_TOOLS.has(name)) {
    if (subcommand === null) return { safety: "REVIEW", reason: tx("covers every subcommand") };
    if (ANY_CODE_SUBCOMMANDS.has(subcommand))
      return { safety: "REVIEW", reason: tx("downloads and runs any package") };
    if (INSTALL_SUBCOMMANDS.has(subcommand))
      return { safety: "REVIEW", reason: tx("installs packages, which can run their own scripts") };
    if (!SAFE_SUBCOMMANDS[name]?.has(subcommand))
      return {
        safety: "REVIEW",
        reason: tx("{command} is not on the list of safe commands", {
          command: `${name} ${subcommand}`,
        }),
      };
  } else if (name === "npx" || name === "pnpx" || name === "bunx") {
    return { safety: "REVIEW", reason: tx("downloads and runs any package") };
  } else if (!SAFE.has(name)) {
    return { safety: "REVIEW", reason: tx("not on the list of safe commands: check what it does") };
  }
  if (wrapper)
    return {
      safety: "SAFE",
      reason: tx(
        "the agent ran it through {wrapper}: the rule covers the command without {wrapper}",
        { wrapper },
      ),
    };
  return { safety: "SAFE", reason: null };
}

function shortCommand(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > MAX_COMMAND_CHARS ? `${flat.slice(0, MAX_COMMAND_CHARS - 1)}…` : flat;
}

export function analyzeCommands(commands: readonly string[]): {
  suggestions: RuleSuggestion[];
  refused: RefusedCommand[];
} {
  const suggestions: RuleSuggestion[] = [];
  const refused: RefusedCommand[] = [];
  for (const command of commands) {
    for (const invocation of invocations(command)) {
      const name = programName(invocation.words[0] ?? "");
      const refusedProgram =
        REFUSED[name] !== undefined
          ? name
          : invocation.wrapper && REFUSED[invocation.wrapper] !== undefined
            ? invocation.wrapper
            : null;
      if (refusedProgram) {
        const reason = REFUSED[refusedProgram];
        if (!refused.some((entry) => entry.command === shortCommand(command)))
          refused.push({
            command: shortCommand(command),
            program: refusedProgram,
            reason: reason === undefined ? tx("is never allowed") : tx(reason),
          });
        continue;
      }
      const { prefix, subcommand } = rulePrefix(invocation.words);
      if (name === "git" && subcommand === "push") {
        refused.push({
          command: shortCommand(command),
          program: "git push",
          reason: tx("Onyx pushes the branches: agents never push"),
        });
        continue;
      }
      if (/[()\n]/.test(prefix) || prefix.length > 196) continue;
      const rule = `Bash(${prefix} *)`;
      if (suggestions.some((suggestion) => suggestion.rule === rule)) continue;
      const verdict = classify(name, subcommand, invocation.wrapper);
      suggestions.push({
        rule,
        program: prefix,
        safety: verdict.safety,
        reason: verdict.reason,
        command: shortCommand(command),
        risky: verdict.safety !== "SAFE",
      });
    }
  }
  return { suggestions, refused };
}

export function suggestRules(commands: readonly string[]): RuleSuggestion[] {
  return analyzeCommands(commands).suggestions;
}

export function mergeRules(current: readonly string[], added: readonly string[]): string[] {
  const merged = [...current];
  for (const rule of added) {
    const trimmed = rule.trim();
    if (BASH_RULE.test(trimmed) && !merged.includes(trimmed)) merged.push(trimmed);
  }
  return merged;
}

export const CONTINUE_PROMPT_PREFIX = "The commands you could not run before are now allowed";

export function continuePrompt(rules: readonly string[], reply: string | undefined): string {
  const allowed = rules.map((rule) => BASH_RULE.exec(rule)?.[1] ?? rule).join(", ");
  const note =
    rules.length > 0 ? `${CONTINUE_PROMPT_PREFIX}: ${allowed}.` : "Nothing new was allowed.";
  const answer = reply?.trim();
  return answer ? `${note}\n\n${answer}` : `${note} Continue the task.`;
}
