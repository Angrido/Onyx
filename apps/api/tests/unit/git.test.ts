import { describe, expect, it } from "vitest";
import {
  githubRepoOf,
  parseBranchLine,
  parsePorcelain,
  sanitizeRemote,
  suggestBranch,
  suggestMessage,
} from "../../src/application/git-service";

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
