import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { gitEnvironment, safeGitArgs } from "./git-env";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

const DEPENDENCY_DIRS = new Set(["node_modules"]);
const SKIP_DIRS = new Set([".git", ".onyx", "dist", "build", ".next", "coverage"]);
const MAX_LINK_DEPTH = 3;

export async function linkDependencies(sourceRoot: string, worktree: string): Promise<string[]> {
  const linked: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolute = join(directory, entry.name);
      const relPath = relative(sourceRoot, absolute);
      if (DEPENDENCY_DIRS.has(entry.name)) {
        const target = join(worktree, relPath);
        const parent = await lstat(dirname(target)).catch(() => null);
        const existing = await lstat(target).catch(() => null);
        if (parent?.isDirectory() && !existing) {
          await symlink(absolute, target, "dir");
          linked.push(relPath.split("\\").join("/"));
        }
        continue;
      }
      if (SKIP_DIRS.has(entry.name) || depth >= MAX_LINK_DEPTH) continue;
      await visit(absolute, depth + 1);
    }
  };
  await visit(sourceRoot, 0);
  return linked;
}

export type MergeOutcome =
  { ok: true; commit: string; changed: boolean } | { ok: false; conflicts: string[] };

export class GitRepo {
  constructor(
    readonly root: string,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(
    args: readonly string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", safeGitArgs(args), {
        cwd: options.cwd ?? this.root,
        env: gitEnvironment(this.baseEnv, { GIT_TERMINAL_PROMPT: "0", ...options.env }),
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
      return stdout;
    } catch (error) {
      const record = error as { stderr?: string; message?: string };
      const detail = (record.stderr ?? record.message ?? String(error)).trim().split("\n").at(-1);
      throw new GitError(args, `git ${args[0] ?? ""} failed: ${detail ?? "unknown error"}`);
    }
  }

  async isRepo(): Promise<boolean> {
    try {
      return (await this.run(["rev-parse", "--is-inside-work-tree"])).trim() === "true";
    } catch {
      return false;
    }
  }

  async head(cwd = this.root): Promise<{ branch: string | null; commit: string }> {
    const commit = (await this.run(["rev-parse", "HEAD"], { cwd })).trim();
    const branch = (await this.run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })).trim();
    return { branch: branch === "HEAD" ? null : branch, commit };
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(name: string, from: string): Promise<void> {
    await this.run(["branch", name, from]);
  }

  async addWorktree(path: string, branch: string, from: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await this.run(["worktree", "prune"]);
    if (await this.branchExists(branch)) await this.run(["worktree", "add", path, branch]);
    else await this.run(["worktree", "add", "-b", branch, path, from]);
  }

  async addDetachedWorktree(path: string, commit: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await this.run(["worktree", "prune"]);
    await this.run(["worktree", "add", "--detach", path, commit]);
  }

  async removeWorktree(path: string): Promise<void> {
    await this.run(["worktree", "remove", "--force", path]).catch(() => undefined);
    await rm(path, { recursive: true, force: true });
    await this.run(["worktree", "prune"]).catch(() => undefined);
  }

  async commitAll(
    cwd: string,
    message: string,
    env: Record<string, string>,
    excludes: readonly string[] = [],
  ): Promise<string | null> {
    const tracked: string[] = [];
    for (const path of excludes) {
      const ignored = await this.run(["check-ignore", "-q", "--", path], { cwd }).then(
        () => true,
        () => false,
      );
      if (!ignored) tracked.push(path);
    }
    await this.run(["add", "-A", "--", ".", ...tracked.map((path) => `:(exclude)${path}`)], {
      cwd,
    });
    const staged = (await this.run(["diff", "--cached", "--name-only"], { cwd })).trim();
    if (staged.length === 0) return null;
    await this.run(["commit", "-q", "--no-verify", "-m", message], { cwd, env });
    return (await this.run(["rev-parse", "HEAD"], { cwd })).trim();
  }

  async merge(
    cwd: string,
    branch: string,
    message: string,
    env: Record<string, string>,
  ): Promise<MergeOutcome> {
    const before = (await this.run(["rev-parse", "HEAD"], { cwd })).trim();
    try {
      await this.run(["merge", "--no-ff", "--no-edit", "-m", message, branch], { cwd, env });
    } catch (error) {
      const conflicts = (await this.run(["diff", "--name-only", "--diff-filter=U"], { cwd }))
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await this.run(["merge", "--abort"], { cwd }).catch(() => undefined);
      if (conflicts.length === 0) throw error;
      return { ok: false, conflicts };
    }
    const commit = (await this.run(["rev-parse", "HEAD"], { cwd })).trim();
    return { ok: true, commit, changed: commit !== before };
  }

  async changedFiles(from: string, to: string): Promise<string[]> {
    return (await this.run(["diff", "--name-only", `${from}..${to}`]))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
