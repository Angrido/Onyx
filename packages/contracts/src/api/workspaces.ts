import { z } from "zod";
import { TestRunnerSchema } from "./tdd";
import {
  DomainSchema,
  ResetStrategySchema,
  SessionEndReasonSchema,
  SessionStatusSchema,
} from "../domain";

const GlobListSchema = z.array(z.string().trim().min(1).max(512)).max(64);

export const WorkspaceDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  domain: DomainSchema,
  pathGlobs: z.array(z.string()),
  writeFenceGlobs: z.array(z.string()),
  primer: z.string().nullable(),
  resetStrategy: ResetStrategySchema,
  maxSessionTokens: z.number().int(),
  agentConfigId: z.string().nullable(),
  testRunner: TestRunnerSchema.nullable(),
  testCommand: z.string().nullable(),
  activeSessionId: z.string().nullable(),
  color: z.string().nullable(),
  position: z.number().int(),
});
export type WorkspaceDto = z.infer<typeof WorkspaceDtoSchema>;

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
  domain: DomainSchema,
  pathGlobs: GlobListSchema.min(1),
  writeFenceGlobs: GlobListSchema.optional(),
  primer: z.string().max(20_000).optional(),
  resetStrategy: ResetStrategySchema.default("HANDOFF"),
  maxSessionTokens: z.number().int().min(10_000).max(1_000_000).default(150_000),
  agentConfigId: z.string().optional(),
  color: z.string().max(32).optional(),
});
export type CreateWorkspaceRequest = z.input<typeof CreateWorkspaceRequestSchema>;

export const UpdateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  pathGlobs: GlobListSchema.min(1).optional(),
  writeFenceGlobs: GlobListSchema.optional(),
  primer: z.string().max(20_000).nullable().optional(),
  resetStrategy: ResetStrategySchema.optional(),
  maxSessionTokens: z.number().int().min(10_000).max(1_000_000).optional(),
  agentConfigId: z.string().nullable().optional(),
  testRunner: TestRunnerSchema.nullable().optional(),
  testCommand: z.string().trim().max(512).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
});
export type UpdateWorkspaceRequest = z.input<typeof UpdateWorkspaceRequestSchema>;

export const SessionDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  claudeSessionId: z.string().nullable(),
  modelId: z.string(),
  status: SessionStatusSchema,
  endReason: SessionEndReasonSchema.nullable(),
  previousId: z.string().nullable(),
  handoffNote: z.string().nullable(),
  handoffTokens: z.number().int().nullable(),
  runs: z.number().int(),
  turns: z.number().int(),
  contextTokens: z.number().int(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  endedAt: z.string().nullable(),
});
export type SessionDto = z.infer<typeof SessionDtoSchema>;

export const ResetWorkspaceRequestSchema = z.object({
  handoff: z.boolean().default(true),
});
export type ResetWorkspaceRequest = z.input<typeof ResetWorkspaceRequestSchema>;

export const SessionListResponseSchema = z.object({ items: z.array(SessionDtoSchema) });
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const ResetWorkspaceResponseSchema = z.object({
  workspace: WorkspaceDtoSchema,
  session: SessionDtoSchema.nullable(),
});
export type ResetWorkspaceResponse = z.infer<typeof ResetWorkspaceResponseSchema>;
