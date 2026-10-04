import { basename } from "node:path";
import { terminateStaleProcess } from "@onyx/agent-runtime";
import { ONYX_EVENT_TYPE, type OnyxRunItem } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { QueuedRun } from "./run-scheduler";

export interface RecoveryReport {
  interruptedRuns: number;
  killedProcesses: number;
  interruptedTasks: number;
  requeued: QueuedRun[];
}

export interface RecoveryOptions {
  claudeBin: string;
  autoResumeQueued: boolean;
}

const INTERRUPTED_MESSAGE = "Interrupted by Onyx restart";

export async function recoverInterruptedWork(
  prisma: PrismaClient,
  logger: Logger,
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
  for (const task of queued) {
    if (options.autoResumeQueued && task.workspaceId) {
      requeued.push({
        request: {
          taskId: task.id,
          modelId: null,
          agentConfigId: null,
          prompt: null,
          newSession: false,
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

  const report = {
    interruptedRuns: staleRuns.length,
    killedProcesses,
    interruptedTasks: interrupted.count,
    requeued,
  };
  if (staleRuns.length > 0 || interrupted.count > 0 || requeued.length > 0) {
    logger.warn(
      {
        interruptedRuns: report.interruptedRuns,
        killedProcesses,
        interruptedTasks: report.interruptedTasks,
        requeued: requeued.length,
      },
      "Recovered work interrupted by a previous shutdown",
    );
  }
  return report;
}
