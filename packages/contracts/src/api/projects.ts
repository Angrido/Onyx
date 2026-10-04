import { z } from "zod";
import { DomainSchema } from "../domain";
import { IsoDateSchema } from "./common";
import { WorkspaceDtoSchema } from "./workspaces";

export const WorkspaceDraftSchema = z.object({
  name: z.string().trim().min(1).max(64),
  domain: DomainSchema,
  pathGlobs: z.array(z.string().trim().min(1).max(256)).min(1).max(32),
});
export type WorkspaceDraft = z.infer<typeof WorkspaceDraftSchema>;

export const WorkspaceProposalSchema = WorkspaceDraftSchema.extend({ reason: z.string() });
export type WorkspaceProposal = z.infer<typeof WorkspaceProposalSchema>;

export const WorkspaceProposalRequestSchema = z.object({
  rootPath: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((value) => value.startsWith("/"), "rootPath must be an absolute path"),
});
export type WorkspaceProposalRequest = z.input<typeof WorkspaceProposalRequestSchema>;

export const WorkspaceProposalResponseSchema = z.object({
  workspaces: z.array(WorkspaceProposalSchema),
});
export type WorkspaceProposalResponse = z.infer<typeof WorkspaceProposalResponseSchema>;

export const StackCommandSchema = z.object({
  rule: z.string(),
  command: z.string(),
  reason: z.string(),
  risky: z.boolean(),
  allowed: z.boolean(),
});
export type StackCommand = z.infer<typeof StackCommandSchema>;

export const ProjectStackDtoSchema = z.object({
  stacks: z.array(z.string()),
  packageManager: z.string().nullable(),
  commands: z.array(StackCommandSchema),
  continuationRuns: z.number().int(),
  windowDays: z.number().int(),
});
export type ProjectStackDto = z.infer<typeof ProjectStackDtoSchema>;

export const CreateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
  rootPath: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((value) => value.startsWith("/"), "rootPath must be an absolute path"),
  gitRemote: z.string().trim().max(1024).optional(),
  defaultBranch: z.string().trim().min(1).max(128).default("main"),
  createDefaultWorkspaces: z.boolean().default(true),
  proposeWorkspaces: z.boolean().default(false),
  workspaces: z.array(WorkspaceDraftSchema).max(12).optional(),
});
export type CreateProjectRequest = z.input<typeof CreateProjectRequestSchema>;

export const ProjectDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  gitRemote: z.string().nullable(),
  defaultBranch: z.string(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  workspaceCount: z.number().int(),
  taskCount: z.number().int(),
  indexedAt: IsoDateSchema.nullable(),
  indexedFiles: z.number().int().nullable(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const BashRuleSchema = z
  .string()
  .trim()
  .regex(/^Bash\([^()\n]{1,200}\)$/, "A rule looks like Bash(npm install *)");

export const ProjectDetailDtoSchema = ProjectDtoSchema.extend({
  workspaces: z.array(WorkspaceDtoSchema),
  allowedTools: z.array(z.string()),
});
export type ProjectDetailDto = z.infer<typeof ProjectDetailDtoSchema>;

export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectDtoSchema),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const UpdateAllowedToolsRequestSchema = z.object({
  allowedTools: z.array(BashRuleSchema).max(100),
});
export type UpdateAllowedToolsRequest = z.input<typeof UpdateAllowedToolsRequestSchema>;

export const AllowedToolsResponseSchema = z.object({
  allowedTools: z.array(z.string()),
});
export type AllowedToolsResponse = z.infer<typeof AllowedToolsResponseSchema>;

export const CommandRuleSuggestionSchema = z.object({
  rule: z.string(),
  program: z.string(),
  risky: z.boolean(),
  allowed: z.boolean(),
});
export type CommandRuleSuggestion = z.infer<typeof CommandRuleSuggestionSchema>;

export const BlockedCommandsResponseSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  commands: z.array(z.string()),
  suggestions: z.array(CommandRuleSuggestionSchema),
});
export type BlockedCommandsResponse = z.infer<typeof BlockedCommandsResponseSchema>;

export const AllowAndContinueRequestSchema = z.object({
  rules: z.array(BashRuleSchema).max(50),
  reply: z.string().trim().max(20_000).optional(),
});
export type AllowAndContinueRequest = z.input<typeof AllowAndContinueRequestSchema>;
