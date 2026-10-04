import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type GitChange,
  type GitChangeKind,
  type GitIdentityDto,
  type GitStatusDto,
  type GitSummary,
  type PublishChangesRequestSchema,
  type PublishResultDto,
  type UpdateGitIdentityRequestSchema,
} from "@onyx/contracts";
import type { PrismaClient, Project } from "@onyx/db";
import type { Logger } from "pino";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { credentialEnv as gitCredentialEnv, redact } from "../infrastructure/git-clone";
import type { GitHubService } from "./github-service";
import {
  gitEnvironment,
  lockGitMetadata,
  safeGitArgs,
  sharesWorkTrees,
  withSharedUmask,
  writesWorkTree,
} from "../infrastructure/git-env";

type PublishInput = z.output<typeof PublishChangesRequestSchema>;
type IdentityInput = z.output<typeof UpdateGitIdentityRequestSchema>;

export interface GitServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  github: Pick<GitHubService, "token" | "viewerIdentity">;
  isWorkspaceBusy: (workspaceId: string) => boolean;
  gitBin?: string;
  sourceEnv?: NodeJS.ProcessEnv;
}

interface GitIdentity {
  name: string;
  email: string;
}

const execFileAsync = promisify(execFile);
const IDENTITY_KEY = "git.identity";
const MAX_CHANGES = 200;
const GIT_TIMEOUT_MS = 120_000;
const SUMMARY_TIMEOUT_MS = 10_000;
const FALLBACK_IDENTITY: GitIdentity = { name: "Onyx", email: "onyx@localhost" };

const StoredIdentitySchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

export function parseBranchLine(line: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  const body = line.replace(/^##\s*/, "");
  if (body.startsWith("HEAD (no branch)"))
    return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const noCommits = /^No commits yet on (\S+)/.exec(body);
  if (noCommits) return { branch: noCommits[1] ?? null, upstream: null, ahead: 0, behind: 0 };
  const [head = "", tracking = ""] = body.split(" [");
  const [branch, upstream] = head.trim().split("...");
  return {
    branch: branch && branch.length > 0 ? branch : null,
    upstream: upstream && upstream.length > 0 ? upstream : null,
    ahead: Number(/ahead (\d+)/.exec(tracking)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(tracking)?.[1] ?? 0),
  };
}

function changeKind(code: string): GitChangeKind {
  if (code === "??") return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("M") || code.includes("T")) return "modified";
  return "other";
}

export function parsePorcelain(output: string): {
  branchLine: string | null;
  changes: GitChange[];
} {
  let branchLine: string | null = null;
  const changes: GitChange[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("## ")) {
      branchLine = line;
      continue;
    }
    const code = line.slice(0, 2);
    const rest = line.slice(3);
    const path = code.includes("R") ? (rest.split(" -> ").at(-1) ?? rest) : rest;
    changes.push({ path: path.replace(/^"|"$/g, ""), kind: changeKind(code) });
  }
  return { branchLine, changes };
}

export function githubRepoOf(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function sanitizeRemote(remoteUrl: string): string {
  return remoteUrl.replace(/^(https?:\/\/)[^@/]+@/i, "$1");
}

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function suggestBranch(titles: readonly string[], now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const topic = titles.length > 0 ? slug(titles[0] ?? "") : "";
  return `onyx/${date}-${topic.length > 0 ? topic : "changes"}`;
}

export function suggestMessage(titles: readonly string[]): string {
  if (titles.length === 0) return "Onyx: update";
  if (titles.length === 1) return `Onyx: ${titles[0]}`;
  return [`Onyx: ${titles.length} tasks`, "", ...titles.map((title) => `- ${title}`)].join("\n");
}

export class GitService {
  constructor(private readonly deps: GitServiceDeps) {}

  async identity(): Promise<GitIdentityDto> {
    const stored = await this.storedIdentity();
    const effective = await this.effectiveIdentity(stored);
    return {
      name: stored.name,
      email: stored.email,
      effectiveName: effective.name,
      effectiveEmail: effective.email,
    };
  }

  async updateIdentity(input: IdentityInput, actor: string): Promise<GitIdentityDto> {
    const value = { name: input.name, email: input.email };
    await this.deps.prisma.appSetting.upsert({
      where: { key: IDENTITY_KEY },
      create: { key: IDENTITY_KEY, value },
      update: { value },
    });
    await this.audit(actor, "git.identity", null, {});
    return this.identity();
  }

  async summary(rootPath: string, now = new Date()): Promise<GitSummary> {
    const checkedAt = now.toISOString();
    try {
      const output = await this.git(
        rootPath,
        ["status", "--porcelain=v1", "-b", "--untracked-files=normal"],
        { env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: SUMMARY_TIMEOUT_MS },
      );
      const parsed = parsePorcelain(output);
      const branch = parsed.branchLine
        ? parseBranchLine(parsed.branchLine)
        : { branch: null, upstream: null, ahead: 0, behind: 0 };
      return {
        isRepo: true,
        ...branch,
        changeCount: parsed.changes.length,
        checkedAt,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notRepo = /not a git repository/i.test(message);
      return {
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        changeCount: 0,
        checkedAt,
        error: notRepo ? null : message.slice(0, 200),
      };
    }
  }

  async status(projectId: string): Promise<GitStatusDto> {
    const project = await this.project(projectId);
    return this.statusOf(project);
  }

  async publish(projectId: string, input: PublishInput, actor: string): Promise<PublishResultDto> {
    const project = await this.project(projectId);
    const before = await this.statusOf(project);
    if (!before.isRepo) throw badRequest("The project folder is not a git repository");
    if (before.busy) throw conflict("An agent is working on this project: wait until it finishes");
    if (input.branch === project.defaultBranch || input.branch === before.defaultBranch)
      throw badRequest(`Choose a branch other than ${project.defaultBranch}`);
    await this.git(project.rootPath, ["check-ref-format", "--branch", input.branch]).catch(() => {
      throw badRequest(`${input.branch} is not a valid branch name`);
    });
    const switching = before.branch !== input.branch;
    if (before.changeCount === 0 && !switching && before.ahead === 0 && before.upstream !== null)
      throw badRequest("Nothing to publish: no changes and no unpushed commits");
    if (before.changeCount === 0 && switching && before.onDefaultBranch)
      throw badRequest("Nothing to publish: the agents have not changed any file yet");

    if (switching) {
      const exists = await this.git(project.rootPath, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${input.branch}`,
      ]).then(
        () => true,
        () => false,
      );
      await this.git(
        project.rootPath,
        exists ? ["switch", input.branch] : ["switch", "-c", input.branch],
      );
    }

    let commit: string | null = null;
    if (before.changeCount > 0) {
      const identity = await this.effectiveIdentity(await this.storedIdentity());
      await this.git(project.rootPath, ["add", "-A"]);
      await this.git(project.rootPath, ["commit", "-q", "-F", "-"], {
        input: input.message,
        env: {
          GIT_AUTHOR_NAME: identity.name,
          GIT_AUTHOR_EMAIL: identity.email,
          GIT_COMMITTER_NAME: identity.name,
          GIT_COMMITTER_EMAIL: identity.email,
        },
      });
      commit = (await this.git(project.rootPath, ["rev-parse", "HEAD"])).trim();
    }

    const token = await this.deps.github.token();
    let pushError: string | null = null;
    try {
      await this.git(project.rootPath, ["push", "-u", "origin", input.branch], {
        env: this.pushEnv(before.remoteUrl, token),
        secrets: token ? [token] : [],
      });
    } catch (error) {
      pushError = this.explainPushFailure(error instanceof Error ? error.message : String(error));
    }

    const published = await this.deps.prisma.task.updateMany({
      where: { projectId: project.id, status: "COMPLETED", branchName: null },
      data: { branchName: input.branch },
    });
    await this.audit(actor, "git.publish", project.id, {
      branch: input.branch,
      commit: commit ?? "",
      pushed: pushError === null,
    });
    const status = await this.statusOf(project);
    return {
      branch: input.branch,
      commit,
      pushed: pushError === null,
      pushError,
      compareUrl: status.compareUrl,
      publishedTasks: published.count,
      status,
    };
  }

  async pushBranch(
    projectId: string,
    branch: string,
    actor: string,
  ): Promise<{ pushed: boolean; pushError: string | null; compareUrl: string | null }> {
    const project = await this.project(projectId);
    const remote = await this.git(project.rootPath, ["remote", "get-url", "origin"]).catch(
      () => "",
    );
    if (remote.trim().length === 0) throw badRequest("The project has no origin remote to push to");
    const remoteUrl = sanitizeRemote(remote.trim());
    const token = await this.deps.github.token();
    let pushError: string | null = null;
    try {
      await this.git(project.rootPath, ["push", "-u", "origin", `${branch}:${branch}`], {
        env: this.pushEnv(remoteUrl, token),
        secrets: token ? [token] : [],
      });
    } catch (error) {
      pushError = this.explainPushFailure(error instanceof Error ? error.message : String(error));
    }
    await this.audit(actor, "git.push-branch", project.id, { branch, pushed: pushError === null });
    const githubRepo = githubRepoOf(remoteUrl);
    return {
      pushed: pushError === null,
      pushError,
      compareUrl: githubRepo
        ? `https://github.com/${githubRepo}/compare/${encodeURIComponent(project.defaultBranch)}...${encodeURIComponent(branch)}?expand=1`
        : null,
    };
  }

  async switchToDefault(projectId: string, actor: string): Promise<GitStatusDto> {
    const project = await this.project(projectId);
    const before = await this.statusOf(project);
    if (!before.isRepo) throw badRequest("The project folder is not a git repository");
    if (before.busy) throw conflict("An agent is working on this project: wait until it finishes");
    if (before.changeCount > 0)
      throw conflict("Publish or discard the current changes before switching branch");
    await this.git(project.rootPath, ["switch", project.defaultBranch]);
    const token = await this.deps.github.token();
    if (before.remoteUrl) {
      await this.git(project.rootPath, ["pull", "--ff-only", "origin", project.defaultBranch], {
        env: this.pushEnv(before.remoteUrl, token),
        secrets: token ? [token] : [],
      }).catch((error: unknown) =>
        this.deps.logger.warn({ err: error, projectId }, "Pull after switching branch failed"),
      );
    }
    await this.audit(actor, "git.switch", project.id, { branch: project.defaultBranch });
    return this.statusOf(project);
  }

  private async statusOf(project: Project): Promise<GitStatusDto> {
    const root = project.rootPath;
    const busy = await this.isBusy(project.id);
    const unpublished = await this.deps.prisma.task.findMany({
      where: { projectId: project.id, status: "COMPLETED", branchName: null },
      orderBy: { completedAt: "asc" },
      select: { id: true, title: true },
      take: 20,
    });
    const titles = unpublished.map((task) => task.title);
    const base = {
      defaultBranch: project.defaultBranch,
      busy,
      unpublishedTasks: unpublished,
      suggestedBranch: suggestBranch(titles),
      suggestedMessage: suggestMessage(titles),
    };
    const isRepo = await this.git(root, ["rev-parse", "--is-inside-work-tree"]).then(
      (output) => output.trim() === "true",
      () => false,
    );
    if (!isRepo) {
      return {
        ...base,
        isRepo: false,
        branch: null,
        onDefaultBranch: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        changes: [],
        changeCount: 0,
        lastCommit: null,
        remoteUrl: null,
        githubRepo: null,
        compareUrl: null,
      };
    }
    const [porcelain, lastCommit, remote] = await Promise.all([
      this.git(root, ["status", "--porcelain=v1", "-b", "--untracked-files=all"]),
      this.git(root, ["log", "-1", "--format=%H%x1f%s%x1f%cI"]).catch(() => ""),
      this.git(root, ["remote", "get-url", "origin"]).catch(() => ""),
    ]);
    const parsed = parsePorcelain(porcelain);
    const branchInfo = parsed.branchLine
      ? parseBranchLine(parsed.branchLine)
      : { branch: null, upstream: null, ahead: 0, behind: 0 };
    const [sha, subject, date] = lastCommit.trim().split("\u001f");
    const remoteUrl = remote.trim().length > 0 ? sanitizeRemote(remote.trim()) : null;
    const githubRepo = githubRepoOf(remoteUrl);
    const onDefaultBranch = branchInfo.branch === project.defaultBranch;
    return {
      ...base,
      isRepo: true,
      branch: branchInfo.branch,
      onDefaultBranch,
      upstream: branchInfo.upstream,
      ahead: branchInfo.ahead,
      behind: branchInfo.behind,
      changes: parsed.changes.slice(0, MAX_CHANGES),
      changeCount: parsed.changes.length,
      lastCommit: sha && subject !== undefined && date ? { sha, subject, date } : null,
      remoteUrl,
      githubRepo,
      compareUrl:
        githubRepo && branchInfo.branch && !onDefaultBranch
          ? `https://github.com/${githubRepo}/compare/${encodeURIComponent(project.defaultBranch)}...${encodeURIComponent(branchInfo.branch)}?expand=1`
          : null,
    };
  }

  private pushEnv(remoteUrl: string | null, token: string | null): Record<string, string> {
    if (!remoteUrl || !token) return gitCredentialEnv(null, null);
    try {
      const url = new URL(remoteUrl);
      if (url.protocol === "https:" && url.hostname.toLowerCase() === "github.com")
        return gitCredentialEnv(token, url.origin);
    } catch {
      return gitCredentialEnv(null, null);
    }
    return gitCredentialEnv(null, null);
  }

  private explainPushFailure(message: string): string {
    if (/403|denied|not allowed|write access/i.test(message))
      return `GitHub refused the push: the token needs Contents read and write on this repository (${message})`;
    if (/could not read Username|Authentication failed|401/i.test(message))
      return `GitHub asked for credentials: connect a GitHub token in Settings (${message})`;
    return message;
  }

  private async git(
    cwd: string,
    args: readonly string[],
    options: {
      env?: Record<string, string>;
      input?: string;
      secrets?: readonly string[];
      timeoutMs?: number;
    } = {},
  ): Promise<string> {
    const env = gitEnvironment(this.deps.sourceEnv ?? process.env, {
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      LC_ALL: "C",
      ...options.env,
    });
    const shared = writesWorkTree(args);
    try {
      const child = withSharedUmask(() =>
        execFileAsync(this.deps.gitBin ?? "git", safeGitArgs(args), {
          cwd,
          env,
          timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        }),
      );
      if (options.input !== undefined) {
        child.child.stdin?.end(options.input);
      }
      const { stdout } = await child;
      if (shared) await this.lockMetadata(cwd);
      return stdout;
    } catch (error) {
      if (shared) await this.lockMetadata(cwd);
      const record = error as { stderr?: unknown; message?: unknown };
      const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
      const message = stderr.length > 0 ? stderr : String(record.message ?? error);
      throw new GitCommandError(
        args,
        redact(message.split("\n").slice(-3).join(" "), options.secrets ?? []),
      );
    }
  }

  private async lockMetadata(cwd: string): Promise<void> {
    if (!sharesWorkTrees()) return;
    const output = await this.git(cwd, ["rev-parse", "--absolute-git-dir"]).catch(() => "");
    const gitDir = output.trim();
    if (gitDir) await lockGitMetadata([gitDir]);
  }

  private async isBusy(projectId: string): Promise<boolean> {
    const workspaces = await this.deps.prisma.workspace.findMany({
      where: { projectId },
      select: { id: true },
    });
    return workspaces.some((workspace) => this.deps.isWorkspaceBusy(workspace.id));
  }

  private async project(projectId: string): Promise<Project> {
    const project = await this.deps.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    return project;
  }

  async commitEnv(): Promise<Record<string, string>> {
    const identity = await this.effectiveIdentity(await this.storedIdentity());
    return {
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    };
  }

  private async storedIdentity(): Promise<{ name: string | null; email: string | null }> {
    const row = await this.deps.prisma.appSetting.findUnique({ where: { key: IDENTITY_KEY } });
    const parsed = StoredIdentitySchema.safeParse(row?.value);
    return parsed.success ? parsed.data : { name: null, email: null };
  }

  private async effectiveIdentity(stored: {
    name: string | null;
    email: string | null;
  }): Promise<GitIdentity> {
    if (stored.name && stored.email) return { name: stored.name, email: stored.email };
    const viewer = await this.deps.github.viewerIdentity();
    const name = stored.name ?? viewer?.name ?? viewer?.login ?? FALLBACK_IDENTITY.name;
    const email =
      stored.email ??
      (viewer
        ? `${viewer.id !== undefined ? `${viewer.id}+` : ""}${viewer.login}@users.noreply.github.com`
        : FALLBACK_IDENTITY.email);
    return { name, email };
  }

  private async audit(
    actor: string,
    action: string,
    target: string | null,
    meta: Record<string, string | boolean>,
  ): Promise<void> {
    await this.deps.prisma.auditLog
      .create({ data: { actor, action, target, meta } })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Audit write failed"));
  }
}
