import { z } from "zod";
import { TaskKindSchema } from "../domain";
import { TaskDtoSchema } from "./tasks";

export const RoadmapPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type RoadmapPriority = z.infer<typeof RoadmapPrioritySchema>;

export const RoadmapEffortSchema = z.enum(["S", "M", "L"]);
export type RoadmapEffort = z.infer<typeof RoadmapEffortSchema>;

export const RoadmapItemStatusSchema = z.enum(["SUGGESTED", "ACCEPTED", "DISMISSED"]);
export type RoadmapItemStatus = z.infer<typeof RoadmapItemStatusSchema>;

export const RoadmapGenerationStatusSchema = z.enum(["RUNNING", "COMPLETED", "FAILED"]);
export type RoadmapGenerationStatus = z.infer<typeof RoadmapGenerationStatusSchema>;

export const RoadmapLanguageSchema = z.enum(["en", "it"]);
export type RoadmapLanguage = z.infer<typeof RoadmapLanguageSchema>;

export const RoadmapItemDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  generationId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  kind: TaskKindSchema,
  priority: RoadmapPrioritySchema,
  effort: RoadmapEffortSchema,
  workspaceName: z.string().nullable(),
  targetPaths: z.array(z.string()),
  rationale: z.string().nullable(),
  status: RoadmapItemStatusSchema,
  taskId: z.string().nullable(),
  createdAt: z.string(),
});
export type RoadmapItemDto = z.infer<typeof RoadmapItemDtoSchema>;

export const RoadmapActivitySchema = z.object({
  turns: z.number().int(),
  toolCalls: z.number().int(),
  lastAction: z.string().nullable(),
});
export type RoadmapActivity = z.infer<typeof RoadmapActivitySchema>;

export const RoadmapGenerationDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: RoadmapGenerationStatusSchema,
  modelId: z.string(),
  language: RoadmapLanguageSchema,
  focus: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  itemCount: z.number().int(),
  numTurns: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  activity: RoadmapActivitySchema.nullable(),
});
export type RoadmapGenerationDto = z.infer<typeof RoadmapGenerationDtoSchema>;

export const ProjectBoardSchema = z.object({
  projectId: z.string(),
  generation: RoadmapGenerationDtoSchema.nullable(),
  suggestions: z.array(RoadmapItemDtoSchema),
  accepted: z.array(RoadmapItemDtoSchema),
  tasks: z.array(TaskDtoSchema),
});
export type ProjectBoard = z.infer<typeof ProjectBoardSchema>;

export const GenerateRoadmapRequestSchema = z.object({
  language: RoadmapLanguageSchema.default("en"),
  focus: z.string().trim().max(2_000).optional(),
  modelId: z.string().min(1).max(128).optional(),
});
export type GenerateRoadmapRequest = z.input<typeof GenerateRoadmapRequestSchema>;

export const AcceptRoadmapItemRequestSchema = z.object({
  workspaceId: z.string().min(1).nullable().default(null),
});
export type AcceptRoadmapItemRequest = z.input<typeof AcceptRoadmapItemRequestSchema>;
