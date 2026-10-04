import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPool, ProcessExit } from "@onyx/agent-runtime";
import {
  normalizeClaudeEvent,
  type MergeResolutionDto,
  type QaReviewDto,
  type RunItemOf,
} from "@onyx/contracts";
import type { MergeResolution, Prisma, PrismaClient, QaReview } from "@onyx/db";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import { costOfModel, usageByModel, type ModelUsageRow } from "../domain/exploration";
import { buildRunSettings, guardHooks, RUN_TOKEN_ENV } from "../domain/permission-rules";
import {
  QA_DIFF_BUDGET_TOKENS,
  QA_JSON_SCHEMA,
  QA_MAX_TURNS,
  RESOLUTION_MAX_TURNS,
  hasConflictMarkers,
  qaPrompt,
  readQaOutput,
  resolutionPrompt,
  truncateDiff,
  type QaOutcome,
} from "../domain/qa";
import { emptyMcpConfig } from "../infrastructure/mcp-config";
import type { GitRepo } from "../infrastructure/git-worktree";
import type { RunTokenRegistry } from "../infrastructure/run-tokens";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import type { CredentialService } from "./credential-service";
import { toStringArray } from "./mappers";
import { priceUsage, type RouterService } from "./router-service";
import type { SurgeonService } from "./surgeon-service";

const AGENT_TIMEOUTS = { wallClockMs: 15 * 60_000, idleMs: 5 * 60_000, initMs: 120_000 };
const MAX_DIFF_CHARS = 200_000;

export interface ReviewServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  pool: AgentPool;
  router: Pick<RouterService, "profileForTier" | "referenceProfile">;
  surgeon: Pick<SurgeonService, "runScope">;
  runTokens: RunTokenRegistry;
  credentials: Pick<CredentialService, "childEnv">;
  count: (text: string) => number;
  config: Pick<
    AppConfig,
    "runtimeDir" | "childEnvPassthrough" | "internalApiUrl" | "agentProtectedPaths"
  >;
  sourceEnv?: NodeJS.ProcessEnv;
  timeouts?: { wallClockMs: number; idleMs: number; initMs: number };
}

interface AgentResult {
  result: RunItemOf<"result"> | null;
  exit: ProcessExit;
  modelId: string;
  costUsd: number | null;
}

export function toQaReviewDto(review: QaReview): QaReviewDto {
  const criteria = Array.isArray(review.criteria) ? review.criteria : [];
  const issues = Array.isArray(review.issues) ? review.issues : [];
  return {
    id: review.id,
    attempt: review.attempt,
    verdict: review.verdict,
    summary: review.summary,
    criteria: criteria as unknown as QaReviewDto["criteria"],
    issues: issues as unknown as QaReviewDto["issues"],
    diffTokens: review.diffTokens,
    diffTruncated: review.diffTruncated,
    modelId: review.modelId,
    costUsd: review.costUsd,
    createdAt: review.createdAt.toISOString(),
  };
}

export function toResolutionDto(resolution: MergeResolution): MergeResolutionDto {
  return {
    id: resolution.id,
    state: resolution.state,
    files: toStringArray(resolution.files),
    diff: resolution.diff,
    checks: resolution.checks,
    checksPassed: resolution.checksPassed,
    modelId: resolution.modelId,
    costUsd: resolution.costUsd,
    message: resolution.message,
    createdAt: resolution.createdAt.toISOString(),
    decidedAt: resolution.decidedAt?.toISOString() ?? null,
  };
}

export class ReviewService {
  private readonly active = new Map<string, string>();

  constructor(private readonly deps: ReviewServiceDeps) {}

  async abortTask(taskId: string): Promise<void> {
    for (const [runId, owner] of this.active)
      if (owner === taskId) await this.deps.pool.abort(runId).catch(() => undefined);
  }

  async abortAll(): Promise<void> {
    for (const runId of this.active.keys())
      await this.deps.pool.abort(runId).catch(() => undefined);
  }

  async review(input: {
    orchestrationId: string;
    projectId: string;
    taskId: string;
    attempt: number;
    repo: GitRepo;
    worktree: string;
    base: string;
  }): Promise<{ row: QaReview; outcome: QaOutcome | null }> {
    const { prisma } = this.deps;
    const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId } });
    const acceptance = toStringArray(task.acceptance);
    const raw = await input.repo.run(["diff", "--no-color", `${input.base}...HEAD`, "--"], {
      cwd: input.worktree,
    });
    const diff = truncateDiff(raw, QA_DIFF_BUDGET_TOKENS, this.deps.count);
    const prompt = qaPrompt({
      title: task.title,
      description: task.prompt,
      acceptance,
      diff,
      attempt: input.attempt,
    });
    const profile = await this.deps.router.profileForTier("BUILDER");
    const modelId = profile?.id ?? (await this.deps.router.referenceProfile())?.id ?? "";
    const runId = `qa-${input.taskId}-${input.attempt}-${Date.now().toString(36)}`;
    const run = await this.runAgent({
      runId,
      taskId: input.taskId,
      projectId: input.projectId,
      cwd: input.worktree,
      prompt,
      modelId,
      maxTurns: QA_MAX_TURNS,
      permissionMode: "plan",
      allowedTools: ["Read", "Grep", "Glob", "LS"],
      disallowedTools: ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"],
      jsonSchema: JSON.stringify(QA_JSON_SCHEMA),
      purpose: "qa-review",
    });
    let outcome: QaOutcome | null = null;
    let error: string | null = null;
    if (run.exit.reason !== "completed" || !run.result) {
      error = `The review stopped before answering (${run.exit.reason})`;
    } else if (run.result.isError) {
      error = `The review failed: ${(run.result.resultText ?? run.result.subtype).slice(0, 300)}`;
    } else {
      try {
        outcome = readQaOutput(this.structured(run.result), {
          acceptance,
          files: diff.files,
        });
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
    }
    const row = await prisma.qaReview.create({
      data: {
        orchestrationId: input.orchestrationId,
        taskId: input.taskId,
        attempt: input.attempt,
        verdict: outcome?.verdict ?? "ERROR",
        summary: outcome?.summary ?? error ?? "",
        criteria: (outcome?.criteria ?? []) as unknown as Prisma.InputJsonValue,
        issues: (outcome?.issues ?? []) as unknown as Prisma.InputJsonValue,
        diffTokens: diff.tokens,
        diffTruncated: diff.truncated,
        modelId: run.modelId,
        costUsd: run.costUsd,
        inputTokens: run.result
          ? run.result.usage.inputTokens +
            run.result.usage.cacheCreationTokens +
            run.result.usage.cacheReadTokens
          : null,
        outputTokens: run.result?.usage.outputTokens ?? null,
      },
    });
    return { row, outcome };
  }

  async resolve(input: {
    orchestrationId: string;
    projectId: string;
    taskId: string;
    repo: GitRepo;
    worktree: string;
    base: string;
    branch: string;
    workBranch: string;
    excludes: readonly string[];
    commitEnv: Record<string, string>;
    checks: () => Promise<{ text: string; passed: boolean | null }>;
  }): Promise<MergeResolution> {
    const { prisma, logger } = this.deps;
    const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId } });
    const profile = await this.deps.router.profileForTier("BUILDER");
    const modelId = profile?.id ?? (await this.deps.router.referenceProfile())?.id ?? "";
    let files: string[] = [];
    const fail = (message: string, costUsd: number | null = null, diff = "") =>
      prisma.mergeResolution.create({
        data: {
          orchestrationId: input.orchestrationId,
          taskId: input.taskId,
          state: "FAILED",
          files,
          diff,
          baseCommit: input.base,
          modelId,
          costUsd,
          message,
        },
      });
    try {
      await input.repo
        .run(["merge", "--no-ff", "--no-commit", input.branch], { cwd: input.worktree })
        .catch(() => undefined);
      files = (
        await input.repo.run(["diff", "--name-only", "--diff-filter=U"], { cwd: input.worktree })
      )
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (files.length === 0) return await fail("Git found no conflict to resolve");
      const merged = await prisma.task.findMany({
        where: { parentTaskId: task.parentTaskId, mergeState: "merged" },
        select: { title: true },
        take: 20,
      });
      const run = await this.runAgent({
        runId: `resolve-${input.taskId}-${Date.now().toString(36)}`,
        taskId: input.taskId,
        projectId: input.projectId,
        cwd: input.worktree,
        prompt: resolutionPrompt({
          title: task.title,
          description: task.prompt,
          branch: input.branch,
          workBranch: input.workBranch,
          files,
          merged: merged.map((entry) => entry.title),
        }),
        modelId,
        maxTurns: RESOLUTION_MAX_TURNS,
        permissionMode: "acceptEdits",
        allowedTools: ["Read", "Grep", "Glob", "LS", "Edit", "MultiEdit", "Write"],
        disallowedTools: ["Bash", "NotebookEdit"],
        jsonSchema: null,
        purpose: "merge-resolution",
      });
      if (run.exit.reason !== "completed" || !run.result || run.result.isError)
        return await fail(
          `Claude could not resolve the conflict (${run.result?.isError ? "error" : run.exit.reason})`,
          run.costUsd,
        );
      const left: string[] = [];
      for (const file of files) {
        const content = await readFile(join(input.worktree, file), "utf8").catch(() => "");
        if (hasConflictMarkers(content)) left.push(file);
      }
      if (left.length > 0)
        return await fail(`Conflict markers are still in ${left.join(", ")}`, run.costUsd);
      const commit = await input.repo.commitAll(
        input.worktree,
        `Merge "${task.title}" (Onyx plan, conflict resolved by Claude)`,
        input.commitEnv,
        input.excludes,
      );
      if (!commit) return await fail("The resolution left nothing to commit", run.costUsd);
      await input.repo.run(["update-ref", `refs/onyx/resolutions/${input.taskId}`, commit]);
      const diff = (
        await input.repo.run(["show", "--no-color", "--format=", "--cc", commit], {
          cwd: input.worktree,
        })
      ).slice(0, MAX_DIFF_CHARS);
      const checks = await input.checks().catch((reason: unknown) => ({
        text: `The checks could not run: ${reason instanceof Error ? reason.message : String(reason)}`,
        passed: false,
      }));
      return await prisma.mergeResolution.create({
        data: {
          orchestrationId: input.orchestrationId,
          taskId: input.taskId,
          state: checks.passed === false ? "FAILED" : "PROPOSED",
          files,
          diff,
          checks: checks.text,
          checksPassed: checks.passed,
          baseCommit: input.base,
          commit,
          modelId: run.modelId,
          costUsd: run.costUsd,
          message:
            checks.passed === false ? "The tests or the type check fail on the proposal" : null,
        },
      });
    } catch (error) {
      logger.warn({ err: error, taskId: input.taskId }, "Conflict resolution failed");
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  private structured(result: RunItemOf<"result">): unknown {
    if (result.structuredOutput !== null && result.structuredOutput !== undefined)
      return result.structuredOutput;
    const text = result.resultText ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }

  private async runAgent(input: {
    runId: string;
    taskId: string;
    projectId: string;
    cwd: string;
    prompt: string;
    modelId: string;
    maxTurns: number;
    permissionMode: "plan" | "acceptEdits";
    allowedTools: string[];
    disallowedTools: string[];
    jsonSchema: string | null;
    purpose: string;
  }): Promise<AgentResult> {
    const { config, pool } = this.deps;
    const scope = await this.deps.surgeon.runScope(input.projectId, null);
    const token = this.deps.runTokens.issue(input.runId, input.projectId, {
      workspaceId: null,
      policy: scope.policy,
      guard: scope.guard,
      fence: null,
    });
    const files = await writeRuntimeFiles({
      runtimeDir: config.runtimeDir,
      runId: input.runId,
      agents: null,
      settings: buildRunSettings({
        deny: [...scope.compiled.readDeny, ...scope.compiled.editDeny],
        protectedPaths: config.agentProtectedPaths,
        hooks: guardHooks(config.internalApiUrl),
      }),
      primer: null,
      mcpConfig: emptyMcpConfig(),
    });
    let result: RunItemOf<"result"> | null = null;
    let exit: ProcessExit;
    this.active.set(input.runId, input.taskId);
    try {
      exit = await pool.run(
        {
          runId: input.runId,
          cwd: input.cwd,
          prompt: input.prompt,
          model: input.modelId,
          fallbackModels: [],
          permissionMode: input.permissionMode,
          maxTurns: input.maxTurns,
          agentsFile: files.agentsFile,
          session: { mode: "ephemeral" },
          allowedTools: input.allowedTools,
          disallowedTools: input.disallowedTools,
          settingsFile: files.settingsFile,
          mcpConfigFile: files.mcpConfigFile,
          appendSystemPromptFile: null,
          includePartialMessages: false,
          env: {
            ...this.passthroughEnv(),
            ...(await this.deps.credentials.childEnv()),
            [RUN_TOKEN_ENV]: token,
          },
          timeouts: this.deps.timeouts ?? AGENT_TIMEOUTS,
          ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}),
        },
        {
          onSpawn: () => undefined,
          onEvent: (event) => {
            for (const item of normalizeClaudeEvent(event))
              if (item.kind === "result") result = item;
          },
          onInvalidLine: () => undefined,
          onStderr: () => undefined,
          onHandlerError: (error) =>
            this.deps.logger.warn({ err: error, runId: input.runId }, "Review handler failed"),
        },
      );
    } finally {
      this.active.delete(input.runId);
      this.deps.runTokens.revoke(input.runId);
    }
    const final = result as RunItemOf<"result"> | null;
    const costUsd = final ? await this.recordUsage(input.modelId, final, input.purpose) : null;
    return { result: final, exit, modelId: input.modelId, costUsd };
  }

  private async recordUsage(
    modelId: string,
    result: RunItemOf<"result">,
    purpose: string,
  ): Promise<number | null> {
    const rows: ModelUsageRow[] = usageByModel(result, modelId);
    const profile = await this.deps.prisma.modelProfile.findUnique({ where: { id: modelId } });
    const costUsd = result.costUsd ?? (profile ? priceUsage(result.usage, profile) : null);
    await this.deps.prisma.tokenLog
      .createMany({
        data: rows.map((row) => ({
          modelId: row.modelId,
          scope: "AUX" as const,
          purpose,
          ...row.usage,
          costUsd: rows.length === 1 ? costUsd : row.costUsd,
        })),
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Review token log failed"));
    return costUsd ?? costOfModel(rows, modelId);
  }

  private passthroughEnv(): Record<string, string> {
    const source = this.deps.sourceEnv ?? process.env;
    const env: Record<string, string> = {};
    for (const name of this.deps.config.childEnvPassthrough) {
      const value = source[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }
}
