import { z } from "zod";
import { CHECK_RESULTS, CHECKS_STATES, PULL_REQUEST_STATES } from "../client";

export const PullRequestStateSchema = z.enum(PULL_REQUEST_STATES);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;
export const ChecksStateSchema = z.enum(CHECKS_STATES);
export type ChecksState = z.infer<typeof ChecksStateSchema>;
export const CheckResultSchema = z.enum(CHECK_RESULTS);
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const PullRequestCheckSchema = z.object({
  name: z.string(),
  result: CheckResultSchema,
  url: z.string().nullable(),
});
export type PullRequestCheck = z.infer<typeof PullRequestCheckSchema>;

export const PullRequestDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  repo: z.string(),
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  state: PullRequestStateSchema,
  draft: z.boolean(),
  checksState: ChecksStateSchema,
  checks: z.array(PullRequestCheckSchema),
  passed: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(),
  checkedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PullRequestDto = z.infer<typeof PullRequestDtoSchema>;

export const PullRequestListResponseSchema = z.object({
  repo: z.string().nullable(),
  items: z.array(PullRequestDtoSchema),
});
export type PullRequestListResponse = z.infer<typeof PullRequestListResponseSchema>;

const BranchSchema = z.string().trim().min(1).max(255);

export const PullRequestDraftQuerySchema = z.object({ branch: BranchSchema });
export type PullRequestDraftQuery = z.input<typeof PullRequestDraftQuerySchema>;

export const PullRequestDraftDtoSchema = z.object({
  repo: z.string().nullable(),
  branch: z.string(),
  baseBranch: z.string(),
  title: z.string(),
  body: z.string(),
  tasks: z.array(z.object({ id: z.string(), title: z.string() })),
  existing: PullRequestDtoSchema.nullable(),
  canCreate: z.boolean(),
  reason: z.string().nullable(),
});
export type PullRequestDraftDto = z.infer<typeof PullRequestDraftDtoSchema>;

export const CreatePullRequestRequestSchema = z.object({
  branch: BranchSchema,
  title: z.string().trim().min(1).max(256),
  body: z.string().max(60_000).default(""),
  draft: z.boolean().default(false),
});
export type CreatePullRequestRequest = z.input<typeof CreatePullRequestRequestSchema>;
