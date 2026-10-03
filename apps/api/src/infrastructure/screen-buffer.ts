import { createRequire } from "node:module";
import type * as Headless from "@xterm/headless";

const load = createRequire(import.meta.url);
const headless = load("@xterm/headless") as typeof Headless;

const SIGN_IN_URL = /https:\/\/[^\s"'<>]+/g;

export function findSignInUrl(text: string): string | null {
  const candidates = [...text.matchAll(SIGN_IN_URL)]
    .map((match) => match[0].replace(/[).,;]+$/, ""))
    .filter((url) => /oauth|authorize/i.test(url));
  return candidates.at(-1) ?? null;
}

export class ScreenBuffer {
  private readonly terminal: Headless.Terminal;

  constructor(
    readonly cols: number,
    rows: number,
    scrollback = 2_000,
  ) {
    this.terminal = new headless.Terminal({ cols, rows, scrollback, allowProposedApi: true });
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

  dispose(): void {
    this.terminal.dispose();
  }
}
