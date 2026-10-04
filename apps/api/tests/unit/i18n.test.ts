import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IT } from "../../src/i18n/it";

const ROOT = join(import.meta.dirname, "..", "..", "src");
const KEY_CALL = /\b(?:tx|msg)\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;
const TEMPLATE_CALL = /\b(?:tx|msg)\(\s*`/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "i18n" ? [] : files(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

function unescape(text: string): string {
  return text.replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n");
}

const sources = files(ROOT).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

const keys = (text: string) =>
  [...text.matchAll(KEY_CALL)].map((match) => unescape(match[2] ?? ""));

describe("server translations", () => {
  it("has an Italian text for every key the server uses", () => {
    const missing = sources.flatMap((source) =>
      keys(source.text)
        .filter((key) => IT[key] === undefined)
        .map((key) => `${source.path}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("never builds a key with a template literal", () => {
    const found = sources.filter((source) => [...source.text.matchAll(TEMPLATE_CALL)].length > 0);
    expect(found.map((source) => source.path)).toEqual([]);
  });

  it("keeps the placeholders of every message", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const broken = Object.entries(IT).filter(
      ([key, value]) => names(key).join() !== names(value).join() || value.trim().length === 0,
    );
    expect(broken).toEqual([]);
  });

  it("uses every Italian text somewhere", () => {
    const used = new Set(sources.flatMap((source) => keys(source.text)));
    expect(Object.keys(IT).filter((key) => !used.has(key))).toEqual([]);
  });
});
