import type {
  CreateTaskRequestSchema,
  ListTasksQuerySchema,
  RunTaskRequestSchema,
  RunTaskResponse,
  TaskDetailDto,
  TaskDto,
  TaskStatus,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { z } from "zod";
import { isActive, isRunnable } from "../domain/task-state";
import { badRequest, conflict, notFound } from "../errors";
import type { WsHub } from "../infrastructure/ws-hub";
import { RUN_INCLUDE, taskIncludeLastRun, toRunDto, toTaskDto } from "./mappers";
import type { RunScheduler } from "./run-scheduler";

type CreateTaskInput = z.output<typeof CreateTaskRequestSchema>;
type ListTasksInput = z.output<typeof ListTasksQuerySchema>;
type RunTaskInput = z.output<typeof RunTaskRequestSchema>;

export class TaskService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduler: RunScheduler,
    private readonly hub: WsHub,
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
    return { ...toTaskDto(task), runs: task.runs.map(toRunDto) };
  }

  async create(input: CreateTaskInput): Promise<TaskDto> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace || workspace.projectId !== input.projectId) {
      throw badRequest("Workspace does not belong to the project");
    }
    if (input.modelOverride) await this.assertModelEnabled(input.modelOverride);
    const task = await this.prisma.task.create({
      data: {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        title: input.title,
        prompt: input.prompt,
        kind: input.kind,
        priority: input.priority,
        modelOverride: input.modelOverride ?? null,
        targetPaths: [...new Set(input.targetPaths)],
      },
      include: taskIncludeLastRun(),
    });
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

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: "QUEUED", ...(input.modelId ? { modelOverride: input.modelId } : {}) },
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
      priority: task.priority,
      enqueuedAt: Date.now(),
    });
    return { task: toTaskDto(updated), queuePosition };
  }

  async cancel(id: string): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task");
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
