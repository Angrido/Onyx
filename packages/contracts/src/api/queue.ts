import { z } from "zod";
import { QUEUE_ITEM_KINDS, QUEUE_MOVES, QUEUE_WAIT_REASONS } from "../client";
import { IsoDateSchema } from "./common";

export const QueueWaitReasonSchema = z.enum(QUEUE_WAIT_REASONS);
export type QueueWaitReason = z.infer<typeof QueueWaitReasonSchema>;

export const QueueItemKindSchema = z.enum(QUEUE_ITEM_KINDS);
export type QueueItemKind = z.infer<typeof QueueItemKindSchema>;

export const QueueSettingsSchema = z.object({
  projectLimit: z.number().int().min(1).max(32).nullable(),
  agingMinutes: z.number().int().min(0).max(1440),
});
export type QueueSettings = z.infer<typeof QueueSettingsSchema>;

export const QueueItemDtoSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  workspaceName: z.string().nullable(),
  kind: QueueItemKindSchema,
  priority: z.number().int(),
  effectivePriority: z.number().int(),
  position: z.number().int(),
  enqueuedAt: IsoDateSchema,
  canWait: z.boolean(),
  waiting: QueueWaitReasonSchema.nullable(),
});
export type QueueItemDto = z.infer<typeof QueueItemDtoSchema>;

export const QueueActiveDtoSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  runId: z.string().nullable(),
  startedAt: IsoDateSchema,
});
export type QueueActiveDto = z.infer<typeof QueueActiveDtoSchema>;

export const QueueProjectLoadSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  running: z.number().int(),
  queued: z.number().int(),
  limit: z.number().int().nullable(),
  ownLimit: z.number().int().nullable(),
});
export type QueueProjectLoad = z.infer<typeof QueueProjectLoadSchema>;

export const QueueDtoSchema = z.object({
  items: z.array(QueueItemDtoSchema),
  active: z.array(QueueActiveDtoSchema),
  projects: z.array(QueueProjectLoadSchema),
  maxConcurrent: z.number().int(),
  reservedSlots: z.number().int(),
  settings: QueueSettingsSchema,
});
export type QueueDto = z.infer<typeof QueueDtoSchema>;

export const MoveQueuedRequestSchema = z.object({
  to: z.enum(QUEUE_MOVES),
});
export type MoveQueuedRequest = z.input<typeof MoveQueuedRequestSchema>;

export const ProjectRunLimitRequestSchema = z.object({
  limit: z.number().int().min(1).max(32).nullable(),
});
export type ProjectRunLimitRequest = z.input<typeof ProjectRunLimitRequestSchema>;
