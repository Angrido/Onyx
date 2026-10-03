import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ScreenBuffer,
  findLoginError,
  findSignInUrl,
  isCompleteSignInUrl,
} from "../../src/infrastructure/screen-buffer";

const REAL_FLOW = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "fixtures", "claude", "setup-token-2.1.288.json"),
    "utf8",
  ),
) as string[];

const URL_TEXT =
  "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz";

describe("screen buffer", () => {
  it("joins soft-wrapped lines so long links stay whole", async () => {
    const screen = new ScreenBuffer(40, 10);
    await screen.write(`Browse to: ${URL_TEXT}\r\n\r\nPaste code here if prompted > `);
    expect(screen.lines()[0]).toBe(`Browse to: ${URL_TEXT}`);
    expect(findSignInUrl(screen.text())).toBe(URL_TEXT);
    screen.dispose();
  });

  it("follows cursor movements and redraws like a terminal", async () => {
    const screen = new ScreenBuffer(80, 10);
    await screen.write("Loading…\r\u001b[2KReady\r\n\u001b[32mgreen\u001b[0m");
    expect(screen.lines()).toEqual(["Ready", "green"]);
    screen.dispose();
  });

  it("rejoins links that the program broke at the terminal width", async () => {
    const screen = new ScreenBuffer(40, 10);
    const chunks = URL_TEXT.match(/.{1,40}/g) ?? [];
    await screen.write(chunks.join("\r\n"));
    expect(findSignInUrl(screen.linkText())).toBe(URL_TEXT);
    screen.dispose();
  });

  it("only treats complete OAuth links as sign-in links", () => {
    expect(findSignInUrl("See https://docs.anthropic.com/en/docs.")).toBeNull();
    expect(findSignInUrl(`Go to ${URL_TEXT}.`)).toBe(URL_TEXT);
    const truncated = URL_TEXT.slice(0, URL_TEXT.indexOf("&redirect_uri"));
    expect(isCompleteSignInUrl(truncated)).toBe(false);
    expect(findSignInUrl(`Browse to: ${truncated}`)).toBeNull();
  });

  it("reads the sign-in link, the OAuth error and the retried link of the real CLI", async () => {
    const [opening = "", failure = "", retried = ""] = REAL_FLOW;
    const screen = new ScreenBuffer(1_000, 40);
    await screen.write(opening);
    const first = findSignInUrl(screen.links().join("\n"));
    expect(first).not.toBeNull();
    expect(findSignInUrl(screen.linkText())).toBe(first);
    const params = new URL(first ?? "").searchParams;
    expect(params.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(findLoginError(screen.lines())).toBeNull();

    await screen.write(failure);
    expect(findLoginError(screen.lines())).toBe("OAuth error: Request failed with status code 400");

    await screen.write(retried);
    const second = findSignInUrl(screen.links().join("\n"));
    expect(second).not.toBe(first);
    expect(new URL(second ?? "").searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(findLoginError(screen.lines())).toBeNull();
    screen.dispose();
  });
});
