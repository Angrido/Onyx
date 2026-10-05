import type {
  GitSummary,
  MissionControlDto,
  MissionProjectDto,
  RunStatus,
  SpendWindow,
  TddStatus,
} from "@onyx/contracts";
import { Prisma, type PrismaClient } from "@onyx/db";
import { renderFinding, type HealthFinding } from "../domain/health";
import { baseFindings, mapLimited, projectHealth } from "../domain/mission";
import { sqlDate } from "../infrastructure/run-totals";
import type { HealthProject } from "./health-service";
import type { RunScheduler } from "./run-scheduler";

const DAY_MS = 86_400_000;
const GIT_TTL_MS = 30_000;
const GIT_CONCURRENCY = 4;
const ACTIVE_SHOWN = 3;
const OPEN_STATUSES = [
  "DRAFT",
  "PLANNING",
  "AWAITING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "TDD_LOOP",
  "INTERRUPTED",
] as const;

export interface MissionServiceDeps {
  prisma: PrismaClient;
  scheduler: () => RunScheduler | null;
  gitSummary: (rootPath: string, now: Date) => Promise<GitSummary>;
  limitOf: (projectId: string) => number | null;
  health?: (project: HealthProject, git: GitSummary, now: Date) => Promise<HealthFinding[]>;
  globalHealth?: (now: Date) => Promise<HealthFinding[]>;
  maxConcurrent: number;
  now?: () => Date;
}

interface CachedGit {
  rootPath: string;
  at: number;
  summary: GitSummary;
}

interface SpendRow {
  projectId: string;
  todayRuns: number;
  todayCost: number;
  todayTokens: number;
  todayCacheRead: number;
  weekRuns: number;
  weekCost: number;
  weekTokens: number;
  weekCacheRead: number;
}

const EMPTY_SPEND: SpendWindow = { runs: 0, costUsd: 0, tokens: 0, cacheReadTokens: 0 };

function startOfDay(reference: Date): Date {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  return start;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function addSpend(left: SpendWindow, right: SpendWindow): SpendWindow {
  return {
    runs: left.runs + right.runs,
    costUsd: left.costUsd + right.costUsd,
    tokens: left.tokens + right.tokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  };
}

export class MissionService {
  private readonly git = new Map<string, CachedGit>();
  private readonly pending = new Map<string, Promise<GitSummary>>();

  constructor(private readonly deps: MissionServiceDeps) {}

  forget(projectId?: string): void {
    if (projectId === undefined) this.git.clear();
    else this.git.delete(projectId);
  }

  async forgetTask(taskId: string): Promise<void> {
    const task = await this.deps.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (task) this.forget(task.projectId);
  }

  async overview(): Promise<MissionControlDto> {
    const now = this.deps.now?.() ?? new Date();
    const { prisma } = this.deps;
    const today = startOfDay(now);
    const weekStart = new Date(now.getTime() - 7 * DAY_MS);
    const [projects, spend, lastRuns, lastLoops, approvals, open] = await Promise.all([
      prisma.project.findMany({
        select: {
          id: true,
          name: true,
          rootPath: true,
          defaultBranch: true,
          indexError: true,
          indexedAt: true,
          gitRemote: true,
          allowedTools: true,
          updatedAt: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.$queryRaw<SpendRow[]>(Prisma.sql`
        SELECT t.projectId AS projectId,
          SUM(CASE WHEN l.createdAt >= ${sqlDate(today)} THEN 1 ELSE 0 END) AS todayRuns,
          SUM(CASE WHEN l.createdAt >= ${sqlDate(today)} THEN COALESCE(l.costUsd, 0) ELSE 0 END) AS todayCost,
          SUM(CASE WHEN l.createdAt >= ${sqlDate(today)} THEN l.inputTokens + l.outputTokens + l.cacheCreationTokens ELSE 0 END) AS todayTokens,
          SUM(CASE WHEN l.createdAt >= ${sqlDate(today)} THEN l.cacheReadTokens ELSE 0 END) AS todayCacheRead,
          COUNT(*) AS weekRuns,
          SUM(COALESCE(l.costUsd, 0)) AS weekCost,
          SUM(l.inputTokens + l.outputTokens + l.cacheCreationTokens) AS weekTokens,
          SUM(l.cacheReadTokens) AS weekCacheRead
        FROM TokenLog l
        JOIN AgentRun r ON r.id = l.runId
        JOIN Task t ON t.id = r.taskId
        WHERE l.scope = 'RUN_TOTAL' AND l.createdAt >= ${sqlDate(weekStart)}
        GROUP BY t.projectId`),
      prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT projectId, runId, taskId, title, status, startedAt, endedAt FROM (
          SELECT t.projectId AS projectId, r.id AS runId, r.taskId AS taskId, t.title AS title,
            r.status AS status, r.startedAt AS startedAt, r.endedAt AS endedAt,
            ROW_NUMBER() OVER (PARTITION BY t.projectId ORDER BY r.startedAt DESC) AS position
          FROM AgentRun r JOIN Task t ON t.id = r.taskId
        ) WHERE position = 1`),
      prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT projectId, loopId, taskId, title, status, at FROM (
          SELECT t.projectId AS projectId, l.id AS loopId, l.taskId AS taskId, t.title AS title,
            l.status AS status, COALESCE(l.endedAt, l.startedAt, l.createdAt) AS at,
            ROW_NUMBER() OVER (PARTITION BY t.projectId ORDER BY l.createdAt DESC) AS position
          FROM TddLoop l JOIN Task t ON t.id = l.taskId
        ) WHERE position = 1`),
      prisma.approval.groupBy({
        by: ["projectId"],
        where: { status: "PENDING" },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: { status: { in: [...OPEN_STATUSES] } },
        _count: { _all: true },
      }),
    ]);

    const scheduler = this.deps.scheduler();
    const active = scheduler?.activeRuns() ?? [];
    const queued = scheduler?.queuedRuns() ?? [];
    const activeIds = active.map((run) => run.taskId);
    const activeTitles = new Map(
      activeIds.length === 0
        ? []
        : (
            await prisma.task.findMany({
              where: { id: { in: activeIds } },
              select: { id: true, title: true },
            })
          ).map((task) => [task.id, task.title]),
    );
    const globalChecks = this.deps.globalHealth ? await this.deps.globalHealth(now) : [];
    const gitSummaries = await mapLimited(projects, GIT_CONCURRENCY, (project) =>
      this.gitOf(project.id, project.rootPath, now),
    );
    const checks = await mapLimited(
      projects.map((project, index) => ({ project, git: gitSummaries[index] as GitSummary })),
      GIT_CONCURRENCY,
      ({ project, git }) =>
        this.deps.health
          ? this.deps.health(project, git, now)
          : Promise.resolve(baseFindings(project.indexError, git)),
    );

    const spendBy = new Map(spend.map((row) => [String(row.projectId), row]));
    const runBy = new Map(lastRuns.map((row) => [String(row["projectId"]), row]));
    const loopBy = new Map(lastLoops.map((row) => [String(row["projectId"]), row]));
    const approvalsBy = new Map(approvals.map((row) => [row.projectId, row._count._all]));
    const openBy = new Map(open.map((row) => [row.projectId, row._count._all]));

    const items: MissionProjectDto[] = projects.map((project, index) => {
      const git = gitSummaries[index] as GitSummary;
      const money = spendBy.get(project.id);
      const run = runBy.get(project.id);
      const loop = loopBy.get(project.id);
      const lastRun = run
        ? {
            runId: String(run["runId"]),
            taskId: String(run["taskId"]),
            title: String(run["title"]),
            status: String(run["status"]) as RunStatus,
            startedAt: iso(run["startedAt"]),
            endedAt: run["endedAt"] ? iso(run["endedAt"]) : null,
          }
        : null;
      const lastTdd = loop
        ? {
            loopId: String(loop["loopId"]),
            taskId: String(loop["taskId"]),
            title: String(loop["title"]),
            status: String(loop["status"]) as TddStatus,
            at: iso(loop["at"]),
          }
        : null;
      const pendingApprovals = approvalsBy.get(project.id) ?? 0;
      const mine = active.filter((entry) => entry.projectId === project.id);
      const findings = checks[index] ?? [];
      const { health, reasons } = projectHealth({
        indexError: project.indexError,
        git,
        lastRun,
        lastTdd,
        pendingApprovals,
        checks: findings,
      });
      const moments = [project.updatedAt.toISOString(), lastRun?.endedAt, lastRun?.startedAt];
      return {
        id: project.id,
        name: project.name,
        defaultBranch: project.defaultBranch,
        git,
        running: mine.length,
        queued: queued.filter((entry) => entry.projectId === project.id).length,
        runLimit: this.deps.limitOf(project.id),
        activeTasks: mine.slice(0, ACTIVE_SHOWN).map((entry) => ({
          taskId: entry.taskId,
          title: activeTitles.get(entry.taskId) ?? "Task",
          runId: entry.runId,
        })),
        lastRun,
        lastTdd,
        today: money
          ? {
              runs: num(money.todayRuns),
              costUsd: num(money.todayCost),
              tokens: num(money.todayTokens),
              cacheReadTokens: num(money.todayCacheRead),
            }
          : EMPTY_SPEND,
        week: money
          ? {
              runs: num(money.weekRuns),
              costUsd: num(money.weekCost),
              tokens: num(money.weekTokens),
              cacheReadTokens: num(money.weekCacheRead),
            }
          : EMPTY_SPEND,
        pendingApprovals,
        openTasks: openBy.get(project.id) ?? 0,
        lastActivityAt: moments
          .filter((moment): moment is string => typeof moment === "string")
          .reduce((latest, moment) => (moment > latest ? moment : latest)),
        health,
        reasons,
        checks: findings.map(renderFinding),
      };
    });

    return {
      projects: items,
      globalChecks: globalChecks.map(renderFinding),
      running: active.length,
      queued: queued.length,
      maxConcurrent: this.deps.maxConcurrent,
      pendingApprovals: items.reduce((sum, item) => sum + item.pendingApprovals, 0),
      today: items.reduce((sum, item) => addSpend(sum, item.today), EMPTY_SPEND),
      week: items.reduce((sum, item) => addSpend(sum, item.week), EMPTY_SPEND),
      generatedAt: now.toISOString(),
    };
  }

  async gitOf(projectId: string, rootPath: string, now: Date): Promise<GitSummary> {
    const cached = this.git.get(projectId);
    if (cached && cached.rootPath === rootPath && now.getTime() - cached.at < GIT_TTL_MS)
      return cached.summary;
    const running = this.pending.get(projectId);
    if (running) return running;
    const started = this.deps
      .gitSummary(rootPath, now)
      .then((summary) => {
        this.git.set(projectId, { rootPath, at: now.getTime(), summary });
        return summary;
      })
      .finally(() => this.pending.delete(projectId));
    this.pending.set(projectId, started);
    return started;
  }
}
