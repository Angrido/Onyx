import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ErrorCode,
  type CloneJobDto,
  type CloneJobState,
  type GitHubAccountDto,
  type GitHubRepoDto,
  type GitHubRepoListResponse,
  type GitHubTokenSource,
  type ImportRepoRequestSchema,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import type { AppConfig } from "../config";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { cloneRepository, redact } from "../infrastructure/git-clone";
import {
  GitHubError,
  type GitHubClient,
  type GitHubRepo,
  type GitHubUser,
  type RepoPage,
} from "../infrastructure/github-client";
import { isWithinRoot, type ProjectService } from "./project-service";

type ImportRepoInput = z.output<typeof ImportRepoRequestSchema>;

export interface GitHubServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  client: GitHubClient;
  projects: ProjectService;
  config: Pick<AppConfig, "projectsDir" | "allowedProjectRoots" | "github">;
  gitBin?: string;
  sourceEnv?: NodeJS.ProcessEnv;
}

interface ResolvedToken {
  token: string;
  source: GitHubTokenSource;
}

interface CloneJob {
  id: string;
  fullName: string;
  name: string;
  branch: string | null;
  targetPath: string;
  state: CloneJobState;
  phase: string | null;
  percent: number | null;
  projectId: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  done: Promise<void>;
}

const TOKEN_KEY = "github.token";
const TEMP_PREFIX = ".onyx-clone-";
const MAX_PAGES = 10;
const REPO_CACHE_MS = 60_000;
const ACCOUNT_CACHE_MS = 5 * 60_000;
const MAX_FINISHED_JOBS = 20;

export function remoteKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

export function projectNameFor(repoName: string): string {
  const cleaned = repoName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return (cleaned.length > 0 ? cleaned : "project").slice(0, 64);
}

function toAppError(error: unknown): unknown {
  if (!(error instanceof GitHubError)) return error;
  if (error.status === 502) return new AppError(502, ErrorCode.Unavailable, error.message);
  if (error.status === 404) return new AppError(404, ErrorCode.NotFound, error.message);
  return badRequest(error.message);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export class GitHubService {
  private account: { token: string; at: number; user: GitHubUser } | null = null;
  private readonly repoCache = new Map<
    string,
    { at: number; repos: GitHubRepo[]; truncated: boolean }
  >();
  private readonly jobs = new Map<string, CloneJob>();

  constructor(private readonly deps: GitHubServiceDeps) {}

  async cleanup(): Promise<void> {
    const entries = await readdir(this.deps.config.projectsDir).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(TEMP_PREFIX))
        .map((entry) =>
          rm(join(this.deps.config.projectsDir, entry), { recursive: true, force: true }),
        ),
    );
  }

  async accountInfo(): Promise<GitHubAccountDto> {
    const resolved = await this.resolveToken();
    if (!resolved) {
      return {
        connected: false,
        source: null,
        login: null,
        name: null,
        avatarUrl: null,
        error: null,
      };
    }
    try {
      const user = await this.viewer(resolved.token);
      return {
        connected: true,
        source: resolved.source,
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatar_url ?? null,
        error: null,
      };
    } catch (error) {
      return {
        connected: true,
        source: resolved.source,
        login: null,
        name: null,
        avatarUrl: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async connect(token: string, actor: string): Promise<GitHubAccountDto> {
    if (this.deps.config.github.token) {
      throw conflict("ONYX_GITHUB_TOKEN is set in the environment: remove it to save a token here");
    }
    let user: GitHubUser;
    try {
      user = await this.deps.client.viewer(token);
    } catch (error) {
      throw toAppError(error);
    }
    await this.deps.prisma.appSetting.upsert({
      where: { key: TOKEN_KEY },
      create: { key: TOKEN_KEY, value: token },
      update: { value: token },
    });
    this.account = { token, at: Date.now(), user };
    this.repoCache.clear();
    await this.audit(actor, "github.connected", user.login, {});
    return this.accountInfo();
  }

  async disconnect(actor: string): Promise<GitHubAccountDto> {
    if (this.deps.config.github.token) {
      throw conflict("The token comes from ONYX_GITHUB_TOKEN: remove it from the environment");
    }
    await this.deps.prisma.appSetting.deleteMany({ where: { key: TOKEN_KEY } });
    this.account = null;
    this.repoCache.clear();
    await this.audit(actor, "github.disconnected", null, {});
    return this.accountInfo();
  }

  async repos(owner: string | undefined, refresh: boolean): Promise<GitHubRepoListResponse> {
    const resolved = await this.resolveToken();
    if (!owner && !resolved) {
      throw badRequest(
        "Connect a GitHub token, or enter a GitHub user to browse its public repositories",
      );
    }
    const key = owner
      ? `owner:${owner.toLowerCase()}:${resolved ? "token" : "anonymous"}`
      : "viewer";
    const cached = this.repoCache.get(key);
    let listing = cached && !refresh && Date.now() - cached.at < REPO_CACHE_MS ? cached : null;
    if (!listing) {
      try {
        listing = await this.collect((page) =>
          owner
            ? this.deps.client.ownerRepos(owner, resolved?.token ?? null, page)
            : this.deps.client.viewerRepos(resolved?.token ?? "", page),
        );
      } catch (error) {
        throw toAppError(error);
      }
      this.repoCache.set(key, listing);
    }
    const imported = await this.importedProjects();
    return {
      owner: owner ?? null,
      truncated: listing.truncated,
      items: listing.repos.map((repo) => this.toRepoDto(repo, imported)),
    };
  }

  async startImport(input: ImportRepoInput, actor: string): Promise<CloneJobDto> {
    const resolved = await this.resolveToken();
    let repo: GitHubRepo;
    try {
      repo = await this.deps.client.repo(input.fullName, resolved?.token ?? null);
    } catch (error) {
      throw toAppError(error);
    }
    const name = input.name ?? projectNameFor(repo.name);
    const projectsDir = this.deps.config.projectsDir;
    const targetPath = join(projectsDir, name);
    const realProjectsDir = await realpath(projectsDir).catch(() => projectsDir);
    const roots = await Promise.all(
      this.deps.config.allowedProjectRoots.map((root) => realpath(root).catch(() => root)),
    );
    if (!roots.some((root) => isWithinRoot(join(realProjectsDir, name), root))) {
      throw badRequest(
        `Clones go to ${projectsDir}, which is outside ONYX_ALLOWED_PROJECT_ROOTS: add it there`,
      );
    }
    if (await this.deps.prisma.project.findFirst({ where: { name }, select: { id: true } })) {
      throw conflict(`A project named ${name} already exists: choose another name`);
    }
    if (await exists(targetPath)) {
      throw conflict(`${targetPath} already exists: choose another name`);
    }
    const busy = [...this.jobs.values()].find(
      (job) =>
        job.targetPath === targetPath && (job.state === "cloning" || job.state === "registering"),
    );
    if (busy) throw conflict(`${repo.full_name} is already being cloned`);

    const job: CloneJob = {
      id: randomUUID(),
      fullName: repo.full_name,
      name,
      branch: input.branch ?? null,
      targetPath,
      state: "cloning",
      phase: null,
      percent: null,
      projectId: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      done: Promise.resolve(),
    };
    this.jobs.set(job.id, job);
    this.pruneJobs();
    job.done = this.runImport(job, repo, resolved?.token ?? null, input);
    await this.audit(actor, "github.import", repo.full_name, { targetPath, jobId: job.id });
    return this.toJobDto(job);
  }

  jobList(): CloneJobDto[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .map((job) => this.toJobDto(job));
  }

  job(id: string): CloneJobDto {
    const job = this.jobs.get(id);
    if (!job) throw notFound("Import");
    return this.toJobDto(job);
  }

  async settled(id: string): Promise<void> {
    await this.jobs.get(id)?.done;
  }

  private async runImport(
    job: CloneJob,
    repo: GitHubRepo,
    token: string | null,
    input: ImportRepoInput,
  ): Promise<void> {
    const temp = join(this.deps.config.projectsDir, `${TEMP_PREFIX}${job.id}`);
    let moved = false;
    try {
      await mkdir(this.deps.config.projectsDir, { recursive: true });
      const cloneUrl = new URL(repo.clone_url);
      const sameHost = cloneUrl.host === new URL(repo.html_url).host;
      const useToken = token !== null && cloneUrl.protocol === "https:" && sameHost;
      await cloneRepository({
        url: repo.clone_url,
        destination: temp,
        branch: job.branch,
        token: useToken ? token : null,
        tokenOrigin: useToken ? cloneUrl.origin : null,
        ...(this.deps.gitBin ? { gitBin: this.deps.gitBin } : {}),
        ...(this.deps.sourceEnv ? { sourceEnv: this.deps.sourceEnv } : {}),
        onProgress: (progress) => {
          job.phase = progress.phase;
          job.percent = progress.percent;
        },
      });
      job.state = "registering";
      job.phase = "Registering";
      job.percent = null;
      if (await exists(job.targetPath))
        throw new Error(`${job.targetPath} appeared during the clone`);
      await rename(temp, job.targetPath);
      moved = true;
      const project = await this.deps.projects.create({
        name: job.name,
        rootPath: job.targetPath,
        gitRemote: repo.html_url,
        defaultBranch: job.branch ?? repo.default_branch,
        createDefaultWorkspaces: input.createDefaultWorkspaces,
      });
      job.projectId = project.id;
      job.state = "done";
      job.phase = null;
      this.repoCache.clear();
      this.deps.logger.info(
        { fullName: repo.full_name, projectId: project.id },
        "Repository imported",
      );
    } catch (error) {
      job.state = "failed";
      const message = error instanceof Error ? error.message : String(error);
      job.error = redact(
        moved
          ? `${message}. The clone stays in ${job.targetPath}: register it as a local folder`
          : message,
        token ? [token] : [],
      );
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      this.deps.logger.warn(
        { fullName: repo.full_name, error: job.error },
        "Repository import failed",
      );
    } finally {
      job.finishedAt = new Date();
    }
  }

  private async collect(
    fetchPage: (page: number) => Promise<RepoPage>,
  ): Promise<{ at: number; repos: GitHubRepo[]; truncated: boolean }> {
    const repos: GitHubRepo[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await fetchPage(page);
      repos.push(...result.repos);
      if (!result.hasNext) return { at: Date.now(), repos, truncated: false };
    }
    return { at: Date.now(), repos, truncated: true };
  }

  private async viewer(token: string): Promise<GitHubUser> {
    if (
      this.account &&
      this.account.token === token &&
      Date.now() - this.account.at < ACCOUNT_CACHE_MS
    )
      return this.account.user;
    const user = await this.deps.client.viewer(token);
    this.account = { token, at: Date.now(), user };
    return user;
  }

  private async resolveToken(): Promise<ResolvedToken | null> {
    const fromEnv = this.deps.config.github.token;
    if (fromEnv) return { token: fromEnv, source: "env" };
    const row = await this.deps.prisma.appSetting.findUnique({ where: { key: TOKEN_KEY } });
    return typeof row?.value === "string" && row.value.length > 0
      ? { token: row.value, source: "settings" }
      : null;
  }

  private async importedProjects(): Promise<Map<string, string>> {
    const projects = await this.deps.prisma.project.findMany({
      where: { gitRemote: { not: null } },
      select: { id: true, gitRemote: true },
    });
    return new Map(
      projects.flatMap((project) =>
        project.gitRemote ? [[remoteKey(project.gitRemote), project.id] as const] : [],
      ),
    );
  }

  private toRepoDto(repo: GitHubRepo, imported: Map<string, string>): GitHubRepoDto {
    return {
      fullName: repo.full_name,
      owner: repo.owner.login,
      name: repo.name,
      description: repo.description ?? null,
      private: repo.private,
      fork: repo.fork,
      archived: repo.archived,
      defaultBranch: repo.default_branch,
      language: repo.language ?? null,
      sizeKb: Math.round(repo.size),
      pushedAt: repo.pushed_at ?? null,
      htmlUrl: repo.html_url,
      importedProjectId: imported.get(remoteKey(repo.html_url)) ?? null,
    };
  }

  private toJobDto(job: CloneJob): CloneJobDto {
    return {
      id: job.id,
      fullName: job.fullName,
      name: job.name,
      branch: job.branch,
      targetPath: job.targetPath,
      state: job.state,
      phase: job.phase,
      percent: job.percent,
      projectId: job.projectId,
      error: job.error,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  private pruneJobs(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.finishedAt !== null)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS)))
      this.jobs.delete(job.id);
  }

  private async audit(
    actor: string,
    action: string,
    target: string | null,
    meta: Record<string, string>,
  ): Promise<void> {
    await this.deps.prisma.auditLog
      .create({ data: { actor, action, target, meta } })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Audit write failed"));
  }
}
