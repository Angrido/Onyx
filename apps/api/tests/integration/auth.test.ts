import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ORIGIN,
  PASSWORD,
  authenticate,
  createTestContext,
  destroyTestContext,
  type TestContext,
} from "../helpers";

let context: TestContext;

beforeEach(async () => {
  context = await createTestContext();
});

afterEach(async () => {
  await destroyTestContext(context);
});

describe("authentication", () => {
  it("runs the first-user setup exactly once", async () => {
    const { app } = context;
    const before = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(before.json()).toEqual({ setupRequired: true });

    const cookie = await authenticate(app);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ user: { username: "admin" } });

    const after = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(after.json()).toEqual({ setupRequired: false });

    const again = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "intruder", password: PASSWORD },
    });
    expect(again.statusCode).toBe(409);
  });

  it("issues hardened session cookies", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: PASSWORD },
    });
    const cookie = response.cookies.find((entry) => entry.name === "onyx_sid");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  });

  it("rejects weak setup passwords", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "admin", password: "short" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("logs in, logs out and rejects bad credentials", async () => {
    const { app } = context;
    await authenticate(app);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "not-the-password" },
    });
    expect(wrong.statusCode).toBe(401);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ghost", password: PASSWORD },
    });
    expect(unknown.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookie = `onyx_sid=${login.cookies.find((entry) => entry.name === "onyx_sid")?.value}`;

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("protects private routes and checks request origins", async () => {
    const { app } = context;
    const anonymous = await app.inject({ method: "GET", url: "/api/projects" });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await authenticate(app);
    const crossSite = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie, origin: "http://evil.example" },
      payload: { name: "x", rootPath: context.projectRoot },
    });
    expect(crossSite.statusCode).toBe(403);

    const sameSite = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie, origin: ORIGIN },
    });
    expect(sameSite.statusCode).toBe(200);
  });

  it("accepts setup and writes from any LAN address the browser used", async () => {
    const { app } = context;
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: { host: "192.168.1.50:3000", origin: "http://192.168.1.50:3000" },
      payload: { username: "admin", password: PASSWORD },
    });
    expect(setup.statusCode).toBe(201);
    const cookie = `onyx_sid=${setup.cookies.find((entry) => entry.name === "onyx_sid")?.value}`;

    const viaMdns = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie, host: "onyx.local", origin: "http://onyx.local" },
      payload: { name: "lan", rootPath: context.projectRoot },
    });
    expect(viaMdns.statusCode).toBe(201);

    const viaProxy = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      remoteAddress: "127.0.0.1",
      headers: {
        cookie,
        host: "127.0.0.1:4000",
        "x-forwarded-host": "10.0.0.20",
        origin: "http://10.0.0.20",
      },
    });
    expect(viaProxy.statusCode).toBe(204);
  });

  it("rejects DNS rebinding and mismatched hosts", async () => {
    const { app } = context;
    const rebinding = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: { host: "rebind.attacker.io", origin: "http://rebind.attacker.io" },
      payload: { username: "admin", password: PASSWORD },
    });
    expect(rebinding.statusCode).toBe(403);

    const mismatched = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: { host: "192.168.1.50", origin: "http://192.168.1.99" },
      payload: { username: "admin", password: PASSWORD },
    });
    expect(mismatched.statusCode).toBe(403);
  });

  it("describes how to reach Onyx on the network", async () => {
    const { app } = context;
    const cookie = await authenticate(app);
    const network = await app.inject({
      method: "GET",
      url: "/api/system/network",
      headers: { cookie, host: "192.168.1.50:3000" },
    });
    expect(network.statusCode).toBe(200);
    const body = network.json<{ currentOrigin: string; urls: string[]; mdnsName: string }>();
    expect(body.currentOrigin).toBe("http://192.168.1.50:3000");
    expect(body.urls.every((url) => url.endsWith(":3000"))).toBe(true);
    expect(body.urls).toContain(`http://${body.mdnsName}:3000`);
  });

  it("serves health and readiness publicly", async () => {
    const health = await context.app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toMatchObject({ status: "ok" });
    const ready = await context.app.inject({ method: "GET", url: "/api/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ready: true, cliVersion: "0.0.0-stub" });
  });
});
