import type {
  CreateTaskRequestSchema,
  ListTasksQuerySchema,
  PullRequestDto,
  RunTaskRequestSchema,
  RunTaskResponse,
  TaskDetailDto,
  TaskDto,
  TaskKind,
  TaskStatus,
  UpdateTaskRequestSchema,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { z } from "zod";
import { RUNNABLE_STATUSES, isActive, isRunnable } from "../domain/task-state";
import { isSmallTask } from "../domain/batch";
import { badRequest, conflict, notFound } from "../errors";
import type { WsHub } from "../infrastructure/ws-hub";
import { RUN_INCLUDE, taskIncludeLastRun, toRunDto, toStringArray, toTaskDto } from "./mappers";
import { runLockKey, type RunScheduler } from "./run-scheduler";

type CreateTaskInput = z.output<typeof CreateTaskRequestSchema>;
type ListTasksInput = z.output<typeof ListTasksQuerySchema>;
type RunTaskInput = z.output<typeof RunTaskRequestSchema>;
type UpdateTaskInput = z.output<typeof UpdateTaskRequestSchema>;

export interface TaskIssueOrigin {
  repo: string;
  number: number;
  url: string;
  labels: readonly string[];
}

export type PullRequestLookup = (task: {
  id: string;
  projectId: string;
  branchName: string | null;
}) => Promise<PullRequestDto | null>;

export class TaskService {
  pullRequestOf: PullRequestLookup | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduler: RunScheduler,
    private readonly hub: WsHub,
    private readonly inferWorkspace: (
      projectId: string,
      targetPaths: readonly string[],
      prompt: string,
      kind: TaskKind,
    ) => Promise<string | null>,
    private readonly abortLoop: (taskId: string, actor: string) => Promise<boolean> = () =>
      Promise.resolve(false),
  ) {}

  async list(query: ListTasksInput): Promise<TaskDto[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: taskIncludeLastRun(),
      orderBy: [{ updatedAt: "desc" }],
      take: query.limit,
    });
    return tasks.map(toTaskDto);
  }

  async get(id: string): Promise<TaskDetailDto> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { runs: { orderBy: { startedAt: "desc" }, include: RUN_INCLUDE } },
    });
    if (!task) throw notFound("Task");
    const pullRequest = this.pullRequestOf ? await this.pullRequestOf(task) : null;
    return { ...toTaskDto(task), runs: task.runs.map(toRunDto), pullRequest };
  }

  async create(input: CreateTaskInput, issue?: TaskIssueOrigin): Promise<TaskDto> {
    const workspaceId =
      input.workspaceId ??
      (await this.inferWorkspace(
        input.projectId,
        input.targetPaths,
        `${input.title}\n${input.prompt}`,
        input.kind,
      ));
    if (workspaceId === null) {
      throw badRequest("This project has no workspaces: add one from the project page");
    }
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace || workspace.projectId !== input.projectId) {
      throw badRequest("Workspace does not belong to the project");
    }
    if (input.modelOverride) await this.assertModelEnabled(input.modelOverride);
    const task = await this.prisma.task.create({
      data: {
        projectId: input.projectId,
        workspaceId,
        title: input.title,
        prompt: input.prompt,
        kind: input.kind,
        priority: input.priority,
        modelOverride: input.modelOverride ?? null,
        targetPaths: [...new Set(input.targetPaths)],
        canWait: input.canWait,
        ...(issue
          ? {
              issueRepo: issue.repo,
              issueNumber: issue.number,
              issueUrl: issue.url,
              issueLabels: [...issue.labels],
            }
          : {}),
      },
      include: taskIncludeLastRun(),
    });
    return toTaskDto(task);
  }

  async update(id: string, input: UpdateTaskInput): Promise<TaskDto> {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw notFound("Task");
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...(input.canWait !== undefined ? { canWait: input.canWait } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      },
      include: taskIncludeLastRun(),
    });
    if (input.canWait !== undefined) this.scheduler.setCanWait(id, input.canWait);
    if (input.priority !== undefined && this.scheduler.isQueued(id))
      this.scheduler.setPriority(id, input.priority);
    return toTaskDto(task);
  }

  async requestRun(id: string, input: RunTaskInput): Promise<RunTaskResponse> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task");
    if (!task.workspaceId) throw badRequest("Task has no workspace");
    if (!isRunnable(task.status)) throw conflict(`Task is ${task.status.toLowerCase()}`);
    if (input.modelId) await this.assertModelEnabled(input.modelId);
    if (input.agentConfigId) {
      const config = await this.prisma.agentConfig.findUnique({
        where: { id: input.agentConfigId },
      });
      if (!config) throw badRequest("Agent configuration not found");
    }

    if (this.scheduler.isQueued(id) || this.scheduler.activeRunOf(id) !== null)
      throw conflict("Task is already queued or running");
    const claimed = await this.prisma.task.updateMany({
      where: { id, status: { in: [...RUNNABLE_STATUSES] } },
      data: { status: "QUEUED", ...(input.modelId ? { modelOverride: input.modelId } : {}) },
    });
    if (claimed.count !== 1) throw conflict("Task is already queued or running");
    const updated = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      include: taskIncludeLastRun(),
    });
    this.publish(updated.id, updated.projectId, "QUEUED");
    const queuePosition = this.scheduler.enqueue({
      request: {
        taskId: id,
        modelId: input.modelId ?? null,
        agentConfigId: input.agentConfigId ?? null,
        prompt: input.prompt ?? null,
        newSession: input.newSession,
      },
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      lockKey: runLockKey({ ...task, workspaceId: task.workspaceId }),
      priority: task.priority,
      canWait: task.canWait,
      small:
        !input.prompt &&
        !input.modelId &&
        !input.agentConfigId &&
        !input.newSession &&
        isSmallTask({ ...task, targetPaths: toStringArray(task.targetPaths) }),
      enqueuedAt: Date.now(),
    });
    return { task: toTaskDto(updated), queuePosition };
  }

  async requeue(id: string): Promise<void> {
    const task = await this.prisma.task.update({
      where: { id },
      data: { status: "QUEUED", batchRunId: null },
    });
    if (!task.workspaceId) return;
    this.publish(task.id, task.projectId, "QUEUED");
    this.scheduler.enqueue({
      request: { taskId: id, modelId: null, agentConfigId: null, prompt: null, newSession: false },
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      lockKey: runLockKey({ ...task, workspaceId: task.workspaceId }),
      priority: task.priority,
      canWait: task.canWait,
      small: false,
      enqueuedAt: Date.now(),
    });
  }

  async cancel(id: string, actor = "user:unknown"): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task");
    if (task.status === "TDD_LOOP" && (await this.abortLoop(id, actor))) return this.get(id);
    if (task.status === "QUEUED" && this.scheduler.removeQueued(id)) {
      const cancelled = await this.prisma.task.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: taskIncludeLastRun(),
      });
      this.publish(id, task.projectId, "CANCELLED");
      return toTaskDto(cancelled);
    }
    if (await this.scheduler.abortTask(id)) {
      await this.scheduler.settledTask(id);
      return this.get(id);
    }
    if (task.status === "QUEUED" || task.status === "INTERRUPTED") {
      const cancelled = await this.prisma.task.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: taskIncludeLastRun(),
      });
      this.publish(id, task.projectId, "CANCELLED");
      return toTaskDto(cancelled);
    }
    throw conflict(`Task is ${task.status.toLowerCase()}`);
  }

  async remove(id: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task");
    if (isActive(task.status)) throw conflict("Cancel the task before deleting it");
    await this.prisma.task.delete({ where: { id } });
  }

  private async assertModelEnabled(modelId: string): Promise<void> {
    const profile = await this.prisma.modelProfile.findUnique({ where: { id: modelId } });
    if (!profile || !profile.enabled) throw badRequest(`Model ${modelId} is not enabled`);
  }

  private publish(taskId: string, projectId: string, status: TaskStatus): void {
    this.hub.publishTaskStatus({ taskId, projectId, status, runId: null });
  }
}
