import { describe, expect, it } from "vitest";
import { isSensitiveKey, REDACTED, redactText, redactValue } from "../../src/domain/redaction";

const ANTHROPIC = "sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdef";
const API_KEY = "sk-ant-api03-ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210";
const GITHUB_CLASSIC = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const GITHUB_FINE = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGH";
const GITHUB_APP = "ghs_16C7e42F292c6912E7710c838347Ae178B4a";
const TELEGRAM = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik9ueXgifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const VAPID_PRIVATE = "Wq7pD3sZ9xLhN2kV5cR8mB1tY4uE6oA0iJ3fG7hK2lQ";

function leaks(text: string, secrets: readonly string[]): string[] {
  return secrets.filter((secret) => text.includes(secret));
}

describe("redactText", () => {
  it.each([
    ["Anthropic OAuth token", `token is ${ANTHROPIC} ok`, ANTHROPIC],
    ["Anthropic API key", `using ${API_KEY}`, API_KEY],
    ["classic GitHub token", `push with ${GITHUB_CLASSIC}`, GITHUB_CLASSIC],
    ["fine-grained GitHub token", `token=${GITHUB_FINE}`, GITHUB_FINE],
    ["GitHub app token", `x ${GITHUB_APP} y`, GITHUB_APP],
    ["Telegram bot token", `https://api.telegram.org/bot${TELEGRAM}/sendMessage`, TELEGRAM],
    ["JSON web token", `jwt ${JWT}`, JWT],
  ])("hides a %s", (_name, text, secret) => {
    const result = redactText(text);
    expect(result).not.toContain(secret);
    expect(result).toContain(REDACTED);
  });

  it("hides bearer and basic credentials but keeps the scheme", () => {
    expect(redactText("Authorization header was Bearer abc.def-ghi_123")).not.toContain(
      "abc.def-ghi_123",
    );
    expect(redactText("got Bearer abc.def-ghi_123 back")).toBe(`got Bearer ${REDACTED} back`);
    expect(redactText("Basic dXNlcjpwYXNzd29yZA==")).toBe(`Basic ${REDACTED}`);
  });

  it("hides the user and password inside URLs", () => {
    const text = "cloning https://oauth2:s3cr3t-value@github.com/acme/app.git now";
    const result = redactText(text);
    expect(result).toBe(`cloning https://${REDACTED}@github.com/acme/app.git now`);
    expect(redactText("redis://:hunter2@localhost:6379/0")).not.toContain("hunter2");
    expect(redactText("https://x-access-token:abc123@github.com/a/b")).not.toContain("abc123");
  });

  it("hides secrets passed in query strings", () => {
    const result = redactText("GET /cb?code=abc123&state=ok&access_token=zzz999&page=2");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("zzz999");
    expect(result).toContain("state=ok");
    expect(result).toContain("page=2");
  });

  it("hides values of environment-style assignments", () => {
    const text = `ANTHROPIC_API_KEY=plainvalue CLAUDE_CODE_OAUTH_TOKEN="quoted value" VAPID_PRIVATE_KEY=${VAPID_PRIVATE} ONYX_SECRET_KEY: k3y PASSWORD=pw`;
    const result = redactText(text);
    expect(leaks(result, ["plainvalue", "quoted value", VAPID_PRIVATE, "k3y"])).toEqual([]);
    expect(result.endsWith(`PASSWORD=${REDACTED}`)).toBe(true);
    expect(result).toContain("ANTHROPIC_API_KEY=");
  });

  it("hides secret fields inside JSON text", () => {
    const text = JSON.stringify({
      password: "pw-1",
      token: "tok-2",
      client_secret: "cs-3",
      privateKey: "pk-4",
      name: "visible",
    });
    const result = redactText(text);
    expect(leaks(result, ["pw-1", "tok-2", "cs-3", "pk-4"])).toEqual([]);
    expect(result).toContain("visible");
  });

  it("hides cookies and authorization headers in raw text", () => {
    const result = redactText(
      "cookie: onyx_sid=abcdef123456; theme=dark\nauthorization: Token zzz\nset-cookie: a=b",
    );
    expect(leaks(result, ["abcdef123456", "zzz", "a=b"])).toEqual([]);
    expect(redactText("sent onyx_sid=abcdef123456 to")).toBe(`sent onyx_sid=${REDACTED} to`);
  });

  it("hides private keys in PEM blocks", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    expect(redactText(`key: ${pem} done`)).not.toContain("MIIEvQ");
  });

  it("leaves ordinary text alone", () => {
    const text =
      "Run 42 finished in 3.2 s with 1200 input tokens; branch onyx/task-7 pushed to origin";
    expect(redactText(text)).toBe(text);
    expect(redactText("https://github.com/acme/app.git")).toBe("https://github.com/acme/app.git");
  });
});

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "passwd",
    "token",
    "accessToken",
    "refresh_token",
    "secret",
    "clientSecret",
    "authorization",
    "Authorization",
    "cookie",
    "set-cookie",
    "apiKey",
    "x-api-key",
    "privateKey",
    "vapid",
    "vapidKeys",
    "credentials",
    "p256dh",
    "auth",
  ])("treats %s as secret", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["inputTokens", "tokens", "tokenCount", "maxTokens", "name", "publicOrigin", "runId"])(
    "keeps %s visible",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("redactValue", () => {
  it("hides values under secret keys at any depth and scans every other string", () => {
    const input = {
      msg: `cloning with ${GITHUB_CLASSIC}`,
      req: {
        headers: { authorization: "Bearer abc", cookie: "onyx_sid=1", host: "onyx.local" },
      },
      settings: {
        telegram: { token: TELEGRAM, chatId: "42" },
        webPush: { vapid: { publicKey: "pub", privateKey: VAPID_PRIVATE } },
      },
      env: { ANTHROPIC_API_KEY: ANTHROPIC, PATH: "/usr/bin" },
      list: [`Bearer ${API_KEY}`, { password: ["a", "b"] }],
      usage: { inputTokens: 12, outputTokens: 3 },
      when: new Date("2026-10-04T10:00:00.000Z"),
    };
    const result = redactValue(input);
    const text = JSON.stringify(result);
    expect(
      leaks(text, [GITHUB_CLASSIC, "abc", TELEGRAM, VAPID_PRIVATE, ANTHROPIC, API_KEY]),
    ).toEqual([]);
    expect(text).not.toContain('"a"');
    expect(result.req.headers.host).toBe("onyx.local");
    expect(result.settings.telegram.chatId).toBe("42");
    expect(result.env.PATH).toBe("/usr/bin");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(result.when).toEqual(input.when);
    expect(input.env.ANTHROPIC_API_KEY).toBe(ANTHROPIC);
  });

  it("keeps numbers and booleans under secret keys", () => {
    expect(redactValue({ cookieSecure: true, tokenCount: 3, secret: 5 })).toEqual({
      cookieSecure: true,
      tokenCount: 3,
      secret: 5,
    });
  });

  it("stops at deep nesting instead of recursing forever", () => {
    let deep: Record<string, unknown> = { token: "x" };
    for (let index = 0; index < 20; index += 1) deep = { next: deep };
    expect(JSON.stringify(redactValue(deep))).not.toContain('"x"');
  });
});
