import { z } from "zod";
import { PROJECT_HEALTH } from "../client";
import { RunStatusSchema } from "../domain";
import { IsoDateSchema } from "./common";
import { TddStatusSchema } from "./tdd";

export const ProjectHealthSchema = z.enum(PROJECT_HEALTH);
export type ProjectHealth = z.infer<typeof ProjectHealthSchema>;

export const GitSummarySchema = z.object({
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  changeCount: z.number().int(),
  checkedAt: IsoDateSchema,
  error: z.string().nullable(),
});
export type GitSummary = z.infer<typeof GitSummarySchema>;

export const SpendWindowSchema = z.object({
  runs: z.number().int(),
  costUsd: z.number(),
  tokens: z.number().int(),
  cacheReadTokens: z.number().int(),
});
export type SpendWindow = z.infer<typeof SpendWindowSchema>;

export const MissionProjectDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  git: GitSummarySchema,
  running: z.number().int(),
  queued: z.number().int(),
  runLimit: z.number().int().nullable(),
  activeTasks: z.array(
    z.object({ taskId: z.string(), title: z.string(), runId: z.string().nullable() }),
  ),
  lastRun: z
    .object({
      runId: z.string(),
      taskId: z.string(),
      title: z.string(),
      status: RunStatusSchema,
      startedAt: IsoDateSchema,
      endedAt: IsoDateSchema.nullable(),
    })
    .nullable(),
  lastTdd: z
    .object({
      loopId: z.string(),
      taskId: z.string(),
      title: z.string(),
      status: TddStatusSchema,
      at: IsoDateSchema,
    })
    .nullable(),
  today: SpendWindowSchema,
  week: SpendWindowSchema,
  pendingApprovals: z.number().int(),
  openTasks: z.number().int(),
  lastActivityAt: IsoDateSchema,
  health: ProjectHealthSchema,
  reasons: z.array(z.string()),
});
export type MissionProjectDto = z.infer<typeof MissionProjectDtoSchema>;

export const MissionControlDtoSchema = z.object({
  projects: z.array(MissionProjectDtoSchema),
  running: z.number().int(),
  queued: z.number().int(),
  maxConcurrent: z.number().int(),
  pendingApprovals: z.number().int(),
  today: SpendWindowSchema,
  week: SpendWindowSchema,
  generatedAt: IsoDateSchema,
});
export type MissionControlDto = z.infer<typeof MissionControlDtoSchema>;
