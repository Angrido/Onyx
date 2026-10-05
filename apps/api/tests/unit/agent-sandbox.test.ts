import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { groupIdOf, sandboxDirectories, sharedMode } from "../../src/infrastructure/agent-sandbox";
import {
  gitSubcommand,
  safeGitArgs,
  shareWorkTrees,
  withSharedUmask,
  writesWorkTree,
} from "../../src/infrastructure/git-env";

afterEach(() => {
  shareWorkTrees(null);
});

describe("files shared with the agents", () => {
  it("gives the group write access to the work tree but only read access to git metadata", () => {
    expect(sharedMode(0o100644, false, false)).toBe(0o664);
    expect(sharedMode(0o100755, false, false)).toBe(0o775);
    expect(sharedMode(0o040755, true, false)).toBe(0o2775);
    expect(sharedMode(0o100664, false, true)).toBe(0o644);
    expect(sharedMode(0o040775, true, true)).toBe(0o2755);
    expect(sharedMode(0o100600, false, false) & 0o007).toBe(0);
  });

  it("finds groups by name", () => {
    const file = join(mkdtempSync(join(tmpdir(), "onyx-group-")), "group");
    writeFileSync(file, "root:x:0:\nonyx-work:x:30002:onyx\n");
    expect(groupIdOf("onyx-work", file)).toBe(30002);
    expect(groupIdOf("missing", file)).toBeNull();
  });

  it("lets the agents traverse the data folder without listing it", () => {
    const modes = sandboxDirectories({
      dataDir: "/var/lib/onyx",
      runtimeDir: "/var/lib/onyx/runtime",
      worktreesDir: "/var/lib/onyx/worktrees",
      projectsDir: "/srv/onyx/projects",
    }).map((entry) => [entry.path, entry.mode.toString(8)]);
    expect(modes).toEqual([
      ["/var/lib/onyx", "710"],
      ["/var/lib/onyx/runtime", "2750"],
      ["/var/lib/onyx/runtime/tdd", "2750"],
      ["/var/lib/onyx/worktrees", "2770"],
      ["/srv/onyx/projects", "2770"],
    ]);
  });
});

describe("git commands next to the agents", () => {
  it("knows which commands write the work tree", () => {
    expect(gitSubcommand(["-c", "x=y", "-C", "sub", "merge", "--no-ff"])).toBe("merge");
    expect(writesWorkTree(["reset", "--hard"])).toBe(true);
    expect(writesWorkTree(["switch", "-c", "x"])).toBe(true);
    expect(writesWorkTree(["commit", "-m", "x"])).toBe(false);
    expect(writesWorkTree(["worktree", "add", "x"])).toBe(false);
    expect(writesWorkTree(["config", "user.name", "x"])).toBe(false);
  });

  it("ignores safe.directory from the user's git config and shares files only while asked", () => {
    expect(safeGitArgs(["status"])).not.toContain("safe.directory=");
    shareWorkTrees(0o007);
    expect(safeGitArgs(["status"]).slice(-3)).toEqual(["-c", "safe.directory=", "status"]);
    const before = process.umask();
    expect(withSharedUmask(() => process.umask())).toBe(0o007);
    expect(process.umask()).toBe(before);
  });
});
