import { z } from "zod";
import { IsoDateSchema } from "./common";
import { WorkspaceDtoSchema } from "./workspaces";

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
