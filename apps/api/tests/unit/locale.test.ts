import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerLocale } from "../../src/http/locale";
import { currentLocale, rememberLocale, runWithLocale, tx } from "../../src/i18n";
import { IT } from "../../src/i18n/it";

async function app() {
  const server = Fastify();
  await server.register(cookie);
  registerLocale(server);
  server.addHook("preHandler", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  server.get("/locale", async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return { locale: currentLocale() };
  });
  return server;
}

describe("server locale", () => {
  afterEach(() => rememberLocale("en"));

  it("follows the onyx_locale cookie of each request through async hooks", async () => {
    const server = await app();
    const [it, en, none] = await Promise.all([
      server.inject({ url: "/locale", cookies: { onyx_locale: "it" } }),
      server.inject({ url: "/locale", cookies: { onyx_locale: "en" } }),
      server.inject({ url: "/locale" }),
    ]);
    expect(it.json()).toEqual({ locale: "it" });
    expect(en.json()).toEqual({ locale: "en" });
    expect(none.json()).toEqual({ locale: "en" });
    await server.close();
  });

  it("uses the last language seen for work outside a request", async () => {
    const server = await app();
    expect(currentLocale()).toBe("en");
    await server.inject({ url: "/locale", cookies: { onyx_locale: "it" } });
    expect(currentLocale()).toBe("it");
    await server.inject({ url: "/locale", cookies: { onyx_locale: "bogus" } });
    expect(currentLocale()).toBe("it");
    await server.close();
  });

  it("translates known texts and keeps placeholders", () => {
    const [key] = Object.keys(IT);
    if (key === undefined) return;
    expect(runWithLocale("en", () => tx(key))).toBe(key);
    expect(runWithLocale("it", () => tx(key))).toBe(IT[key]);
    expect(runWithLocale("it", () => tx("Unknown {n}", { n: 3 }))).toBe("Unknown 3");
  });
});
