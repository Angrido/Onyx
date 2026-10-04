import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { english, interpolate, parseLocale, translator } from "@/lib/i18n/core";
import { IT } from "@/lib/i18n/it";

const ROOT = join(import.meta.dirname, "..");
const SOURCES = ["app", "components", "lib"];
const KEY_CALL = /\b(?:t|msg)\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;
const TEMPLATE_CALL = /\b(?:t|msg)\(\s*`/g;
const JSX_TEXT = /(?<![=-])>\s*([^<>{}=;]*[A-Za-zÀ-ÿ]{2,}[^<>{}=;]*?)\s*</g;
const TOAST_LITERAL = /\btoast\.(?:success|error|info|warning|message)\(\s*["'`]/g;
const LITERAL_ATTRIBUTE =
  /\s(placeholder|aria-label|title|alt|label|hint|description|defaultLabel)=("[^"]*[A-Za-z]{2,}[^"]*")/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "i18n" ? [] : files(path);
    return /\.(tsx?|mts)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function unescape(text: string): string {
  return text.replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n");
}

const sources = SOURCES.flatMap((dir) => files(join(ROOT, dir))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

describe("translations", () => {
  it("has an Italian text for every key the interface uses", () => {
    const missing = new Set<string>();
    for (const source of sources)
      for (const match of source.text.matchAll(KEY_CALL)) {
        const key = unescape(match[2] ?? "");
        if (IT[key] === undefined) missing.add(`${source.path}: ${key}`);
      }
    expect([...missing]).toEqual([]);
  });

  it("never builds a key with a template literal", () => {
    const found = sources.flatMap((source) =>
      [...source.text.matchAll(TEMPLATE_CALL)].map(() => source.path),
    );
    expect(found).toEqual([]);
  });

  it("leaves no English text outside t() in the components", () => {
    const found: string[] = [];
    for (const source of sources) {
      if (!source.path.endsWith(".tsx")) continue;
      for (const match of source.text.matchAll(JSX_TEXT)) {
        const text = (match[1] ?? "").replace(/\s+/g, " ").trim();
        if (/^[()]|[(?:]$/.test(text)) continue;
        if (/^[\w.-]+$/.test(text) && !/[a-z]{3,} /.test(text) && !/^[A-Z][a-z]+$/.test(text))
          continue;
        found.push(`${source.path}: ${text}`);
      }
      for (const match of source.text.matchAll(LITERAL_ATTRIBUTE))
        found.push(`${source.path}: ${match[1]}=${match[2]}`);
      for (const match of source.text.matchAll(TOAST_LITERAL))
        found.push(`${source.path}: toast at ${match.index}`);
    }
    expect(found).toEqual([]);
  });

  it("keeps the placeholders of every message", () => {
    const broken = Object.entries(IT).filter(([key, value]) => {
      const names = (text: string) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      return names(key).join() !== names(value).join() || value.trim().length === 0;
    });
    expect(broken).toEqual([]);
  });

  it("uses every Italian text somewhere", () => {
    const used = new Set<string>();
    for (const source of sources)
      for (const match of source.text.matchAll(KEY_CALL)) used.add(unescape(match[2] ?? ""));
    expect(Object.keys(IT).filter((key) => !used.has(key))).toEqual([]);
  });

  it("translates, interpolates and falls back to English", () => {
    expect(translator("it")("Language")).toBe("Lingua");
    expect(english("Language")).toBe("Language");
    expect(translator("it")("Not translated {count}", { count: 2 })).toBe("Not translated 2");
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("de")).toBe("it");
  });
});
