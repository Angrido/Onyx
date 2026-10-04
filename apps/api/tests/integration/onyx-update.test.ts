import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ONYX_SCRIPT = resolve(fileURLToPath(new URL("../../../../scripts/onyx", import.meta.url)));

let root = "";
let upstream = "";
let author = "";
let checkout = "";

function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Onyx Test",
    GIT_AUTHOR_EMAIL: "test@onyx.invalid",
    GIT_COMMITTER_NAME: "Onyx Test",
    GIT_COMMITTER_EMAIL: "test@onyx.invalid",
    ...extra,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: environment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(content: string): string {
  writeFileSync(join(author, "file.txt"), `${content}\n`);
  git(author, ["add", "file.txt"]);
  git(author, ["commit", "-q", "-m", content]);
  git(author, ["push", "-q", "origin", "main"]);
  return git(author, ["rev-parse", "--short", "HEAD"]);
}

function updateCode(
  directory: string,
  extra: Record<string, string> = {},
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "bash",
    ["-c", 'source "$1"; ROOT="$2"; update_code', "onyx", ONYX_SCRIPT, directory],
    { env: environment(extra), encoding: "utf8" },
  );
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "onyx-update-test-"));
  upstream = join(root, "upstream.git");
  author = join(root, "author");
  checkout = join(root, "checkout");
  git(root, ["init", "-q", "--bare", "-b", "main", upstream]);
  git(root, ["config", "--global", "safe.directory", upstream]);
  git(root, ["clone", "-q", upstream, author]);
  commit("first");
  git(root, ["clone", "-q", upstream, checkout]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("onyx-update code step", () => {
  it("updates a checkout that git sees as owned by another user", () => {
    const foreign = { GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" };
    const plain = spawnSync("git", ["-C", checkout, "status"], {
      env: environment(foreign),
      encoding: "utf8",
    });
    expect(plain.status).not.toBe(0);
    expect(plain.stderr).toMatch(/dubious ownership/);
    const before = git(checkout, ["rev-parse", "--short", "HEAD"]);
    const after = commit("second");

    const result = updateCode(checkout, foreign);
    expect(result.stderr).not.toMatch(/error/);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`code updated: ${before} -> ${after}`);
    expect(readFileSync(join(checkout, "file.txt"), "utf8")).toBe("second\n");
  });

  it("reports an up to date checkout", () => {
    const result = updateCode(checkout);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/the code is up to date/);
  });

  it("stops with an error when the pull fails", () => {
    commit("second");
    git(checkout, ["remote", "set-url", "origin", join(root, "missing.git")]);
    const result = updateCode(checkout);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/git pull from origin\/main failed .*the code was not updated/);
    expect(result.stdout).not.toMatch(/updated/);
    expect(readFileSync(join(checkout, "file.txt"), "utf8")).toBe("first\n");
  });

  it("stops with an error when git cannot read the checkout", () => {
    const plain = join(root, "not-a-checkout");
    mkdirSync(plain);
    const result = updateCode(plain, { GIT_CEILING_DIRECTORIES: root });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/git cannot read the checkout in .*the code was not updated/);
  });

  it("skips the pull on a branch without upstream or a detached HEAD", () => {
    git(checkout, ["switch", "-q", "-c", "local"]);
    const local = updateCode(checkout);
    expect(local.code).toBe(0);
    expect(local.stderr).toMatch(/the branch local has no upstream: skipping git pull/);

    git(checkout, ["switch", "-q", "--detach"]);
    const detached = updateCode(checkout);
    expect(detached.code).toBe(0);
    expect(detached.stderr).toMatch(/HEAD is detached/);
  });
});
