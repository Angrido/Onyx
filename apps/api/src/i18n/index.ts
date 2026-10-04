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
