import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitSummary } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  folderSpace,
  HealthService,
  inspectTestRunner,
  type FolderSpace,
  type HealthProject,
} from "../../src/application/health-service";
import {
  credentialsCheck,
  diskCheck,
  formatBytes,
  gitCheck,
  indexCheck,
  renderFinding,
  requiredPrograms,
  resolveTestCommand,
  ruleCommand,
  testsCheck,
  worstLevel,
} from "../../src/domain/health";
import { projectHealth } from "../../src/domain/mission";
import { runWithLocale } from "../../src/i18n";

const NOW = new Date("2026-10-04T10:00:00.000Z");
const DAY = 86_400_000;
const GIB = 1024 ** 3;

const GIT: GitSummary = {
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  changeCount: 0,
  checkedAt: NOW.toISOString(),
  error: null,
};

let root: string;
let bin: string;

function executable(path: string): void {
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}

function write(relative: string, text: string): void {
  mkdirSync(join(root, relative, ".."), { recursive: true });
  writeFileSync(join(root, relative), text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "onyx-health-"));
  bin = join(root, "_bin");
  mkdirSync(bin);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("index check", () => {
  it("is an error when indexing failed", () => {
    expect(
      indexCheck({ state: "failed", error: "parse error", indexedAt: null }, NOW),
    ).toMatchObject({ id: "index", level: "ERROR", params: { error: "parse error" } });
  });

  it("asks for attention when never indexed or stale", () => {
    expect(indexCheck({ state: "never", error: null, indexedAt: null }, NOW).level).toBe(
      "ATTENTION",
    );
    const stale = indexCheck(
      { state: "ready", error: null, indexedAt: new Date(NOW.getTime() - 20 * DAY) },
      NOW,
    );
    expect(stale).toMatchObject({ level: "ATTENTION", params: { days: 20 } });
  });

  it("is fine when recent or running", () => {
    expect(indexCheck({ state: "indexing", error: null, indexedAt: null }, NOW).level).toBe("OK");
    expect(
      indexCheck({ state: "ready", error: null, indexedAt: new Date(NOW.getTime() - DAY) }, NOW),
    ).toMatchObject({ level: "OK", message: "Indexed 1 day ago" });
    expect(
      indexCheck({ state: "ready", error: null, indexedAt: new Date(NOW.getTime() - 60_000) }, NOW)
        .message,
    ).toBe("Indexed in the last 24 hours");
  });
});

describe("git check", () => {
  it("is an error when git cannot read the folder", () => {
    expect(gitCheck({ ...GIT, error: "fatal: bad object" }).level).toBe("ERROR");
  });

  it("asks for attention when not a repository, behind or detached", () => {
    expect(gitCheck({ ...GIT, isRepo: false }).level).toBe("ATTENTION");
    expect(gitCheck({ ...GIT, behind: 3 })).toMatchObject({
      level: "ATTENTION",
      params: { count: 3, upstream: "origin/main" },
    });
    expect(gitCheck({ ...GIT, branch: null }).level).toBe("ATTENTION");
  });

  it("describes a healthy branch", () => {
    expect(renderFinding(gitCheck(GIT))).toEqual({
      id: "git",
      level: "OK",
      reason: "On main, up to date with origin/main",
    });
    expect(gitCheck({ ...GIT, ahead: 2 }).level).toBe("OK");
    expect(gitCheck({ ...GIT, upstream: null }).level).toBe("OK");
  });
});

describe("test runner check", () => {
  it("reads the command out of allowed rules", () => {
    expect(ruleCommand("Bash(pnpm test:*)")).toBe("pnpm test");
    expect(ruleCommand("Bash(pytest)")).toBe("pytest");
    expect(ruleCommand("Bash(*)")).toBeNull();
    expect(ruleCommand("Read(src/**)")).toBeNull();
  });

  it("follows package scripts to the real binary", () => {
    const packageJson = { scripts: { test: "cross-env CI=1 vitest run", unit: "jest" } };
    expect(requiredPrograms("pnpm test", packageJson)).toEqual(["pnpm", "vitest"]);
    expect(requiredPrograms("npm run unit", packageJson)).toEqual(["npm", "jest"]);
    expect(requiredPrograms("npx vitest run", null)).toEqual(["vitest"]);
    expect(requiredPrograms("./node_modules/.bin/jest", null)).toEqual(["jest"]);
    expect(
      requiredPrograms("npm test", { scripts: { test: 'echo "Error: no test specified"' } }),
    ).toBeNull();
  });

  it("prefers allowed rules, then stack commands, then the detected runner", () => {
    expect(
      resolveTestCommand({
        allowedRules: ["Bash(git status)", "Bash(pytest:*)"],
        stackCommands: ["pnpm test"],
        runner: null,
        packageJson: null,
      })?.command,
    ).toBe("pytest");
    expect(
      resolveTestCommand({
        allowedRules: [],
        stackCommands: [],
        runner: "VITEST",
        packageJson: null,
      }),
    ).toEqual({ command: "vitest run", programs: ["vitest"] });
    expect(
      resolveTestCommand({
        allowedRules: [],
        stackCommands: ["pnpm lint"],
        runner: null,
        packageJson: null,
      }),
    ).toBeNull();
  });

  it("maps facts to levels", () => {
    expect(testsCheck({ command: null, missing: [] }).level).toBe("OK");
    expect(testsCheck({ command: "pnpm test", missing: [] }).level).toBe("OK");
    expect(testsCheck({ command: "pnpm test", missing: ["vitest"] })).toMatchObject({
      level: "ATTENTION",
      params: { command: "pnpm test", missing: "vitest" },
    });
  });

  it("finds the runner in node_modules/.bin without running it", async () => {
    write("package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
    write("package-lock.json", "{}");
    executable(join(bin, "npm"));
    const missing = await inspectTestRunner(root, [], bin);
    expect(missing.command).toMatch(/^npm (run )?test$/);
    expect(missing.missing).toEqual(["vitest"]);
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    executable(join(root, "node_modules", ".bin", "vitest"));
    expect((await inspectTestRunner(root, [], bin)).missing).toEqual([]);
  });

  it("finds a Python runner on the search path", async () => {
    write("pyproject.toml", "[project]\nname='demo'\n");
    expect((await inspectTestRunner(root, ["Bash(pytest:*)"], bin)).missing).toEqual(["pytest"]);
    executable(join(bin, "pytest"));
    expect(await inspectTestRunner(root, ["Bash(pytest:*)"], bin)).toEqual({
      command: "pytest",
      missing: [],
    });
  });

  it("reports nothing to check in an empty folder", async () => {
    expect(await inspectTestRunner(root, [], bin)).toEqual({ command: null, missing: [] });
  });
});

describe("disk check", () => {
  const disk = (freeGiB: number, totalGiB: number) => ({
    path: "/data",
    freeBytes: freeGiB * GIB,
    totalBytes: totalGiB * GIB,
    error: null,
  });

  it("maps free space to levels and reports the worst folder", () => {
    expect(diskCheck([disk(200, 500)]).level).toBe("OK");
    expect(diskCheck([disk(4, 50)]).level).toBe("ATTENTION");
    expect(diskCheck([disk(40, 1000)]).level).toBe("ATTENTION");
    expect(diskCheck([disk(0.5, 500)]).level).toBe("ERROR");
    expect(diskCheck([disk(20, 1000)]).level).toBe("ERROR");
    const mixed = diskCheck([disk(200, 500), { ...disk(3, 50), path: "/projects" }]);
    expect(mixed).toMatchObject({
      level: "ATTENTION",
      params: { path: "/projects", free: "3.0 GB" },
    });
  });

  it("asks for attention when the space cannot be read", () => {
    expect(
      diskCheck([{ path: "/gone", freeBytes: null, totalBytes: null, error: "ENOENT" }]),
    ).toMatchObject({ level: "ATTENTION", params: { path: "/gone" } });
  });

  it("reads real folders with statfs", async () => {
    const real = await folderSpace(root, (path) =>
      import("node:fs/promises").then((fs) => fs.statfs(path)),
    );
    expect(real.error).toBeNull();
    expect(real.freeBytes).toBeGreaterThan(0);
    const missing = await folderSpace(join(root, "missing"), (path) =>
      import("node:fs/promises").then((fs) => fs.statfs(path)),
    );
    expect(missing).toMatchObject({ freeBytes: null, error: "ENOENT" });
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * GIB)).toBe("25 GB");
  });
});

describe("credentials check", () => {
  it("maps the accounts to levels", () => {
    expect(credentialsCheck({ claude: true, githubRemote: false, githubToken: false }).level).toBe(
      "OK",
    );
    expect(credentialsCheck({ claude: true, githubRemote: true, githubToken: true }).level).toBe(
      "OK",
    );
    expect(credentialsCheck({ claude: true, githubRemote: true, githubToken: false }).level).toBe(
      "ATTENTION",
    );
    expect(credentialsCheck({ claude: false, githubRemote: false, githubToken: true }).level).toBe(
      "ATTENTION",
    );
    expect(
      credentialsCheck({ claude: false, githubRemote: true, githubToken: false }).message,
    ).toBe("No Claude account and no GitHub token: add them in Settings");
  });
});

describe("overall level", () => {
  it("takes the worst check", () => {
    expect(worstLevel([])).toBe("OK");
    expect(worstLevel(["OK", "ATTENTION"])).toBe("ATTENTION");
    expect(worstLevel(["ATTENTION", "ERROR", "OK"])).toBe("ERROR");
  });

  it("feeds the mission control reasons with the failing checks only", () => {
    const result = projectHealth({
      indexError: null,
      git: GIT,
      lastRun: null,
      lastTdd: null,
      pendingApprovals: 0,
      checks: [
        gitCheck(GIT),
        testsCheck({ command: "pnpm test", missing: ["vitest"] }),
        diskCheck([{ path: "/d", freeBytes: GIB / 2, totalBytes: 100 * GIB, error: null }]),
      ],
    });
    expect(result.health).toBe("ERROR");
    expect(result.reasons).toEqual([
      "Almost no space left: 512 MB free (1%) in /d",
      "pnpm test cannot run: vitest not found. Install the project dependencies",
    ]);
  });
});

describe("health service", () => {
  function project(overrides: Partial<HealthProject> = {}): HealthProject {
    return {
      id: "p1",
      rootPath: root,
      gitRemote: null,
      indexedAt: new Date(NOW.getTime() - 2 * DAY),
      indexError: null,
      allowedTools: [],
      ...overrides,
    };
  }

  function service(options: { space?: FolderSpace; claude?: boolean; token?: boolean } = {}) {
    const calls = { statfs: 0, claude: 0 };
    const health = new HealthService({
      prisma: {} as PrismaClient,
      isIndexing: () => false,
      gitSummary: async () => GIT,
      claudeConnected: async () => {
        calls.claude += 1;
        return options.claude ?? true;
      },
      githubToken: async () => options.token ?? false,
      folders: [root, root],
      statfs: async () => {
        calls.statfs += 1;
        return options.space ?? { bavail: 800, blocks: 1000, bsize: GIB };
      },
      searchPath: () => bin,
      now: () => NOW,
      ttlMs: 30_000,
    });
    return { health, calls };
  }

  it("runs every check and caches the facts for a short time", async () => {
    const { health, calls } = service();
    const first = await health.findings(project(), GIT, NOW);
    expect(first.map((finding) => [finding.id, finding.level])).toEqual([
      ["index", "OK"],
      ["git", "OK"],
      ["tests", "OK"],
      ["disk", "OK"],
      ["credentials", "OK"],
    ]);
    await health.findings(project(), GIT, new Date(NOW.getTime() + 10_000));
    expect(calls).toEqual({ statfs: 1, claude: 1 });
    await health.findings(project(), GIT, new Date(NOW.getTime() + 31_000));
    expect(calls).toEqual({ statfs: 2, claude: 2 });
  });

  it("detects a GitHub remote from the git config and wants a token", async () => {
    write(".git/config", '[remote "origin"]\n\turl = git@github.com:acme/app.git\n');
    const { health } = service({ token: false });
    const findings = await health.findings(project(), GIT, NOW);
    expect(findings.find((finding) => finding.id === "credentials")?.level).toBe("ATTENTION");
  });

  it("reports low disk and missing accounts", async () => {
    const { health } = service({ space: { bavail: 1, blocks: 100, bsize: GIB }, claude: false });
    const findings = await health.findings(project({ indexError: "boom" }), GIT, NOW);
    expect(Object.fromEntries(findings.map((finding) => [finding.id, finding.level]))).toEqual({
      index: "ERROR",
      git: "OK",
      tests: "OK",
      disk: "ERROR",
      credentials: "ATTENTION",
    });
  });

  it("translates after the cache, so each request gets its own language", async () => {
    const { health } = service();
    const findings = await health.findings(project(), GIT, NOW);
    const english = findings.map(renderFinding);
    const italian = runWithLocale("it", () => findings.map(renderFinding));
    expect(english.find((check) => check.id === "credentials")?.reason).toBe(
      "Claude account connected",
    );
    expect(italian.find((check) => check.id === "credentials")?.reason).toBe(
      "Account Claude connesso",
    );
    expect(italian.find((check) => check.id === "disk")?.reason).toBe("800 GB liberi (80%)");
  });
});
