import { z } from "zod";
import { TaskDtoSchema } from "./tasks";

export const GitHubIssueDtoSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  labels: z.array(z.string()),
  author: z.string().nullable(),
  comments: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  excerpt: z.string(),
  importedTaskId: z.string().nullable(),
});
export type GitHubIssueDto = z.infer<typeof GitHubIssueDtoSchema>;

export const GitHubIssueListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(50).default(1),
  label: z.string().trim().min(1).max(50).optional(),
});
export type GitHubIssueListQuery = z.input<typeof GitHubIssueListQuerySchema>;

export const GitHubIssueListResponseSchema = z.object({
  repo: z.string().nullable(),
  page: z.number().int(),
  hasNext: z.boolean(),
  items: z.array(GitHubIssueDtoSchema),
});
export type GitHubIssueListResponse = z.infer<typeof GitHubIssueListResponseSchema>;

export const ImportIssuesRequestSchema = z.object({
  numbers: z.array(z.number().int().positive()).min(1).max(20),
  workspaceId: z.string().min(1).optional(),
});
export type ImportIssuesRequest = z.input<typeof ImportIssuesRequestSchema>;

export const ImportIssuesResponseSchema = z.object({
  items: z.array(TaskDtoSchema),
  skipped: z.array(z.object({ number: z.number().int(), reason: z.string() })),
});
export type ImportIssuesResponse = z.infer<typeof ImportIssuesResponseSchema>;
