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

export const ProjectDetailDtoSchema = ProjectDtoSchema.extend({
  workspaces: z.array(WorkspaceDtoSchema),
});
export type ProjectDetailDto = z.infer<typeof ProjectDetailDtoSchema>;

export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectDtoSchema),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
