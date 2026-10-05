import { parse, type ParseEntry } from "shell-quote";
import { commandStart, programName, separateLines, withoutKeywords } from "./shell";

const SEPARATORS = new Set([";", "&&", "||", "|", "&", "|&", "(", ")"]);
const PRIVILEGED = new Set(["sudo", "su", "doas", "pkexec", "run0"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const MAX_NESTING = 3;

function segments(command: string): string[][] {
  let entries: ParseEntry[];
  try {
    entries = parse(separateLines(command), (name) => `$${name}`);
  } catch {
    return [];
  }
  const result: string[][] = [];
  let current: string[] = [];
  let skipNext = false;
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (skipNext) skipNext = false;
      else current.push(entry);
    } else if ("op" in entry) {
      if (entry.op === "glob") current.push(entry.pattern);
      else if (SEPARATORS.has(entry.op)) {
        result.push(withoutKeywords(current));
        current = [];
      } else skipNext = true;
    }
  }
  result.push(withoutKeywords(current));
  return result.filter((words) => words.length > 0);
}

function forcedRecursiveRemoval(rest: readonly string[]): boolean {
  let recursive = false;
  let force = false;
  for (const word of rest) {
    if (word === "--") break;
    if (word === "--recursive") recursive = true;
    else if (word === "--force") force = true;
    else if (/^-[A-Za-z]+$/.test(word)) {
      if (/[rR]/.test(word)) recursive = true;
      if (/f/.test(word)) force = true;
    }
  }
  return recursive && force;
}

function gitPush(rest: readonly string[]): boolean {
  let index = 0;
  while (index < rest.length && (rest[index] ?? "").startsWith("-")) {
    const option = rest[index] ?? "";
    index += option === "-C" || option === "-c" ? 2 : 1;
  }
  return rest[index] === "push";
}

export function destructiveReason(command: string, depth = 0): string | null {
  for (const words of segments(command)) {
    const start = commandStart(words);
    const privileged = words.slice(0, start + 1).find((word) => PRIVILEGED.has(programName(word)));
    if (privileged) return `${programName(privileged)} runs commands as another user`;
    const program = programName(words[start] ?? "");
    const rest = words.slice(start + 1);
    if (program === "rm" && forcedRecursiveRemoval(rest)) return "rm -rf deletes whole folders";
    if (program === "git" && gitPush(rest)) return "git push publishes commits: Onyx does that";
    if (SHELLS.has(program) && depth < MAX_NESTING) {
      const flag = rest.findIndex((word) => /^-[a-z]*c$/.test(word));
      const nested = flag === -1 ? undefined : rest[flag + 1];
      if (nested) {
        const reason = destructiveReason(nested, depth + 1);
        if (reason) return reason;
      }
    }
    if (program === "eval" && depth < MAX_NESTING) {
      const reason = destructiveReason(rest.join(" "), depth + 1);
      if (reason) return reason;
    }
  }
  return null;
}
