"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  setActiveLocale,
  translator,
  type Locale,
  type Translate,
} from "./core";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  setActiveLocale(locale);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}

export function storeLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
