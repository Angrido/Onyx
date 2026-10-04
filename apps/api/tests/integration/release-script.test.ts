import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RELEASE_SCRIPT = resolve(
  fileURLToPath(new URL("../../../../deploy/scripts/release.sh", import.meta.url)),
);

type Health = "ready" | "down" | "database" | "claude" | "sandbox";

const FAKE_CLI = `const { appendFileSync, existsSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const release = dirname(dirname(__dirname));
const args = process.argv.slice(2);
appendFileSync(process.env.CLI_LOG, JSON.stringify({ release: basename(release), args }) + "\\n");
if (args[0] === "migrate") {
  if (existsSync(join(release, "migrate-fails"))) {
    console.log("The migration failed: the database is back as it was before the update");
    process.exit(1);
  }
  console.log("Backup written before the migration: onyx-pre-update-test.db");
  console.log("The database is up to date");
}
`;

const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
case "$1" in
  is-active) [ -e "$STATE_DIR/running" ] ;;
  stop) rm -f "$STATE_DIR/running" ;;
  start | restart) touch "$STATE_DIR/running" ;;
  *) exit 0 ;;
esac
`;

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

let server: Server;
let port = 0;
let root = "";
let base = "";
let state = "";

function currentRelease(): string | null {
  try {
    return readlinkSync(join(base, "current"));
  } catch {
    return null;
  }
}

beforeAll(async () => {
  server = createServer((_request, response) => {
    const current = currentRelease();
    if (!existsSync(join(state, "running")) || !current) {
      response.socket?.destroy();
      return;
    }
    const health = readFileSync(join(current, "health"), "utf8").trim() as Health;
    if (health === "down") {
      response.socket?.destroy();
      return;
    }
    const checks = [
      { name: "database", ok: health !== "database", detail: null },
      { name: "claude-cli", ok: health !== "claude", detail: null },
      { name: "agent-sandbox", ok: health !== "sandbox", detail: null },
      { name: "credentials", ok: false, detail: "none" },
    ];
    const ready = health === "ready";
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ready, checks, cliVersion: null }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "onyx-release-test-"));
  base = join(root, "opt");
  state = join(root, "state");
  mkdirSync(join(base, "releases"), { recursive: true });
  mkdirSync(state);
  mkdirSync(join(root, "units"));
  writeFileSync(join(root, "systemctl"), FAKE_SYSTEMCTL);
  chmodSync(join(root, "systemctl"), 0o755);
  writeFileSync(
    join(root, "onyx.env"),
    `ONYX_BACKUP_DIR="${join(root, "backups")}"\nDATABASE_URL=file:${join(root, "onyx.db")}\n`,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeRelease(
  directory: string,
  options: { migrations: string[]; health: Health; migrateFails?: boolean },
): string {
  mkdirSync(join(directory, "api", "dist"), { recursive: true });
  writeFileSync(join(directory, "api", "dist", "cli.js"), FAKE_CLI);
  for (const name of options.migrations)
    mkdirSync(join(directory, "db", "prisma", "migrations", name), { recursive: true });
  mkdirSync(join(directory, "deploy", "systemd"), { recursive: true });
  for (const unit of ["onyx-api.service", "onyx-web.service"])
    writeFileSync(
      join(directory, "deploy", "systemd", unit),
      `[Unit]\nDescription=${basename(directory)}\n`,
    );
  writeFileSync(join(directory, "health"), `${options.health}\n`);
  if (options.migrateFails) writeFileSync(join(directory, "migrate-fails"), "");
  return directory;
}

function installed(name: string, options: { migrations: string[]; health: Health }): string {
  return makeRelease(join(base, "releases", name), options);
}

function makeCurrent(release: string): void {
  symlinkSync(release, join(base, "current"));
}

function staged(options: { migrations: string[]; health: Health; migrateFails?: boolean }): string {
  return makeRelease(join(root, "stage", "release"), options);
}

function running(): void {
  writeFileSync(join(state, "running"), "");
}

function release(stage: string, version: string): Promise<Result> {
  return new Promise((done) => {
    const child = spawn("bash", [RELEASE_SCRIPT, stage, version], {
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: root,
        ONYX_RELEASE_AS_SELF: "1",
        ONYX_BASE_DIR: base,
        ONYX_ENV_FILE: join(root, "onyx.env"),
        ONYX_UNIT_DIR: join(root, "units"),
        ONYX_SYSTEMCTL: join(root, "systemctl"),
        ONYX_HEALTH_URL: `http://127.0.0.1:${port}/api/ready`,
        ONYX_HEALTH_ATTEMPTS: "3",
        ONYX_HEALTH_DELAY: "0.1",
        CLI_LOG: join(root, "cli.log"),
        SYSTEMCTL_LOG: join(root, "systemctl.log"),
        STATE_DIR: state,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

function cliCalls(): { release: string; args: string[] }[] {
  const file = join(root, "cli.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { release: string; args: string[] });
}

function systemctlCalls(): string[] {
  const file = join(root, "systemctl.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

function releases(): string[] {
  return readdirSync(join(base, "releases")).sort();
}

describe("release.sh", () => {
  it("switches to a healthy release and reports it", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    running();
    const result = await release(staged({ migrations: ["m1", "m2"], health: "ready" }), "v2");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Released v2\n$/);
    expect(currentRelease()).toBe(join(base, "releases", "v2"));
    expect(existsSync(join(base, "current.new"))).toBe(false);
    expect(existsSync(join(base, "releases", "v2", ".release-pending"))).toBe(false);
    expect(readFileSync(join(root, "units", "onyx-api.service"), "utf8")).toContain("release");
    expect(cliCalls()).toEqual([
      { release: "v2", args: ["migrate", "--prisma-dir", join(base, "releases", "v2", "db")] },
    ]);
    expect(systemctlCalls()).toContain("stop onyx-web.service onyx-api.service");
    expect(systemctlCalls()).toContain("restart onyx-api.service onyx-web.service");
    expect(existsSync(join(root, "backups"))).toBe(true);
  });

  it("goes back to the previous release and database when the new one is not ready", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    running();
    const result = await release(staged({ migrations: ["m1", "m2"], health: "database" }), "v2");
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/Released/);
    expect(result.stderr).toMatch(/v2 is not ready .*failing checks: database/);
    expect(result.stderr).toMatch(
      /the update failed and was undone: v1 is the current release again/,
    );
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
    expect(releases()).toEqual(["v1"]);
    expect(cliCalls()).toContainEqual({
      release: "v1",
      args: ["restore", "onyx-pre-update-test.db", "--force"],
    });
    expect(readFileSync(join(root, "units", "onyx-api.service"), "utf8")).toContain("v1");
    expect(systemctlCalls().at(-1)).toBe("start onyx-api.service onyx-web.service");
    expect(existsSync(join(state, "running"))).toBe(true);
  });

  it("keeps the database when the failed release brought no migration", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    running();
    const result = await release(staged({ migrations: ["m1"], health: "down" }), "v2");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/v2 does not answer/);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
    expect(cliCalls().map((call) => call.args[0])).toEqual(["migrate"]);
    expect(releases()).toEqual(["v1"]);
  });

  it("starts the previous release again when the migration fails", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    running();
    const result = await release(
      staged({ migrations: ["m1", "m2"], health: "ready", migrateFails: true }),
      "v2",
    );
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/Released/);
    expect(result.stderr).toMatch(/the migration failed/);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
    expect(releases()).toEqual(["v1"]);
    expect(systemctlCalls().at(-1)).toBe("start onyx-api.service onyx-web.service");
  });

  it("does not start Onyx after a failed update when it was stopped before", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    const result = await release(staged({ migrations: ["m1", "m2"], health: "database" }), "v2");
    expect(result.code).toBe(1);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
    expect(existsSync(join(state, "running"))).toBe(false);
  });

  it("accepts a release that fails only the checks that already failed before", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "claude" }));
    running();
    const result = await release(staged({ migrations: ["m1"], health: "claude" }), "v2");
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/not ready \(failing checks: claude-cli\), as before the update/);
    expect(result.stdout).toMatch(/Released v2/);
    expect(currentRelease()).toBe(join(base, "releases", "v2"));
  });

  it("rolls back a release that breaks a check that passed before", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    running();
    const result = await release(staged({ migrations: ["m1"], health: "claude" }), "v2");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/failing checks: claude-cli/);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
  });

  it("accepts a release that fails only machine checks when Onyx was stopped before", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    const result = await release(staged({ migrations: ["m1"], health: "claude" }), "v2");
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/failing checks: claude-cli\): these depend on this machine/);
    expect(result.stdout).toMatch(/Released v2\n$/);
    expect(currentRelease()).toBe(join(base, "releases", "v2"));
  });

  it("never tolerates a failing agent sandbox that worked before", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    const stopped = await release(staged({ migrations: ["m1"], health: "sandbox" }), "v2");
    expect(stopped.code).toBe(1);
    expect(stopped.stderr).toMatch(/failing checks: agent-sandbox/);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
    running();
    const started = await release(staged({ migrations: ["m1"], health: "sandbox" }), "v3");
    expect(started.code).toBe(1);
    expect(started.stdout).not.toMatch(/Released/);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
    expect(releases()).toEqual(["v1"]);
  });

  it("keeps a failed first release when there is nothing to go back to", async () => {
    const result = await release(staged({ migrations: ["m1"], health: "database" }), "v1");
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/Released/);
    expect(result.stderr).toMatch(/no previous release to go back to/);
    expect(currentRelease()).toBe(join(base, "releases", "v1"));
  });

  it("keeps three releases and removes the ones that never finished", async () => {
    const old = ["a", "b", "c", "d"].map((name, index) => {
      const directory = installed(name, { migrations: ["m1"], health: "ready" });
      const seconds = Date.now() / 1000 - 1000 + index * 10;
      utimesSync(directory, seconds, seconds);
      return directory;
    });
    const broken = installed("broken", { migrations: ["m1"], health: "ready" });
    writeFileSync(join(broken, ".release-pending"), "");
    makeCurrent(old[0] as string);
    running();
    const result = await release(staged({ migrations: ["m1"], health: "ready" }), "v2");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Removing release broken/);
    expect(releases()).toEqual(["a", "d", "v2"]);
  });

  it("refuses to overwrite an existing release", async () => {
    makeCurrent(installed("v1", { migrations: ["m1"], health: "ready" }));
    const result = await release(staged({ migrations: ["m1"], health: "ready" }), "v1");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/already exists/);
    expect(cliCalls()).toEqual([]);
  });
});
