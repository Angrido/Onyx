import {
  ErrorCode,
  PullRequestCheckSchema,
  type ChecksState,
  type CreatePullRequestRequestSchema,
  type PullRequestCheck,
  type PullRequestDraftDto,
  type PullRequestDto,
  type PullRequestListResponse,
  type PullRequestState,
} from "@onyx/contracts";
import type { Prisma, PrismaClient, PullRequest } from "@onyx/db";
import type { Logger } from "pino";
import { z } from "zod";
import { checksMessage, type NotificationMessage } from "../domain/notifications";
import {
  BASE_INTERVAL_SEC,
  checkRunResult,
  commitStatusResult,
  nextInterval,
  pullRequestBody,
  pullRequestTitle,
  summarizeChecks,
  type PullTask,
} from "../domain/pull-requests";
import { AppError, badRequest, notFound } from "../errors";
import { GitHubError, type GitHubClient } from "../infrastructure/github-client";
import type { GitHubService } from "./github-service";
import type { GitService } from "./git-service";
import { toStringArray } from "./mappers";

type CreateInput = z.output<typeof CreatePullRequestRequestSchema>;

export const PULL_POLL_TICK_MS = 15_000;
const DUE_PER_TICK = 5;

const StoredChecksSchema = z.object({
  runs: z.array(PullRequestCheckSchema).catch([]),
  statuses: z.array(PullRequestCheckSchema).catch([]),
});
type StoredChecks = z.infer<typeof StoredChecksSchema>;

const EtagsSchema = z.object({
  pull: z.string().nullable().catch(null),
  runs: z.string().nullable().catch(null),
  statuses: z.string().nullable().catch(null),
  sha: z.string().nullable().catch(null),
});
type Etags = z.infer<typeof EtagsSchema>;

const EMPTY_ETAGS: Etags = { pull: null, runs: null, statuses: null, sha: null };

export function githubFailure(error: unknown): unknown {
  if (!(error instanceof GitHubError)) return error;
  if (error.status === 502) return new AppError(502, ErrorCode.Unavailable, error.message);
  if (error.status === 404) return new AppError(404, ErrorCode.NotFound, error.message);
  if (error.status === 429 || /rate limit/i.test(error.message))
    return new AppError(429, ErrorCode.TooManyRequests, error.message);
  return badRequest(error.message);
}

function storedChecks(value: Prisma.JsonValue | null): StoredChecks {
  const parsed = StoredChecksSchema.safeParse(value);
  return parsed.success ? parsed.data : { runs: [], statuses: [] };
}

function storedEtags(value: Prisma.JsonValue | null): Etags {
  const parsed = EtagsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...EMPTY_ETAGS };
}

function allChecks(stored: StoredChecks): PullRequestCheck[] {
  return [...stored.runs, ...stored.statuses].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function toPullRequestDto(row: PullRequest): PullRequestDto {
  const checks = allChecks(storedChecks(row.checks));
  return {
    id: row.id,
    projectId: row.projectId,
    repo: row.repo,
    number: row.number,
    url: row.url,
    title: row.title,
    branch: row.branch,
    baseBranch: row.baseBranch,
    state: row.state,
    draft: row.draft,
    checksState: row.checksState,
    checks,
    passed: checks.filter((check) => check.result === "SUCCESS").length,
    failed: checks.filter((check) => check.result === "FAILURE").length,
    pending: checks.filter((check) => check.result === "PENDING").length,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PullRequestServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  client: GitHubClient;
  github: Pick<GitHubService, "token">;
  git: Pick<GitService, "githubRepo" | "branchExists" | "diffFiles" | "pushBranch">;
  notify: (message: NotificationMessage) => void;
  now?: () => Date;
  tickMs?: number;
}

export class PullRequestService {
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;

  constructor(private readonly deps: PullRequestServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    const tickMs = this.deps.tickMs ?? PULL_POLL_TICK_MS;
    if (this.timer || tickMs <= 0) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, tickMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.refreshDue()
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Pull request check failed"))
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  private async refreshDue(): Promise<void> {
    const due = await this.deps.prisma.pullRequest.findMany({
      where: { state: "OPEN", nextCheckAt: { lte: this.now() } },
      orderBy: { nextCheckAt: "asc" },
      take: DUE_PER_TICK,
      select: { id: true },
    });
    for (const row of due) await this.refresh(row.id);
  }

  async list(projectId: string): Promise<PullRequestListResponse> {
    const { repo } = await this.deps.git.githubRepo(projectId);
    const rows = await this.deps.prisma.pullRequest.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { repo, items: rows.map(toPullRequestDto) };
  }

  async forTask(task: {
    id: string;
    projectId: string;
    branchName: string | null;
  }): Promise<PullRequestDto | null> {
    const branch =
      task.branchName ??
      (
        await this.deps.prisma.orchestration.findFirst({
          where: { rootTaskId: task.id },
          select: { workBranch: true },
        })
      )?.workBranch ??
      null;
    if (!branch) return null;
    const row = await this.deps.prisma.pullRequest.findFirst({
      where: { projectId: task.projectId, branch },
      orderBy: { createdAt: "desc" },
    });
    return row ? toPullRequestDto(row) : null;
  }

  async draft(projectId: string, branch: string): Promise<PullRequestDraftDto> {
    const { project, repo } = await this.deps.git.githubRepo(projectId);
    const base = project.defaultBranch;
    const [tasks, existing, token, exists] = await Promise.all([
      this.branchTasks(projectId, branch),
      this.deps.prisma.pullRequest.findFirst({
        where: { projectId, branch, state: "OPEN" },
        orderBy: { createdAt: "desc" },
      }),
      this.deps.github.token(),
      this.deps.git.branchExists(projectId, branch),
    ]);
    const files = exists ? await this.deps.git.diffFiles(projectId, base, branch) : [];
    const loops = await this.deps.prisma.tddLoop.findMany({
      where: { taskId: { in: tasks.map((task) => task.id) } },
      orderBy: { createdAt: "desc" },
      select: { taskId: true, fullCommand: true, status: true },
    });
    const latest = new Map<string, { command: string; status: string }>();
    for (const loop of loops)
      if (!latest.has(loop.taskId))
        latest.set(loop.taskId, { command: loop.fullCommand, status: loop.status });
    const reason = !repo
      ? "The project has no GitHub remote"
      : branch === base
        ? `Choose a branch other than ${base}`
        : !exists
          ? `The branch ${branch} does not exist in the project`
          : !token
            ? "Connect a GitHub token with Pull requests read and write"
            : existing
              ? `Pull request #${existing.number} is already open for this branch`
              : null;
    return {
      repo,
      branch,
      baseBranch: base,
      title: pullRequestTitle(tasks, branch),
      body: pullRequestBody({ repo: repo ?? "", tasks, files, tests: [...latest.values()] }),
      tasks: tasks.map((task) => ({ id: task.id, title: task.title })),
      existing: existing ? toPullRequestDto(existing) : null,
      canCreate: reason === null,
      reason,
    };
  }

  async create(projectId: string, input: CreateInput, actor: string): Promise<PullRequestDto> {
    const { project, repo } = await this.deps.git.githubRepo(projectId);
    if (!repo) throw badRequest("The project has no GitHub remote");
    if (input.branch === project.defaultBranch)
      throw badRequest(`Choose a branch other than ${project.defaultBranch}`);
    if (!(await this.deps.git.branchExists(projectId, input.branch)))
      throw badRequest(`The branch ${input.branch} does not exist in the project`);
    const token = await this.deps.github.token();
    if (!token) throw badRequest("Connect a GitHub token with Pull requests read and write");
    const push = await this.deps.git.pushBranch(projectId, input.branch, actor);
    if (!push.pushed) throw badRequest(push.pushError ?? "Could not push the branch");
    const owner = repo.split("/")[0] ?? "";
    let pull;
    try {
      pull = await this.deps.client.createPull(repo, token, {
        title: input.title,
        head: input.branch,
        base: project.defaultBranch,
        body: input.body,
        draft: input.draft,
      });
    } catch (error) {
      const existing =
        error instanceof GitHubError &&
        error.status === 422 &&
        /already exists/i.test(error.message)
          ? await this.deps.client
              .openPullFor(repo, token, `${owner}:${input.branch}`)
              .catch(() => null)
          : null;
      if (!existing) throw githubFailure(error);
      pull = existing;
    }
    const now = this.now();
    const data = {
      projectId,
      url: pull.html_url,
      title: pull.title,
      branch: pull.head.ref,
      baseBranch: pull.base.ref,
      state: (pull.merged_at
        ? "MERGED"
        : pull.state === "closed"
          ? "CLOSED"
          : "OPEN") as PullRequestState,
      draft: pull.draft,
      headSha: pull.head.sha,
      intervalSec: BASE_INTERVAL_SEC,
      nextCheckAt: now,
    };
    const row = await this.deps.prisma.pullRequest.upsert({
      where: { repo_number: { repo, number: pull.number } },
      create: { repo, number: pull.number, ...data },
      update: data,
    });
    await this.deps.prisma.auditLog
      .create({
        data: {
          actor,
          action: "github.pull-request",
          target: projectId,
          meta: { repo, number: pull.number, branch: input.branch },
        },
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Audit write failed"));
    return this.refresh(row.id).catch((error: unknown) => {
      this.deps.logger.warn({ err: error, id: row.id }, "First check of the pull request failed");
      return toPullRequestDto(row);
    });
  }

  async refresh(id: string): Promise<PullRequestDto> {
    const { prisma } = this.deps;
    const row = await prisma.pullRequest.findUnique({ where: { id } });
    if (!row) throw notFound("Pull request");
    const token = await this.deps.github.token();
    const etags = storedEtags(row.etags);
    const checks = storedChecks(row.checks);
    let state: PullRequestState = row.state;
    let headSha = row.headSha;
    let title = row.title;
    let draft = row.draft;
    let failed = false;
    try {
      const pull = await this.deps.client.pull(row.repo, row.number, token, etags.pull);
      if (!pull.notModified) {
        state = pull.body.merged_at ? "MERGED" : pull.body.state === "closed" ? "CLOSED" : "OPEN";
        headSha = pull.body.head.sha;
        title = pull.body.title;
        draft = pull.body.draft;
        etags.pull = pull.etag;
      }
      if (headSha !== etags.sha) {
        etags.runs = null;
        etags.statuses = null;
        etags.sha = headSha;
        checks.runs = [];
        checks.statuses = [];
      }
      if (headSha) {
        const [runs, statuses] = await Promise.all([
          this.deps.client.checkRuns(row.repo, headSha, token, etags.runs),
          this.deps.client.combinedStatus(row.repo, headSha, token, etags.statuses),
        ]);
        if (!runs.notModified) {
          etags.runs = runs.etag;
          checks.runs = runs.body.check_runs.map((run) => ({
            name: run.name,
            result: checkRunResult(run.status, run.conclusion),
            url: run.html_url ?? run.details_url ?? null,
          }));
        }
        if (!statuses.notModified) {
          etags.statuses = statuses.etag;
          checks.statuses = statuses.body.statuses.map((status) => ({
            name: status.context,
            result: commitStatusResult(status.state),
            url: status.target_url ?? null,
          }));
        }
      }
    } catch (error) {
      failed = true;
      this.deps.logger.warn(
        { err: error, repo: row.repo, number: row.number },
        "Could not read the pull request from GitHub",
      );
    }
    const checksState: ChecksState = failed ? row.checksState : summarizeChecks(allChecks(checks));
    const changed =
      checksState !== row.checksState || state !== row.state || headSha !== row.headSha;
    const intervalSec = nextInterval(row.intervalSec, {
      changed,
      pending: checksState === "PENDING",
      failed,
    });
    const now = this.now();
    const updated = await prisma.pullRequest.update({
      where: { id },
      data: {
        state,
        headSha,
        title,
        draft,
        checksState,
        checks: checks as unknown as Prisma.InputJsonValue,
        etags: etags as unknown as Prisma.InputJsonValue,
        intervalSec,
        ...(failed ? {} : { checkedAt: now }),
        nextCheckAt: state === "OPEN" ? new Date(now.getTime() + intervalSec * 1000) : null,
      },
    });
    if (!failed && checksState !== row.checksState) await this.announce(updated, row.checksState);
    return toPullRequestDto(updated);
  }

  private async announce(row: PullRequest, previous: ChecksState): Promise<void> {
    const passed = row.checksState === "SUCCESS";
    if (
      row.checksState !== "FAILURE" &&
      !(passed && (previous === "PENDING" || previous === "FAILURE"))
    )
      return;
    const project = await this.deps.prisma.project
      .findUnique({ where: { id: row.projectId }, select: { name: true } })
      .catch(() => null);
    this.deps.notify(
      checksMessage({
        projectId: row.projectId,
        projectName: project?.name ?? row.repo,
        number: row.number,
        title: row.title,
        passed,
        failed: toPullRequestDto(row)
          .checks.filter((check) => check.result === "FAILURE")
          .map((check) => check.name),
      }),
    );
  }

  private async branchTasks(
    projectId: string,
    branch: string,
  ): Promise<(PullTask & { id: string })[]> {
    const { prisma } = this.deps;
    const plans = await prisma.orchestration.findMany({
      where: { projectId, workBranch: branch },
      select: { rootTaskId: true },
    });
    const tasks = await prisma.task.findMany({
      where: {
        projectId,
        status: "COMPLETED",
        OR: [{ branchName: branch }, { id: { in: plans.map((plan) => plan.rootTaskId) } }],
      },
      orderBy: { completedAt: "asc" },
      take: 30,
      select: {
        id: true,
        title: true,
        resultSummary: true,
        acceptance: true,
        issueNumber: true,
        issueRepo: true,
      },
    });
    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      resultSummary: task.resultSummary,
      acceptance: toStringArray(task.acceptance),
      issueNumber: task.issueNumber,
      issueRepo: task.issueRepo,
    }));
  }
}
