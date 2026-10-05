import { isAbsolute, resolve } from "node:path";

const LEADING_KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "!"]);
const HEREDOC_DELIMITER = /^\s*-?\s*(["']?)([^\s;|&<>()"']+)\1/;

function heredocDelimiter(command: string, start: number): string | null {
  const match = HEREDOC_DELIMITER.exec(command.slice(start));
  return match?.[2] ?? null;
}

function skipHeredocBodies(command: string, start: number, delimiters: string[]): number {
  let index = start;
  for (const delimiter of delimiters) {
    while (index < command.length) {
      const end = command.indexOf("\n", index);
      const line = command.slice(index, end === -1 ? command.length : end);
      index = end === -1 ? command.length : end + 1;
      if (line.replace(/^\t+/, "").trimEnd() === delimiter) break;
    }
  }
  return index;
}

export function separateLines(command: string): string {
  let output = "";
  let quote: "'" | '"' | null = null;
  let heredocs: string[] = [];
  let index = 0;
  while (index < command.length) {
    const char = command[index] ?? "";
    const next = command[index + 1] ?? "";
    if (quote !== "'" && char === "\\") {
      if (next === "\n") {
        index += 2;
        continue;
      }
      output += char + next;
      index += 2;
      continue;
    }
    if (quote === null && char === "<" && next === "<" && command[index + 2] !== "<") {
      const delimiter = heredocDelimiter(command, index + 2);
      if (delimiter !== null) heredocs.push(delimiter);
      output += "<<";
      index += 2;
      continue;
    }
    if (char === "'" && quote !== '"') quote = quote === "'" ? null : "'";
    else if (char === '"' && quote !== "'") quote = quote === '"' ? null : '"';
    if (quote === null && (char === "\n" || char === "\r")) {
      output += ";";
      index += 1;
      if (char === "\r" && next === "\n") index += 1;
      if (heredocs.length > 0) {
        index = skipHeredocBodies(command, index, heredocs);
        heredocs = [];
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

export function withoutKeywords(words: readonly string[]): string[] {
  let index = 0;
  while (index < words.length && LEADING_KEYWORDS.has(words[index] ?? "")) index += 1;
  return words.slice(index);
}

function unresolvable(target: string): boolean {
  return target === "-" || target.includes("$") || target.includes("`") || /^~[-+]/.test(target);
}

export class DirectoryTracker {
  private current: string[];
  private previous: string[] | null = null;
  private readonly scopes: string[][] = [];
  private readonly stack: string[][] = [];

  constructor(
    private readonly start: string,
    private readonly root: string,
    private readonly home: string,
  ) {
    this.current = [start];
  }

  candidates(): readonly string[] {
    return this.current;
  }

  open(): void {
    this.scopes.push(this.current);
  }

  close(): void {
    const restored = this.scopes.pop();
    if (restored) this.current = restored;
  }

  enter(words: readonly string[]): boolean {
    const [program, ...rest] = words;
    if (program === "popd") {
      this.move(this.stack.pop() ?? this.widened());
      return true;
    }
    if (program !== "cd" && program !== "pushd") return false;
    if (program === "pushd") this.stack.push(this.current);
    const target = rest.find((word) => word === "-" || !word.startsWith("-"));
    if (target === undefined) {
      this.move(program === "pushd" ? this.widened() : [this.home]);
    } else if (target === "-" && this.previous !== null) {
      this.move(this.previous);
    } else if (unresolvable(target)) {
      this.move(this.widened());
    } else {
      this.move(this.current.map((directory) => this.resolveTarget(directory, target)));
    }
    return true;
  }

  private resolveTarget(directory: string, target: string): string {
    if (target === "~") return this.home;
    if (target.startsWith("~/")) return resolve(this.home, target.slice(2));
    return isAbsolute(target) ? target : resolve(directory, target);
  }

  private widened(): string[] {
    return [...new Set([...this.current, this.start, this.root])];
  }

  private move(next: readonly string[]): void {
    this.previous = this.current;
    this.current = [...new Set(next)];
  }
}

export function pathWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

export function isGitMetadata(relPath: string): boolean {
  return relPath === ".git" || relPath.startsWith(".git/") || relPath.includes("/.git/");
}

interface WrapperSpec {
  values: readonly string[];
  positional: number;
}

const WRAPPER_SPECS: Readonly<Record<string, WrapperSpec>> = {
  sudo: {
    values: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T", "--user", "--group"],
    positional: 0,
  },
  doas: { values: ["-u", "-C"], positional: 0 },
  env: { values: ["-u", "-C", "--unset", "--chdir"], positional: 0 },
  nice: { values: ["-n", "--adjustment"], positional: 0 },
  ionice: { values: ["-c", "-n", "-p", "-P", "-u", "--class", "--classdata"], positional: 0 },
  chrt: { values: ["-T", "-P", "-D"], positional: 1 },
  timeout: { values: ["-s", "-k", "--signal", "--kill-after"], positional: 1 },
  nohup: { values: [], positional: 0 },
  stdbuf: { values: ["-i", "-o", "-e", "--input", "--output", "--error"], positional: 0 },
  setsid: { values: [], positional: 0 },
  time: { values: ["-f", "-o", "--format", "--output"], positional: 0 },
  command: { values: [], positional: 0 },
  builtin: { values: [], positional: 0 },
  exec: { values: ["-a"], positional: 0 },
  busybox: { values: [], positional: 0 },
  watch: { values: ["-n", "--interval"], positional: 0 },
  xargs: {
    values: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "--arg-file", "--delimiter"],
    positional: 0,
  },
};

export const WRAPPER_NAMES: ReadonlySet<string> = new Set(Object.keys(WRAPPER_SPECS));

export function programName(word: string): string {
  return word.split("/").pop() ?? "";
}

export function commandStart(words: readonly string[]): number {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      index += 1;
      continue;
    }
    const spec = WRAPPER_SPECS[programName(word)];
    if (!spec) break;
    index += 1;
    while (index < words.length && (words[index] ?? "").startsWith("-")) {
      const option = words[index] ?? "";
      index += 1;
      if (option === "--") break;
      if (spec.values.includes(option)) index += 1;
    }
    index += spec.positional;
  }
  return index;
}
