import { createRequire } from "node:module";
import type * as Headless from "@xterm/headless";

const load = createRequire(import.meta.url);
const headless = load("@xterm/headless") as typeof Headless;

const SIGN_IN_URL = /https:\/\/[^\s"'<>]+/g;

const REQUIRED_SIGN_IN_PARAMS = ["client_id", "redirect_uri", "code_challenge", "state"];
const MAX_HYPERLINKS = 20;
const LOGIN_ERROR = /\b(?:OAuth error|Login failed|Authentication failed|Error)\b:?\s*(.*)$/i;

export function isCompleteSignInUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return REQUIRED_SIGN_IN_PARAMS.every((name) => (url.searchParams.get(name) ?? "").length > 0);
  } catch {
    return false;
  }
}

export function findSignInUrl(text: string): string | null {
  const candidates = [...text.matchAll(SIGN_IN_URL)]
    .map((match) => match[0].replace(/[).,;]+$/, ""))
    .filter((url) => /oauth|authorize/i.test(url) && isCompleteSignInUrl(url));
  return candidates.at(-1) ?? null;
}

export function findLoginError(lines: readonly string[]): string | null {
  const lastLink = lines.findLastIndex((line) => /oauth\/authorize|Paste code here/i.test(line));
  const lastError = lines.findLastIndex((line) => /\bOAuth error\b|\bLogin failed\b/i.test(line));
  if (lastError === -1 || lastError < lastLink) return null;
  const line = (lines[lastError] ?? "").replace(/\s+/g, " ").trim();
  const match = LOGIN_ERROR.exec(line);
  return (match ? line.slice(match.index) : line).slice(0, 300);
}

export class ScreenBuffer {
  private readonly terminal: Headless.Terminal;
  private readonly hyperlinks: string[] = [];

  constructor(
    readonly cols: number,
    rows: number,
    scrollback = 2_000,
  ) {
    this.terminal = new headless.Terminal({ cols, rows, scrollback, allowProposedApi: true });
    this.terminal.parser.registerOscHandler(8, (data) => {
      const target = data.slice(data.indexOf(";") + 1);
      if (target.length > 0) this.hyperlinks.push(target);
      if (this.hyperlinks.length > MAX_HYPERLINKS) this.hyperlinks.shift();
      return false;
    });
  }

  links(): string[] {
    return [...this.hyperlinks];
  }

  write(data: string): Promise<void> {
    return new Promise((resolve) => this.terminal.write(data, resolve));
  }

  lines(): string[] {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length > 0 && (lines.at(-1) ?? "").trim().length === 0) lines.pop();
    return lines;
  }

  text(): string {
    return this.lines().join("\n");
  }

  linkText(): string {
    const joined: string[] = [];
    let previousFull = false;
    for (const line of this.lines()) {
      if (previousFull && joined.length > 0 && !/^\s/.test(line)) joined[joined.length - 1] += line;
      else joined.push(line);
      previousFull = line.length > 0 && line.length % this.cols === 0;
    }
    return joined.join("\n");
  }

  bracketedPaste(): boolean {
    return this.terminal.modes.bracketedPasteMode;
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
