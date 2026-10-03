import { z } from "zod";

export const GitChangeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "other",
]);
export type GitChangeKind = z.infer<typeof GitChangeKindSchema>;

export const GitChangeSchema = z.object({
  path: z.string(),
  kind: GitChangeKindSchema,
});
export type GitChange = z.infer<typeof GitChangeSchema>;

export const GitCommitSummarySchema = z.object({
  sha: z.string(),
  subject: z.string(),
  date: z.string(),
});
export type GitCommitSummary = z.infer<typeof GitCommitSummarySchema>;

export const GitStatusDtoSchema = z.object({
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  defaultBranch: z.string(),
  onDefaultBranch: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  changes: z.array(GitChangeSchema),
  changeCount: z.number().int(),
  lastCommit: GitCommitSummarySchema.nullable(),
  remoteUrl: z.string().nullable(),
  githubRepo: z.string().nullable(),
  compareUrl: z.string().nullable(),
  busy: z.boolean(),
  unpublishedTasks: z.array(z.object({ id: z.string(), title: z.string() })),
  suggestedBranch: z.string(),
  suggestedMessage: z.string(),
});
export type GitStatusDto = z.infer<typeof GitStatusDtoSchema>;

export const BranchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?!\/|.*(?:\/\/|\.\.|@\{|\.lock$|\/$|\.$))[A-Za-z0-9._/-]+$/, "Invalid branch name");

export const PublishChangesRequestSchema = z.object({
  branch: BranchNameSchema,
  message: z.string().trim().min(1).max(5_000),
});
export type PublishChangesRequest = z.input<typeof PublishChangesRequestSchema>;

export const PublishResultDtoSchema = z.object({
  branch: z.string(),
  commit: z.string().nullable(),
  pushed: z.boolean(),
  pushError: z.string().nullable(),
  compareUrl: z.string().nullable(),
  publishedTasks: z.number().int(),
  status: GitStatusDtoSchema,
});
export type PublishResultDto = z.infer<typeof PublishResultDtoSchema>;
