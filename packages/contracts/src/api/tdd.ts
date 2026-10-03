import { z } from "zod";
import { TEST_RUNNERS } from "../client";

export const TestRunnerSchema = z.enum(TEST_RUNNERS);
export type TestRunner = z.infer<typeof TestRunnerSchema>;

export const TddStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "GREEN",
  "EXHAUSTED",
  "STALLED",
  "ABORTED",
  "FAILED",
]);
export type TddStatus = z.infer<typeof TddStatusSchema>;

export const TDD_FINAL_STATUSES: readonly TddStatus[] = [
  "GREEN",
  "EXHAUSTED",
  "STALLED",
  "ABORTED",
  "FAILED",
];

export const TddPhaseSchema = z.enum(["preparing", "tests", "gates", "agent", "guard"]);
export type TddPhase = z.infer<typeof TddPhaseSchema>;

export const TddScopeSchema = z.enum(["related", "full", "typecheck", "lint", "run", "guard"]);
export type TddScope = z.infer<typeof TddScopeSchema>;

export const TddGatesSchema = z.object({
  typecheck: z.string().nullable(),
  lint: z.string().nullable(),
});
export type TddGates = z.infer<typeof TddGatesSchema>;

export const TddIterationDtoSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  scope: TddScopeSchema,
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  durationMs: z.number().int(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  failureSignature: z.string().nullable(),
  digest: z.string().nullable(),
  digestTokens: z.number().int().nullable(),
  regressions: z.number().int(),
  revertedFiles: z.array(z.string()),
  escalated: z.boolean(),
  agentRunId: z.string().nullable(),
  agentModelId: z.string().nullable(),
  agentStatus: z.string().nullable(),
  agentCostUsd: z.number().nullable(),
  createdAt: z.string(),
});
export type TddIterationDto = z.infer<typeof TddIterationDtoSchema>;

export const TddLoopDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  terminalId: z.string(),
  runner: TestRunnerSchema,
  relatedCommand: z.string(),
  fullCommand: z.string(),
  gates: TddGatesSchema,
  relatedFiles: z.array(z.string()),
  maxIterations: z.number().int(),
  budgetUsd: z.number().nullable(),
  testTimeoutSec: z.number().int(),
  status: TddStatusSchema,
  phase: TddPhaseSchema.nullable(),
  iterationCount: z.number().int(),
  violations: z.number().int(),
  protectedFiles: z.number().int(),
  costUsd: z.number(),
  message: z.string().nullable(),
  escalatedAt: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  greenAt: z.string().nullable(),
  iterations: z.array(TddIterationDtoSchema),
});
export type TddLoopDto = z.infer<typeof TddLoopDtoSchema>;

export const TddLoopListResponseSchema = z.object({ items: z.array(TddLoopDtoSchema) });
export type TddLoopListResponse = z.infer<typeof TddLoopListResponseSchema>;

export const TddDefaultsDtoSchema = z.object({
  runner: TestRunnerSchema.nullable(),
  baseCommand: z.string().nullable(),
  relatedFiles: z.array(z.string()),
  typecheckCommand: z.string().nullable(),
  lintCommand: z.string(),
  protectedFiles: z.number().int(),
  activeLoopId: z.string().nullable(),
});
export type TddDefaultsDto = z.infer<typeof TddDefaultsDtoSchema>;

export const StartTddLoopRequestSchema = z.object({
  runner: TestRunnerSchema.optional(),
  maxIterations: z.number().int().min(1).max(20).default(6),
  budgetUsd: z.number().positive().max(1_000).nullable().default(null),
  testTimeoutSec: z.number().int().min(10).max(3_600).default(300),
  typecheck: z.boolean().optional(),
  lint: z.boolean().default(false),
  relatedFiles: z.array(z.string().trim().min(1).max(1_024)).max(50).optional(),
});
export type StartTddLoopRequest = z.input<typeof StartTddLoopRequestSchema>;
