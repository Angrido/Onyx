import { describe, expect, it } from "vitest";
import {
  githubRepoOf,
  parseBranchLine,
  parsePorcelain,
  sanitizeRemote,
  suggestBranch,
  suggestMessage,
} from "../../src/application/git-service";
import { buildRunSettings } from "../../src/domain/permission-rules";
import { gitEnvironment, safeGitArgs } from "../../src/infrastructure/git-env";

describe("git status parsing", () => {
  it("reads branch, upstream and divergence", () => {
    expect(parseBranchLine("## main...origin/main [ahead 2, behind 1]")).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(parseBranchLine("## onyx/20261005-fix.login")).toEqual({
      branch: "onyx/20261005-fix.login",
      upstream: null,
      ahead: 0,
      behind: 0,
    });
    expect(parseBranchLine("## No commits yet on main").branch).toBe("main");
    expect(parseBranchLine("## HEAD (no branch)").branch).toBeNull();
  });

  it("classifies changed files", () => {
    const parsed = parsePorcelain(
      [
        "## main...origin/main",
        " M apps/web/src/button.tsx",
        "?? apps/web/src/new.tsx",
        "D  old.ts",
        "R  a.ts -> b.ts",
        "A  added.ts",
        "",
      ].join("\n"),
    );
    expect(parsed.branchLine).toBe("## main...origin/main");
    expect(parsed.changes).toEqual([
      { path: "apps/web/src/button.tsx", kind: "modified" },
      { path: "apps/web/src/new.tsx", kind: "untracked" },
      { path: "old.ts", kind: "deleted" },
      { path: "b.ts", kind: "renamed" },
      { path: "added.ts", kind: "added" },
    ]);
  });

  it("recognises GitHub remotes and strips credentials", () => {
    expect(githubRepoOf("https://github.com/Angrido/Onyx.git")).toBe("Angrido/Onyx");
    expect(githubRepoOf("git@github.com:octo/shop.git")).toBe("octo/shop");
    expect(githubRepoOf("file:///tmp/shop.git")).toBeNull();
    expect(sanitizeRemote("https://x-access-token:abc@github.com/octo/shop.git")).toBe(
      "https://github.com/octo/shop.git",
    );
  });

  it("suggests a branch and a commit message from finished tasks", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    expect(suggestBranch(["Rifinire gli stili dell'interfaccia!"], now)).toBe(
      "onyx/20261005-rifinire-gli-stili-dell-interfaccia",
    );
    expect(suggestBranch([], now)).toBe("onyx/20261005-changes");
    expect(suggestMessage(["Fix login"])).toBe("Onyx: Fix login");
    expect(suggestMessage(["A", "B"])).toBe("Onyx: 2 tasks\n\n- A\n- B");
  });
});

describe("git environment", () => {
  it("passes git only what it needs, never Onyx's secrets", () => {
    const env = gitEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/home/onyx",
        GIT_AUTHOR_NAME: "Onyx",
        ONYX_GITHUB_TOKEN: "ghp_secret",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-secret",
        ANTHROPIC_API_KEY: "sk-ant-api-secret",
        ONYX_SECRET_KEY: "key",
        DATABASE_URL: "file:/var/lib/onyx/onyx.db",
      },
      { GIT_TERMINAL_PROMPT: "0" },
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/onyx",
      GIT_AUTHOR_NAME: "Onyx",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("switches off repository hooks and the fsmonitor command", () => {
    expect(safeGitArgs(["status"])).toEqual([
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "status",
    ]);
  });
});

describe("run settings", () => {
  it("deny git metadata edits and Onyx's own files", () => {
    const deny = buildRunSettings({ protectedPaths: ["/var/lib/onyx/secret.key"] }).permissions
      .deny;
    expect(deny).toContain("Edit(**/.git/**)");
    expect(deny).toContain("Read(//var/lib/onyx/secret.key)");
    expect(deny).toContain("Read(//var/lib/onyx/secret.key/**)");
    expect(deny).toContain("Edit(//var/lib/onyx/secret.key)");
  });
});
