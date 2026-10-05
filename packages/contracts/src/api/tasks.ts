import { z } from "zod";
import { RunStatusSchema, TaskKindSchema, TaskStatusSchema } from "../domain";
import { PullRequestDtoSchema } from "./pulls";
import { RunDtoSchema } from "./runs";

export const RunSummaryDtoSchema = z.object({
  id: z.string(),
  status: RunStatusSchema,
  modelId: z.string(),
  costUsd: z.number().nullable(),
  changedFileCount: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type RunSummaryDto = z.infer<typeof RunSummaryDtoSchema>;

export const CreateTaskRequestSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().default(null),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(100_000),
  kind: TaskKindSchema.default("FEATURE"),
  priority: z.number().int().min(-100).max(100).default(0),
  modelOverride: z.string().min(1).max(128).optional(),
  targetPaths: z.array(z.string().trim().min(1).max(1024)).max(32).default([]),
  canWait: z.boolean().default(false),
});
export type CreateTaskRequest = z.input<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    canWait: z.boolean().optional(),
    priority: z.number().int().min(-100).max(100).optional(),
  })
  .refine((input) => input.canWait !== undefined || input.priority !== undefined, {
    message: "Nothing to change",
  });
export type UpdateTaskRequest = z.input<typeof UpdateTaskRequestSchema>;

export const RunTaskRequestSchema = z.object({
  modelId: z.string().min(1).max(128).optional(),
  agentConfigId: z.string().min(1).optional(),
  prompt: z.string().trim().min(1).max(100_000).optional(),
  newSession: z.boolean().default(false),
});
export type RunTaskRequest = z.input<typeof RunTaskRequestSchema>;

export const TaskIssueSchema = z.object({
  repo: z.string(),
  number: z.number().int(),
  url: z.string(),
  labels: z.array(z.string()),
});
export type TaskIssue = z.infer<typeof TaskIssueSchema>;

export const TaskDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  workspaceId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  title: z.string(),
  prompt: z.string(),
  kind: TaskKindSchema,
  status: TaskStatusSchema,
  priority: z.number().int(),
  modelOverride: z.string().nullable(),
  targetPaths: z.array(z.string()),
  branchName: z.string().nullable(),
  canWait: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  lastRun: RunSummaryDtoSchema.nullable(),
  issue: TaskIssueSchema.nullable(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const TaskDetailDtoSchema = TaskDtoSchema.extend({
  runs: z.array(RunDtoSchema),
  pullRequest: PullRequestDtoSchema.nullable(),
});
export type TaskDetailDto = z.infer<typeof TaskDetailDtoSchema>;

export const ListTasksQuerySchema = z.object({
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
  status: TaskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTasksQuery = z.input<typeof ListTasksQuerySchema>;

export const TaskListResponseSchema = z.object({
  items: z.array(TaskDtoSchema),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const RunTaskResponseSchema = z.object({
  task: TaskDtoSchema,
  queuePosition: z.number().int(),
});
export type RunTaskResponse = z.infer<typeof RunTaskResponseSchema>;
