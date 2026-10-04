import { IT } from "./it";

export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "it";
export const LOCALE_COOKIE = "onyx_locale";
export const LOCALE_NAMES: Record<Locale, string> = { it: "Italiano", en: "English" };

export type Params = Record<string, string | number>;
export type Translate = (text: string, params?: Params) => string;

export function msg(text: string): string {
  return text;
}

export function parseLocale(value: string | null | undefined): Locale {
  return value === "en" || value === "it" ? value : DEFAULT_LOCALE;
}

export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  );
}

export function translator(locale: Locale): Translate {
  return (text, params) => interpolate(locale === "it" ? (IT[text] ?? text) : text, params);
}

export const english: Translate = translator("en");

let activeLocale: Locale = DEFAULT_LOCALE;

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function activeTranslator(): Translate {
  return translator(activeLocale);
}
