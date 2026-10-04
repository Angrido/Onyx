import { readdir, rm, rmdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { terminateStaleProcess } from "@onyx/agent-runtime";
import { ONYX_EVENT_TYPE, type OnyxRunItem, type TaskStatus } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import { worktreeVerdict } from "../domain/orphan-worktrees";
import { readPendingRun } from "../domain/pending-run";
import { GitRepo } from "../infrastructure/git-worktree";
import type { ProcessLedger, ProcessSweep } from "../infrastructure/process-ledger";
import type { OrchestratorService, PlanRecovery } from "./orchestrator-service";
import type { QueuedRun, RunScheduler } from "./run-scheduler";
import type { TddService } from "./tdd-service";

export interface RecoveryReport {
  interruptedRuns: number;
  killedProcesses: number;
  interruptedTasks: number;
  requeued: QueuedRun[];
  restoredRequests: number;
}

export interface RecoveryOptions {
  claudeBin: string;
  autoResumeQueued: boolean;
}

export interface WorktreeSweep {
  removed: string[];
  kept: number;
}

export type StartupRecovery = {
  at: string;
  durationMs: number;
  killedProcesses: number;
  goneProcesses: number;
  interruptedRuns: number;
  interruptedTasks: number;
  requeuedTasks: number;
  restoredRequests: number;
  interruptedLoops: number;
  failedPlans: number;
  resumedPlans: number;
  releasedPlanNodes: number;
  removedWorktrees: number;
  keptWorktrees: number;
  killed: string[];
  removed: string[];
};

const INTERRUPTED_MESSAGE = "Interrupted by Onyx restart";
const ACTIVE_TASK_STATUSES: TaskStatus[] = ["QUEUED", "RUNNING", "TDD_LOOP"];
const LISTED_ENTRIES = 20;

export async function recoverInterruptedWork(
  prisma: PrismaClient,
  options: RecoveryOptions,
): Promise<RecoveryReport> {
  const fragment = basename(options.claudeBin);
  const staleRuns = await prisma.agentRun.findMany({
    where: { status: { in: ["SPAWNING", "RUNNING"] } },
    select: { id: true, pid: true },
  });

  let killedProcesses = 0;
  const now = new Date();
  for (const run of staleRuns) {
    if (run.pid !== null && terminateStaleProcess(run.pid, fragment)) killedProcesses += 1;
    const last = await prisma.agentEvent.findFirst({
      where: { runId: run.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const status: OnyxRunItem = {
      kind: "status",
      status: "INTERRUPTED",
      exitCode: null,
      signal: null,
      message: INTERRUPTED_MESSAGE,
    };
    await prisma.$transaction([
      prisma.agentEvent.create({
        data: {
          runId: run.id,
          seq: (last?.seq ?? 0) + 1,
          type: ONYX_EVENT_TYPE,
          subtype: "status",
          payload: status,
        },
      }),
      prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "INTERRUPTED",
          isError: true,
          errorMessage: INTERRUPTED_MESSAGE,
          endedAt: now,
        },
      }),
    ]);
  }

  const interrupted = await prisma.task.updateMany({
    where: { status: { in: ["RUNNING", "TDD_LOOP", "PLANNING"] } },
    data: { status: "INTERRUPTED" },
  });
  await prisma.session.updateMany({ where: { status: "ACTIVE" }, data: { status: "IDLE" } });

  const queued = await prisma.task.findMany({
    where: { status: "QUEUED" },
    orderBy: { updatedAt: "asc" },
  });
  const requeued: QueuedRun[] = [];
  let restoredRequests = 0;
  for (const task of queued) {
    if (options.autoResumeQueued && task.workspaceId && task.planKey === null) {
      const pending = readPendingRun(task.pendingRun);
      if (pending && (pending.prompt !== null || pending.modelId !== null)) restoredRequests += 1;
      requeued.push({
        request: {
          taskId: task.id,
          modelId: pending?.modelId ?? null,
          agentConfigId: pending?.agentConfigId ?? null,
          prompt: pending?.prompt ?? null,
          newSession: pending?.newSession ?? false,
          ...(pending?.tierHint ? { tierHint: pending.tierHint } : {}),
        },
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        lockKey: task.worktreePath ? `task:${task.id}` : task.workspaceId,
        priority: task.priority,
        canWait: task.canWait,
        enqueuedAt: task.updatedAt.getTime(),
      });
    } else {
      await prisma.task.update({ where: { id: task.id }, data: { status: "INTERRUPTED" } });
    }
  }

  return {
    interruptedRuns: staleRuns.length,
    killedProcesses,
    interruptedTasks: interrupted.count,
    requeued,
    restoredRequests,
  };
}

async function directories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function sweepWorktrees(
  prisma: PrismaClient,
  logger: Logger,
  worktreesDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorktreeSweep> {
  const sweep: WorktreeSweep = { removed: [], kept: 0 };
  const busy = new Set(
    (
      await prisma.task.findMany({
        where: { worktreePath: { not: null }, status: { in: ACTIVE_TASK_STATUSES } },
        select: { worktreePath: true },
      })
    ).flatMap((task) => (task.worktreePath ? [task.worktreePath] : [])),
  );
  for (const projectId of await directories(worktreesDir)) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { rootPath: true },
    });
    const repo = project ? new GitRepo(project.rootPath, env) : null;
    let touched = false;
    for (const planId of await directories(join(worktreesDir, projectId))) {
      const planDir = join(worktreesDir, projectId, planId);
      const plan = await prisma.orchestration.findUnique({
        where: { id: planId },
        select: { status: true, workBranch: true, rootTaskId: true },
      });
      const nodes = plan
        ? await prisma.task.findMany({
            where: { parentTaskId: plan.rootTaskId },
            select: { id: true, planKey: true, mergeState: true },
          })
        : [];
      for (const name of await directories(planDir)) {
        const path = join(planDir, name);
        const node = nodes.find((entry) => (entry.planKey ?? entry.id) === name);
        const verdict = worktreeVerdict({
          name,
          plan: plan ? { status: plan.status, workBranch: plan.workBranch } : null,
          nodeState: node ? node.mergeState : undefined,
          inUse: busy.has(path),
        });
        if (verdict === "keep") {
          sweep.kept += 1;
          continue;
        }
        try {
          if (repo) await repo.removeWorktree(path);
          else await rm(path, { recursive: true, force: true });
          sweep.removed.push(path);
          touched = true;
        } catch (error) {
          logger.warn({ err: error, path }, "Could not remove a leftover worktree");
        }
      }
      await rmdir(planDir).catch(() => undefined);
    }
    if (repo && touched) await repo.run(["worktree", "prune"]).catch(() => undefined);
    await rmdir(join(worktreesDir, projectId)).catch(() => undefined);
  }
  return sweep;
}

export interface RecoveryServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  ledger: Pick<ProcessLedger, "sweep">;
  tdd: Pick<TddService, "recover">;
  orchestrator: Pick<OrchestratorService, "recover" | "resumeRecovered">;
  scheduler: Pick<RunScheduler, "enqueue">;
  claudeBin: string;
  autoResumeQueued: boolean;
  worktreesDir: string;
  sourceEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
}

interface EarlyRecovery {
  startedAt: number;
  processes: ProcessSweep;
  interruptedLoops: number;
  plans: PlanRecovery;
}

export class RecoveryService {
  private early: EarlyRecovery | null = null;
  private report: StartupRecovery | null = null;

  constructor(private readonly deps: RecoveryServiceDeps) {}

  lastReport(): StartupRecovery | null {
    return this.report;
  }

  async recoverState(): Promise<void> {
    const startedAt = Date.now();
    const processes = await this.deps.ledger.sweep().catch((error: unknown) => {
      this.deps.logger.warn({ err: error }, "Could not check the processes of the previous run");
      return { killed: [], gone: 0, kept: 0 };
    });
    for (const record of processes.killed)
      this.deps.logger.warn(
        { pid: record.pid, label: record.label, startedAt: record.startedAt },
        "Stopped a process left behind by a previous Onyx",
      );
    const interruptedLoops = await this.deps.tdd.recover();
    const plans = await this.deps.orchestrator.recover({ resume: this.deps.autoResumeQueued });
    this.early = { startedAt, processes, interruptedLoops, plans };
  }

  async resumeWork(): Promise<StartupRecovery> {
    const { prisma, logger } = this.deps;
    const early = this.early ?? {
      startedAt: Date.now(),
      processes: { killed: [], gone: 0, kept: 0 },
      interruptedLoops: 0,
      plans: { failed: 0, resumable: [], releasedNodes: 0 },
    };
    this.early = null;
    const work = await recoverInterruptedWork(prisma, {
      claudeBin: this.deps.claudeBin,
      autoResumeQueued: this.deps.autoResumeQueued,
    });
    const worktrees = await sweepWorktrees(
      prisma,
      logger,
      this.deps.worktreesDir,
      this.deps.sourceEnv ? { ...process.env, ...this.deps.sourceEnv } : process.env,
    ).catch((error: unknown) => {
      logger.warn({ err: error }, "Could not check the leftover worktrees");
      return { removed: [], kept: 0 };
    });
    for (const item of work.requeued) this.deps.scheduler.enqueue(item);
    const resumedPlans = await this.deps.orchestrator.resumeRecovered(early.plans.resumable);
    const report: StartupRecovery = {
      at: (this.deps.now?.() ?? new Date()).toISOString(),
      durationMs: Date.now() - early.startedAt,
      killedProcesses: early.processes.killed.length + work.killedProcesses,
      goneProcesses: early.processes.gone,
      interruptedRuns: work.interruptedRuns,
      interruptedTasks: work.interruptedTasks,
      requeuedTasks: work.requeued.length,
      restoredRequests: work.restoredRequests,
      interruptedLoops: early.interruptedLoops,
      failedPlans: early.plans.failed + early.plans.resumable.length - resumedPlans,
      resumedPlans,
      releasedPlanNodes: early.plans.releasedNodes,
      removedWorktrees: worktrees.removed.length,
      keptWorktrees: worktrees.kept,
      killed: early.processes.killed
        .slice(0, LISTED_ENTRIES)
        .map((record) => `${record.label} (pid ${record.pid})`),
      removed: worktrees.removed.slice(0, LISTED_ENTRIES),
    };
    this.report = report;
    const eventful =
      report.killedProcesses +
        report.goneProcesses +
        report.interruptedRuns +
        report.interruptedTasks +
        report.requeuedTasks +
        report.interruptedLoops +
        report.failedPlans +
        report.resumedPlans +
        report.removedWorktrees >
      0;
    if (eventful) logger.warn(report, "Recovered work interrupted by a previous shutdown");
    else logger.info({ durationMs: report.durationMs }, "Startup recovery found nothing to do");
    return report;
  }
}
