import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MergeResolutionDto, QaReviewDto } from "@onyx/contracts";
import type { MergeResolution, Prisma, PrismaClient, QaReview } from "@onyx/db";
import type { Logger } from "pino";
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
import type { GitRepo } from "../infrastructure/git-worktree";
import { READ_ONLY_TOOLS, WRITE_TOOLS, structuredOf, type AgentRunner } from "./agent-runner";
import { toStringArray } from "./mappers";
import type { RouterService } from "./router-service";

const MAX_DIFF_CHARS = 200_000;

export interface ReviewServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  runner: AgentRunner;
  router: Pick<RouterService, "profileForTier" | "referenceProfile">;
  count: (text: string) => number;
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
  constructor(private readonly deps: ReviewServiceDeps) {}

  async abortTask(taskId: string): Promise<void> {
    await this.deps.runner.abortOwner(taskId);
  }

  async abortAll(): Promise<void> {
    await this.deps.runner.abortAll();
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
    const run = await this.deps.runner.run({
      runId,
      owner: input.taskId,
      projectId: input.projectId,
      cwd: input.worktree,
      prompt,
      modelId,
      maxTurns: QA_MAX_TURNS,
      permissionMode: "plan",
      allowedTools: READ_ONLY_TOOLS,
      disallowedTools: WRITE_TOOLS,
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
        outcome = readQaOutput(structuredOf(run.result), {
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
        .run(["merge", "--no-ff", "--no-commit", input.branch], {
          cwd: input.worktree,
          env: input.commitEnv,
        })
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
      const run = await this.deps.runner.run({
        runId: `resolve-${input.taskId}-${Date.now().toString(36)}`,
        owner: input.taskId,
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
        allowedTools: [...READ_ONLY_TOOLS, "Edit", "MultiEdit", "Write"],
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
}
