import { AsyncLocalStorage } from "node:async_hooks";
import { IT } from "./it";

export type Locale = "it" | "en";
export type Params = Record<string, string | number>;

export const LOCALE_COOKIE = "onyx_locale";

const storage = new AsyncLocalStorage<Locale>();
let backgroundLocale: Locale = "en";

export function parseLocale(value: string | null | undefined): Locale | null {
  return value === "it" || value === "en" ? value : null;
}

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

export function rememberLocale(locale: Locale): void {
  backgroundLocale = locale;
}

export function currentLocale(): Locale {
  return storage.getStore() ?? backgroundLocale;
}

export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  );
}

export function tx(text: string, params?: Params): string {
  return interpolate(currentLocale() === "it" ? (IT[text] ?? text) : text, params);
}

export function msg(text: string): string {
  return text;
}

export type KnownParams = Readonly<Record<string, (value: string) => string>>;

const knownPatterns = new Map<string, { pattern: RegExp; names: string[] }>();

function knownPattern(key: string): { pattern: RegExp; names: string[] } {
  const cached = knownPatterns.get(key);
  if (cached) return cached;
  const names: string[] = [];
  const source = key
    .split(/(\{\w+\})/)
    .map((part, index) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name === undefined) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(name);
      if (name === "count") return "(-?\\d+)";
      return index === 1 && key.startsWith("{") ? "([\\s\\S]*)" : "([\\s\\S]*?)";
    })
    .join("");
  const entry = { pattern: new RegExp(`^${source}$`), names };
  knownPatterns.set(key, entry);
  return entry;
}

function translateKnown(text: string, keys: readonly string[], own: KnownParams): string {
  for (const key of keys) {
    const { pattern, names } = knownPattern(key);
    const match = pattern.exec(text);
    if (!match) continue;
    const params: Params = {};
    names.forEach((name, index) => {
      const value = match[index + 1] ?? "";
      const custom = own[name];
      params[name] = custom
        ? custom(value)
        : value.length < text.length
          ? translateKnown(value, keys, own)
          : value;
    });
    return tx(key, params);
  }
  return text;
}

export function txKnown(text: string, keys: readonly string[], own: KnownParams = {}): string {
  if (currentLocale() === "en") return text;
  return translateKnown(text, keys, own);
}

export function txKnownOrNull(
  text: string | null,
  keys: readonly string[],
  own: KnownParams = {},
): string | null {
  return text === null ? null : txKnown(text, keys, own);
}
