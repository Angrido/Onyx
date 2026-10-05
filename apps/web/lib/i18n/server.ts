import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, translator, type Locale, type Translate } from "./core";

export async function getLocale(): Promise<Locale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
