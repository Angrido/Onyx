import type { FastifyInstance } from "fastify";
import { LOCALE_COOKIE, parseLocale, rememberLocale, runWithLocale } from "../i18n";

export function registerLocale(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    const locale = parseLocale(request.cookies[LOCALE_COOKIE]);
    if (locale) rememberLocale(locale);
    runWithLocale(locale ?? "en", done);
  });
}
