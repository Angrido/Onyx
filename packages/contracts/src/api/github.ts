import { z } from "zod";

export const GitHubTokenSourceSchema = z.enum(["env", "settings"]);
export type GitHubTokenSource = z.infer<typeof GitHubTokenSourceSchema>;

export const GitHubAccountDtoSchema = z.object({
  connected: z.boolean(),
  source: GitHubTokenSourceSchema.nullable(),
  login: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type GitHubAccountDto = z.infer<typeof GitHubAccountDtoSchema>;

export const ConnectGitHubRequestSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "This does not look like a GitHub token")
    .max(255)
    .regex(/^[A-Za-z0-9_]+$/, "This does not look like a GitHub token"),
});
export type ConnectGitHubRequest = z.input<typeof ConnectGitHubRequestSchema>;

export const GitHubRepoDtoSchema = z.object({
  fullName: z.string(),
  owner: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  fork: z.boolean(),
  archived: z.boolean(),
  defaultBranch: z.string(),
  language: z.string().nullable(),
  sizeKb: z.number().int(),
  pushedAt: z.string().nullable(),
  htmlUrl: z.string(),
  importedProjectId: z.string().nullable(),
});
export type GitHubRepoDto = z.infer<typeof GitHubRepoDtoSchema>;

const GitHubLoginSchema = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "Invalid GitHub user or organization");

export const GitHubRepoListQuerySchema = z.object({
  owner: GitHubLoginSchema.optional(),
  refresh: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => value === "true" || value === "1"),
});
export type GitHubRepoListQuery = z.input<typeof GitHubRepoListQuerySchema>;

export const GitHubRepoListResponseSchema = z.object({
  owner: z.string().nullable(),
  items: z.array(GitHubRepoDtoSchema),
  truncated: z.boolean(),
});
export type GitHubRepoListResponse = z.infer<typeof GitHubRepoListResponseSchema>;

export const ImportRepoRequestSchema = z.object({
  fullName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "Use the owner/repository form"),
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, dots, dashes or underscores")
    .optional(),
  branch: z.string().trim().min(1).max(255).optional(),
  createDefaultWorkspaces: z.boolean().default(true),
  proposeWorkspaces: z.boolean().default(false),
});
export type ImportRepoRequest = z.input<typeof ImportRepoRequestSchema>;

export const CloneJobStateSchema = z.enum(["cloning", "registering", "done", "failed"]);
export type CloneJobState = z.infer<typeof CloneJobStateSchema>;

export const CloneJobDtoSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  name: z.string(),
  branch: z.string().nullable(),
  targetPath: z.string(),
  state: CloneJobStateSchema,
  phase: z.string().nullable(),
  percent: z.number().int().min(0).max(100).nullable(),
  projectId: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type CloneJobDto = z.infer<typeof CloneJobDtoSchema>;

export const CloneJobListResponseSchema = z.object({ items: z.array(CloneJobDtoSchema) });
export type CloneJobListResponse = z.infer<typeof CloneJobListResponseSchema>;
