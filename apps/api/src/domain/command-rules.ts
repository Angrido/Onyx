import { separateLines, withoutKeywords } from "@onyx/ignore-compiler";
import { parse, type ParseEntry } from "shell-quote";

const SEPARATORS = new Set([";", "&&", "||", "|", "&", "|&"]);
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
const WRAPPERS = new Set(["env", "nice", "time", "command", "nohup"]);
const RISKY = new Set([
  "rm",
  "rmdir",
  "sudo",
  "su",
  "chmod",
  "chown",
  "dd",
  "mkfs",
  "shutdown",
  "reboot",
  "kill",
  "pkill",
  "killall",
  "ssh",
  "scp",
  "git",
  "curl",
  "wget",
  "bash",
  "sh",
  "eval",
]);

export const BASH_RULE = /^Bash\((.+)\)$/;

export interface RuleSuggestion {
  rule: string;
  program: string;
  risky: boolean;
}

export function commandPrograms(command: string): string[] {
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
  const programs: string[] = [];
  for (const words of segments.map(withoutKeywords)) {
    let index = 0;
    while (
      index < words.length &&
      (WRAPPERS.has(words[index] ?? "") || /^\w+=/.test(words[index] ?? ""))
    ) {
      index += 1;
    }
    const program = words[index];
    if (program === undefined || program.length === 0 || program.startsWith("$")) continue;
    if (SKIPPED.has(program)) continue;
    if (!programs.includes(program)) programs.push(program);
  }
  return programs;
}

export function suggestRules(commands: readonly string[]): RuleSuggestion[] {
  const suggestions: RuleSuggestion[] = [];
  for (const command of commands) {
    for (const program of commandPrograms(command)) {
      const rule = `Bash(${program} *)`;
      if (suggestions.some((suggestion) => suggestion.rule === rule)) continue;
      const name = program.split("/").pop() ?? program;
      suggestions.push({ rule, program, risky: RISKY.has(name) });
    }
  }
  return suggestions;
}

export function mergeRules(current: readonly string[], added: readonly string[]): string[] {
  const merged = [...current];
  for (const rule of added) {
    const trimmed = rule.trim();
    if (BASH_RULE.test(trimmed) && !merged.includes(trimmed)) merged.push(trimmed);
  }
  return merged;
}

export function continuePrompt(rules: readonly string[], reply: string | undefined): string {
  const allowed = rules.map((rule) => BASH_RULE.exec(rule)?.[1] ?? rule).join(", ");
  const note =
    rules.length > 0
      ? `The commands you could not run before are now allowed: ${allowed}.`
      : "Nothing new was allowed.";
  const answer = reply?.trim();
  return answer ? `${note}\n\n${answer}` : `${note} Continue the task.`;
}
