import {
  QueueSettingsSchema,
  type QueueDto,
  type QueueItemDto,
  type QueueProjectLoad,
  type QueueSettings,
} from "@onyx/contracts";
import type { Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import { notFound } from "../errors";
import type { QueueMove, QueuePolicy, RunScheduler } from "./run-scheduler";

export const QUEUE_SETTINGS_KEY = "queue.settings";
export const DEFAULT_QUEUE_SETTINGS: QueueSettings = { projectLimit: null, agingMinutes: 30 };
const STORED_PRIORITY = 100;

export interface QueueServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  scheduler: () => RunScheduler | null;
  maxConcurrent: number;
}

export class QueueService {
  private settings: QueueSettings = DEFAULT_QUEUE_SETTINGS;
  private readonly limits = new Map<string, number>();

  constructor(private readonly deps: QueueServiceDeps) {}

  async load(): Promise<void> {
    const [row, projects] = await Promise.all([
      this.deps.prisma.appSetting.findUnique({ where: { key: QUEUE_SETTINGS_KEY } }),
      this.deps.prisma.project.findMany({
        where: { runLimit: { not: null } },
        select: { id: true, runLimit: true },
      }),
    ]);
    const parsed = QueueSettingsSchema.safeParse(row?.value);
    if (parsed.success) this.settings = parsed.data;
    this.limits.clear();
    for (const project of projects)
      if (project.runLimit !== null) this.limits.set(project.id, project.runLimit);
  }

  policy(): QueuePolicy {
    return {
      agingMs: this.settings.agingMinutes * 60_000,
      limitOf: (projectId) => this.limitOf(projectId),
    };
  }

  limitOf(projectId: string): number | null {
    return this.limits.get(projectId) ?? this.settings.projectLimit;
  }

  async updateSettings(settings: QueueSettings): Promise<QueueDto> {
    this.settings = QueueSettingsSchema.parse(settings);
    const value = this.settings as unknown as Prisma.InputJsonValue;
    await this.deps.prisma.appSetting.upsert({
      where: { key: QUEUE_SETTINGS_KEY },
      create: { key: QUEUE_SETTINGS_KEY, value },
      update: { value },
    });
    this.deps.scheduler()?.poke();
    return this.dto();
  }

  async setProjectLimit(projectId: string, limit: number | null): Promise<QueueDto> {
    const project = await this.deps.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    await this.deps.prisma.project.update({ where: { id: projectId }, data: { runLimit: limit } });
    if (limit === null) this.limits.delete(projectId);
    else this.limits.set(projectId, limit);
    this.deps.scheduler()?.poke();
    return this.dto();
  }

  forgetProject(projectId: string): void {
    this.limits.delete(projectId);
  }

  async move(taskId: string, to: QueueMove): Promise<QueueDto> {
    const scheduler = this.deps.scheduler();
    const moved = scheduler?.move(taskId, to);
    if (!moved) throw notFound("Queued task");
    const priority = Math.max(-STORED_PRIORITY, Math.min(STORED_PRIORITY, moved.priority));
    if (moved.kind === undefined || moved.kind === "TASK")
      await this.deps.prisma.task
        .update({ where: { id: taskId }, data: { priority } })
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error, taskId }, "Could not save the new priority"),
        );
    return this.dto();
  }

  async dto(): Promise<QueueDto> {
    const scheduler = this.deps.scheduler();
    const queued = scheduler?.queuedRuns() ?? [];
    const active = scheduler?.activeRuns() ?? [];
    const taskIds = [
      ...new Set([
        ...queued.map((item) => item.request.taskId),
        ...active.map((run) => run.taskId),
      ]),
    ];
    const [tasks, projects] = await Promise.all([
      taskIds.length === 0
        ? []
        : this.deps.prisma.task.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, title: true, workspace: { select: { name: true } } },
          }),
      this.deps.prisma.project.findMany({
        select: { id: true, name: true, runLimit: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const titles = new Map(tasks.map((task) => [task.id, task]));
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const items: QueueItemDto[] = queued.map((item, index) => {
      const task = titles.get(item.request.taskId);
      const projectId = item.projectId ?? null;
      return {
        taskId: item.request.taskId,
        title: task?.title ?? "Task",
        projectId,
        projectName: projectId ? (names.get(projectId) ?? null) : null,
        workspaceName: task?.workspace?.name ?? null,
        kind: item.kind ?? "TASK",
        priority: item.priority,
        effectivePriority: scheduler?.effectivePriority(item) ?? item.priority,
        position: index + 1,
        enqueuedAt: new Date(item.enqueuedAt).toISOString(),
        canWait: item.canWait === true,
        waiting: scheduler?.waitingReason(item.request.taskId) ?? null,
      };
    });
    const load: QueueProjectLoad[] = projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      running: active.filter((run) => run.projectId === project.id).length,
      queued: queued.filter((item) => item.projectId === project.id).length,
      limit: this.limitOf(project.id),
      ownLimit: project.runLimit,
    }));
    return {
      items,
      active: active.map((run) => ({
        taskId: run.taskId,
        title: titles.get(run.taskId)?.title ?? "Task",
        projectId: run.projectId,
        projectName: run.projectId ? (names.get(run.projectId) ?? null) : null,
        runId: run.runId,
        startedAt: new Date(run.startedAt).toISOString(),
      })),
      projects: load,
      maxConcurrent: this.deps.maxConcurrent,
      reservedSlots: scheduler?.reservedCount ?? 0,
      settings: this.settings,
    };
  }
}
