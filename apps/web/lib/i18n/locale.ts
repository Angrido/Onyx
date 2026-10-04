export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "it";
export const LOCALE_COOKIE = "onyx_locale";
export const LOCALE_COOKIE_MAX_AGE = 31_536_000;
