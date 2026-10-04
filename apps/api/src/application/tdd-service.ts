import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { appendFile, chmod, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { PtySession, TextTail, type ProcessTracker } from "@onyx/agent-runtime";
import type {
  StartTddLoopRequestSchema,
  TaskStatus,
  TddDefaultsDto,
  TddGates,
  TddLoopDto,
  TddPhase,
  TddScope,
  TddStatus,
  TestRunner,
} from "@onyx/contracts";
import type { Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import type { AppConfig } from "../config";
import { raiseTier, TIER_ORDER, type RoutingEscalation } from "../domain/routing/decide";
import { isActive } from "../domain/task-state";
import { baselineKey, baselineLabel, ignoredNote, splitBaseline } from "../domain/tdd/baseline";
import { buildDigest, DIGEST_BUDGET_TOKENS } from "../domain/tdd/digest";
import { commandFailure, parseLintOutput, parseTypecheckOutput } from "../domain/tdd/gates";
import {
  buildFixPrompt,
  decideNext,
  initialProgress,
  markEscalated,
  NO_PROGRESS_BEFORE_ESCALATION,
  observe,
  recordFix,
  regressionsOf,
  type LoopProgress,
  type TddStage,
} from "../domain/tdd/loop-policy";
import { failureId, parseJsonReport, PathResolver, type TestFailure } from "../domain/tdd/report";
import {
  binaryInvocation,
  defaultLintCommand,
  defaultTypecheckCommand,
  detectPackageManager,
  detectRunner,
  testCommandLine,
} from "../domain/tdd/runners";
import { TestGuard } from "../domain/tdd/test-guard";
import { badRequest, conflict, notFound } from "../errors";
import { msg, tx } from "../i18n";
import {
  listProjectFiles,
  ProtectedSnapshot,
  type ProtectedChange,
} from "../infrastructure/protected-files";
import { ptyOutputMessage, tddStateMessage, type WsHub } from "../infrastructure/ws-hub";
import { parsePorcelain } from "./git-service";
import { toStringArray } from "./mappers";
import type { ExecutionResult } from "./run-executor";
import { runLockKey, type RunScheduler } from "./run-scheduler";
import type { RouterService } from "./router-service";
import { gitEnvironment, safeGitArgs } from "../infrastructure/git-env";

type StartInput = z.output<typeof StartTddLoopRequestSchema>;

export interface TddServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  hub: WsHub;
  scheduler: Pick<
    RunScheduler,
    "hold" | "runAndWait" | "abortTask" | "removeQueued" | "isWorkspaceBusy"
  >;
  router: Pick<RouterService, "autoEscalate">;
  config: Pick<AppConfig, "runtimeDir" | "childEnvPassthrough" | "agentSandbox">;
  estimate: (text: string) => number;
  onGreen?: (loop: { projectId: string; fullCommand: string; runId: string | null }) => void;
  sourceEnv?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  tracker?: ProcessTracker | null;
}

interface CommandResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

interface Evaluation {
  stage: TddStage;
  green: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
  passedIds: string[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  noTests: boolean;
}

type CommandTarget = Pick<
  ActiveLoop,
  "id" | "root" | "testTimeoutSec" | "aborted" | "session" | "output"
>;

export interface TddStartOptions {
  ignoreFailures?: readonly string[];
}

interface ActiveLoop {
  id: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  root: string;
  runner: TestRunner;
  base: string;
  gates: TddGates;
  relatedFiles: string[];
  maxIterations: number;
  budgetUsd: number | null;
  testTimeoutSec: number;
  taskTitle: string;
  taskPrompt: string;
  holdId: string;
  lockKey: string;
  release: () => void;
  guard: TestGuard;
  snapshot: ProtectedSnapshot;
  paths: PathResolver;
  phase: TddPhase | null;
  aborted: boolean;
  session: PtySession | null;
  output: TextTail;
  spentUsd: number;
  iterationCount: number;
  violations: number;
  finished: boolean;
  done: Promise<void>;
  baseline: ReadonlySet<string>;
  ignoredLabels: Map<string, string>;
}

const OUTPUT_TAIL_CHARS = 256_000;
const PTY_COLS = 120;
const PTY_ROWS = 32;
const MAX_RELATED_FILES = 50;
const MAX_SOURCE_BYTES = 512_000;
const RECENT_OUTPUTS = 20;
const LOG_TAIL_BYTES = 256_000;
const SHELL = "/bin/sh";
const ACCENT = "\u001b[1;35m";
const GREEN = "\u001b[1;32m";
const YELLOW = "\u001b[1;33m";
const RED = "\u001b[1;31m";
const RESET = "\u001b[0m";
const execFileAsync = promisify(execFile);

const LOOP_INCLUDE = {
  workspace: { select: { name: true } },
  task: { select: { projectId: true } },
  iterations: {
    orderBy: { index: "asc" },
    include: { agentRun: { select: { modelId: true, status: true, costUsd: true } } },
  },
} satisfies Prisma.TddLoopInclude;

type LoopRow = Prisma.TddLoopGetPayload<{ include: typeof LOOP_INCLUDE }>;

const FINAL_TASK_STATUS: Readonly<Record<TddStatus, TaskStatus>> = {
  PENDING: "TDD_LOOP",
  RUNNING: "TDD_LOOP",
  GREEN: "COMPLETED",
  EXHAUSTED: "FAILED",
  STALLED: "FAILED",
  ABORTED: "CANCELLED",
  FAILED: "FAILED",
};

const STAGE_LABEL: Readonly<Record<TddStage, string>> = {
  run: "test runner",
  related: "related tests",
  full: "full test suite",
  typecheck: "type check",
  lint: "lint",
};

const FIXED_TEXTS: ReadonlySet<string> = new Set([
  msg("Stopped by the operator"),
  msg("The test runner found no tests to run"),
  msg("Already green: tests and gates passed before any fix"),
  msg("Interrupted by an Onyx restart"),
]);

function localizeLoop(loop: TddLoopDto): TddLoopDto {
  return loop.message !== null && FIXED_TEXTS.has(loop.message)
    ? { ...loop, message: tx(loop.message) }
    : loop;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function terminalIdOf(loopId: string): string {
  return `tdd-${loopId}`;
}

function parseGates(value: unknown): TddGates {
  if (typeof value !== "object" || value === null) return { typecheck: null, lint: null };
  const record = value as Record<string, unknown>;
  return {
    typecheck: typeof record["typecheck"] === "string" ? record["typecheck"] : null,
    lint: typeof record["lint"] === "string" ? record["lint"] : null,
  };
}

function toLoopDto(row: LoopRow, phase: TddPhase | null): TddLoopDto {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.task.projectId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspace.name,
    terminalId: terminalIdOf(row.id),
    runner: row.runner,
    relatedCommand: row.relatedCommand,
    fullCommand: row.fullCommand,
    gates: parseGates(row.gates),
    relatedFiles: toStringArray(row.relatedFiles),
    maxIterations: row.maxIterations,
    budgetUsd: row.budgetUsd,
    testTimeoutSec: row.testTimeoutSec,
    status: row.status,
    phase,
    iterationCount: row.iterationCount,
    violations: row.violations,
    protectedFiles: row.protectedFiles,
    costUsd: row.costUsd,
    message: row.message,
    escalatedAt: iso(row.escalatedAt),
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    greenAt: iso(row.greenAt),
    iterations: row.iterations.map((iteration) => ({
      id: iteration.id,
      index: iteration.index,
      scope: iteration.scope as TddScope,
      passed: iteration.passed,
      failed: iteration.failed,
      skipped: iteration.skipped,
      durationMs: iteration.durationMs,
      exitCode: iteration.exitCode,
      timedOut: iteration.timedOut,
      failureSignature: iteration.failureSignature,
      digest: iteration.digest,
      digestTokens: iteration.digestTokens,
      regressions: iteration.regressions,
      revertedFiles: toStringArray(iteration.revertedFiles),
      escalated: iteration.escalated,
      agentRunId: iteration.agentRunId,
      agentModelId: iteration.agentRun?.modelId ?? null,
      agentStatus: iteration.agentRun?.status ?? null,
      agentCostUsd: iteration.agentRun?.costUsd ?? null,
      createdAt: iteration.createdAt.toISOString(),
    })),
  };
}

export class TddService {
  private readonly active = new Map<string, ActiveLoop>();
  private readonly outputs = new Map<string, TextTail>();
  private readonly states = new Map<string, TddLoopDto>();
  private stopped = false;

  constructor(private readonly deps: TddServiceDeps) {
    deps.hub.registerSnapshot("pty:tdd-", (channel) => {
      const loopId = channel.slice("pty:tdd-".length);
      const output = this.outputs.get(loopId)?.toString() ?? this.logTail(loopId);
      return output.length > 0 ? [ptyOutputMessage(terminalIdOf(loopId), output, true)] : [];
    });
    deps.hub.registerSnapshot("tdd:", (channel) => {
      const state = this.states.get(channel.slice("tdd:".length));
      return state ? [tddStateMessage(localizeLoop(state))] : [];
    });
  }

  isActiveForTask(taskId: string): string | null {
    for (const loop of this.active.values()) if (loop.taskId === taskId) return loop.id;
    return null;
  }

  async defaults(taskId: string): Promise<TddDefaultsDto> {
    const { task, workspace } = await this.loadTask(taskId);
    const root = task.worktreePath ?? task.project.rootPath;
    const facts = await this.projectFacts(root);
    const runner = workspace.testRunner ?? detectRunner(facts);
    return {
      runner,
      baseCommand: runner ? this.baseCommand(runner, workspace.testCommand, facts.binaries) : null,
      relatedFiles: await this.defaultRelatedFiles(root, task.targetPaths),
      typecheckCommand: facts.files.has("tsconfig.json")
        ? defaultTypecheckCommand(facts.binaries)
        : null,
      lintCommand: defaultLintCommand(
        facts.packageJson,
        detectPackageManager(facts.files),
        facts.binaries,
      ),
      protectedFiles: await this.countProtected(root),
      activeLoopId: this.isActiveForTask(taskId),
    };
  }

  async list(taskId: string): Promise<TddLoopDto[]> {
    const rows = await this.deps.prisma.tddLoop.findMany({
      where: { taskId },
      include: LOOP_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((row) => localizeLoop(toLoopDto(row, this.active.get(row.id)?.phase ?? null)));
  }

  async get(loopId: string): Promise<TddLoopDto> {
    return localizeLoop(await this.load(loopId));
  }

  private async load(loopId: string): Promise<TddLoopDto> {
    const row = await this.deps.prisma.tddLoop.findUnique({
      where: { id: loopId },
      include: LOOP_INCLUDE,
    });
    if (!row) throw notFound("TDD loop");
    return toLoopDto(row, this.active.get(row.id)?.phase ?? null);
  }

  async start(
    taskId: string,
    input: StartInput,
    actor: string,
    options: TddStartOptions = {},
  ): Promise<TddLoopDto> {
    const { prisma, scheduler } = this.deps;
    if (this.stopped) throw conflict("Onyx is shutting down");
    const { task, workspace } = await this.loadTask(taskId);
    if (isActive(task.status)) throw conflict(`Task is ${task.status.toLowerCase()}`);
    if (this.isActiveForTask(taskId)) throw conflict("A TDD loop is already running for this task");
    const root = task.worktreePath ?? task.project.rootPath;
    const facts = await this.projectFacts(root);
    const runner = input.runner ?? workspace.testRunner ?? detectRunner(facts);
    if (!runner)
      throw badRequest(
        "No test runner found: add Vitest or Jest to the project or choose the runner",
      );
    const base = this.baseCommand(runner, workspace.testCommand, facts.binaries);
    const typecheckEnabled = input.typecheck ?? facts.files.has("tsconfig.json");
    const gates: TddGates = {
      typecheck: typecheckEnabled ? defaultTypecheckCommand(facts.binaries) : null,
      lint: input.lint
        ? defaultLintCommand(facts.packageJson, detectPackageManager(facts.files), facts.binaries)
        : null,
    };
    const relatedFiles = (
      input.relatedFiles ?? (await this.defaultRelatedFiles(root, task.targetPaths))
    ).slice(0, MAX_RELATED_FILES);

    const lockKey = runLockKey({ ...task, workspaceId: workspace.id });
    const hold = scheduler.hold(lockKey);
    if (!hold.ok)
      throw conflict(
        hold.reason === "busy"
          ? `The ${workspace.name} workspace is busy: wait for its run or close its terminal`
          : "Onyx is shutting down",
      );

    let created: { id: string } | null = null;
    try {
      created = await prisma.tddLoop.create({
        data: {
          taskId,
          workspaceId: workspace.id,
          runner,
          relatedCommand: "",
          fullCommand: "",
          gates,
          maxIterations: input.maxIterations,
          budgetUsd: input.budgetUsd,
          testTimeoutSec: input.testTimeoutSec,
          relatedFiles,
          status: "PENDING",
        },
        select: { id: true },
      });
      const loopId = created.id;
      const directory = await this.prepareLoopDirectory(loopId);
      const guard = new TestGuard(root);
      const snapshot = await ProtectedSnapshot.capture(root, join(directory, "snapshot"), (path) =>
        guard.isProtected(path),
      );
      const reportPath = this.reportPath(loopId);
      await prisma.tddLoop.update({
        where: { id: loopId },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          protectedHash: snapshot.hash,
          protectedFiles: snapshot.size,
          relatedCommand: testCommandLine({
            runner,
            base,
            scope: "related",
            files: relatedFiles,
            reportPath,
          }),
          fullCommand: testCommandLine({ runner, base, scope: "full", files: [], reportPath }),
        },
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "TDD_LOOP", ...(task.startedAt ? {} : { startedAt: new Date() }) },
      });
      this.deps.hub.publishTaskStatus({
        taskId,
        projectId: task.projectId,
        status: "TDD_LOOP",
        runId: null,
      });
      await prisma.auditLog
        .create({
          data: {
            actor,
            action: "tdd.started",
            target: loopId,
            meta: {
              taskId,
              runner,
              maxIterations: input.maxIterations,
              budgetUsd: input.budgetUsd,
            },
          },
        })
        .catch(() => undefined);

      const output = new TextTail(OUTPUT_TAIL_CHARS);
      this.remember(loopId, output);
      const loop: ActiveLoop = {
        id: loopId,
        taskId,
        projectId: task.projectId,
        workspaceId: workspace.id,
        root,
        runner,
        base,
        gates,
        relatedFiles,
        maxIterations: input.maxIterations,
        budgetUsd: input.budgetUsd,
        testTimeoutSec: input.testTimeoutSec,
        taskTitle: task.title,
        taskPrompt: task.prompt,
        holdId: hold.id,
        lockKey,
        release: hold.release,
        guard,
        snapshot,
        paths: new PathResolver([root, ...this.realRoot(root)]),
        phase: "preparing",
        aborted: false,
        session: null,
        output,
        spentUsd: 0,
        iterationCount: 0,
        violations: 0,
        finished: false,
        done: Promise.resolve(),
        baseline: new Set(options.ignoreFailures ?? []),
        ignoredLabels: new Map(),
      };
      this.active.set(loopId, loop);
      loop.done = this.drive(loop);
      return this.publish(loop);
    } catch (error) {
      hold.release();
      if (created) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.tddLoop
          .update({
            where: { id: created.id },
            data: { status: "FAILED", message, endedAt: new Date() },
          })
          .catch(() => undefined);
        await prisma.task
          .update({ where: { id: taskId }, data: { status: task.status } })
          .catch(() => undefined);
        throw badRequest(message);
      }
      throw error;
    }
  }

  async settled(loopId: string): Promise<TddLoopDto> {
    await this.active.get(loopId)?.done;
    return this.load(loopId);
  }

  async abort(loopId: string, actor: string): Promise<TddLoopDto> {
    const loop = this.active.get(loopId);
    if (!loop) {
      const current = await this.get(loopId);
      if (current.status === "RUNNING" || current.status === "PENDING")
        throw conflict("This loop is not running in this Onyx process");
      return current;
    }
    loop.aborted = true;
    await this.deps.prisma.auditLog
      .create({
        data: { actor, action: "tdd.aborted", target: loopId, meta: { taskId: loop.taskId } },
      })
      .catch(() => undefined);
    await loop.session?.stop();
    if (!this.deps.scheduler.removeQueued(loop.taskId))
      await this.deps.scheduler.abortTask(loop.taskId);
    await loop.done;
    return this.get(loopId);
  }

  async abortForTask(taskId: string, actor: string): Promise<boolean> {
    const loopId = this.isActiveForTask(taskId);
    if (!loopId) return false;
    await this.abort(loopId, actor);
    return true;
  }

  async recover(): Promise<number> {
    const { prisma, logger } = this.deps;
    const stale = await prisma.tddLoop.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      include: {
        task: { select: { worktreePath: true, project: { select: { rootPath: true } } } },
      },
    });
    for (const loop of stale) {
      const snapshot = await ProtectedSnapshot.load(join(this.loopDirectory(loop.id), "snapshot"));
      let restored: ProtectedChange[] = [];
      if (snapshot) {
        const guard = new TestGuard(loop.task.worktreePath ?? loop.task.project.rootPath);
        restored = await snapshot.verify((path) => guard.isProtected(path)).catch(() => []);
        if (restored.length > 0) await snapshot.restore(restored).catch(() => undefined);
        await snapshot.discard();
      }
      await prisma.tddLoop.update({
        where: { id: loop.id },
        data: {
          status: "ABORTED",
          endedAt: new Date(),
          message:
            restored.length > 0
              ? `Interrupted by an Onyx restart; restored ${restored.length} test file(s)`
              : "Interrupted by an Onyx restart",
        },
      });
      logger.warn(
        { loopId: loop.id, restored: restored.length },
        "TDD loop interrupted by restart",
      );
    }
    return stale.length;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    const loops = [...this.active.values()];
    for (const loop of loops) {
      loop.aborted = true;
      await loop.session?.stop();
      if (!this.deps.scheduler.removeQueued(loop.taskId))
        await this.deps.scheduler.abortTask(loop.taskId);
    }
    await Promise.allSettled(loops.map((loop) => loop.done));
  }

  private async drive(loop: ActiveLoop): Promise<void> {
    const { prisma, logger } = this.deps;
    let progress: LoopProgress = initialProgress();
    const previousPassed = new Map<TddStage, Set<string>>();
    let escalation: RoutingEscalation | null = null;
    let index = 0;
    let lastRunId: string | null = null;
    try {
      this.write(
        loop,
        `${ACCENT}Onyx TDD loop${RESET} · ${loop.runner.toLowerCase()} · up to ${loop.maxIterations} fix attempts · ${loop.snapshot.size} protected test files\r\n`,
      );
      for (;;) {
        if (loop.aborted) return await this.finish(loop, "ABORTED", "Stopped by the operator");
        const evaluation = await this.evaluate(loop);
        if (loop.aborted) return await this.finish(loop, "ABORTED", "Stopped by the operator");
        if (evaluation.noTests) {
          await this.recordIteration(loop, index, evaluation, null, []);
          return await this.finish(loop, "FAILED", "The test runner found no tests to run");
        }
        if (
          evaluation.stage === "run" &&
          (evaluation.exitCode === 126 || evaluation.exitCode === 127)
        ) {
          await this.recordIteration(loop, index, evaluation, null, []);
          return await this.finish(
            loop,
            "FAILED",
            `The test command could not start (exit ${evaluation.exitCode}): ${evaluation.failures[0]?.message.split("\n").at(-1) ?? "command not found"}`,
          );
        }
        if (evaluation.green) {
          await this.recordIteration(loop, index, evaluation, null, []);
          const attempts = loop.iterationCount;
          return await this.finish(
            loop,
            "GREEN",
            (attempts === 0
              ? "Already green: tests and gates passed before any fix"
              : `Green after ${attempts} fix attempt${attempts === 1 ? "" : "s"}`) +
              ignoredNote([...loop.ignoredLabels.values()]),
          );
        }

        const failingIds = evaluation.failures
          .filter((failure) => failure.kind === "test")
          .map((failure) => failureId(failure));
        const regressions = regressionsOf(previousPassed.get(evaluation.stage) ?? null, failingIds);
        if (evaluation.stage === "related" || evaluation.stage === "full")
          previousPassed.set(evaluation.stage, new Set(evaluation.passedIds));
        const digest = buildDigest({
          failures: evaluation.failures,
          summary: this.summaryLine(evaluation),
          sources: await this.sourcesFor(loop, evaluation.failures),
          budgetTokens: DIGEST_BUDGET_TOKENS,
          estimate: this.deps.estimate,
          regressions,
        });
        progress = observe(progress, {
          stage: evaluation.stage,
          failed: evaluation.failed,
          signature: digest.signature,
        });
        const iterationId = await this.recordIteration(
          loop,
          index,
          evaluation,
          digest,
          regressions,
        );
        index += 1;
        this.write(
          loop,
          `${YELLOW}✗ ${STAGE_LABEL[evaluation.stage]}: ${evaluation.failed} failing${regressions.length > 0 ? `, ${regressions.length} regression(s)` : ""}${RESET} · digest ${digest.tokens} tokens\r\n`,
        );

        let decision = decideNext(progress, {
          maxIterations: loop.maxIterations,
          budgetUsd: loop.budgetUsd,
          spentUsd: loop.spentUsd,
        });
        if (decision.action === "stop")
          return await this.finish(loop, decision.status, decision.reason);
        if (decision.escalate) {
          const next = lastRunId ? await this.escalationFor(lastRunId) : null;
          progress = markEscalated(progress);
          if (next) {
            escalation = next;
            await prisma.tddIteration.update({
              where: { id: iterationId },
              data: { escalated: true },
            });
            await prisma.tddLoop.update({
              where: { id: loop.id },
              data: { escalatedAt: new Date() },
            });
            this.write(
              loop,
              `${ACCENT}⇧ No progress in ${NO_PROGRESS_BEFORE_ESCALATION} attempts: escalating to ${next.tier}${RESET}\r\n`,
            );
          } else {
            this.write(
              loop,
              `${YELLOW}No progress in ${NO_PROGRESS_BEFORE_ESCALATION} attempts and no higher tier to escalate to${RESET}\r\n`,
            );
          }
        }

        let currentIteration = iterationId;
        let reverted: string[] = [];
        for (;;) {
          loop.phase = "agent";
          await this.publish(loop);
          const prompt = buildFixPrompt({
            taskTitle: loop.taskTitle,
            taskPrompt: loop.taskPrompt,
            iteration: progress.fixes + 1,
            maxIterations: loop.maxIterations,
            stageLabel: STAGE_LABEL[evaluation.stage],
            digest: digest.text,
            revertedFiles: reverted,
            escalated: escalation !== null && decision.action === "fix" && decision.escalate,
            includeTask: progress.fixes === 0 || (decision.action === "fix" && decision.escalate),
          });
          this.write(
            loop,
            `${ACCENT}▶ Fix attempt ${progress.fixes + 1}${RESET} · the agent is working…\r\n`,
          );
          const result = await this.fixRun(loop, prompt, escalation);
          progress = recordFix(progress);
          const run = await this.afterFix(loop, currentIteration, result);
          if (run) lastRunId = run.id;
          if (loop.aborted || result?.status === "ABORTED")
            return await this.finish(loop, "ABORTED", "Stopped by the operator");
          if (!run) return await this.finish(loop, "FAILED", await this.startFailure(loop.taskId));
          if (run.status !== "COMPLETED" && run.resultSubtype !== "error_max_turns")
            return await this.finish(
              loop,
              "FAILED",
              `The fix run ended with ${run.status.toLowerCase()}: ${run.errorMessage ?? "no details"}`,
            );

          loop.phase = "guard";
          await this.publish(loop);
          const changes = await loop.snapshot.verify((path) => loop.guard.isProtected(path));
          if (changes.length === 0) {
            this.addRelated(loop, toStringArray(run.changedFiles));
            break;
          }
          reverted = await this.revert(loop, changes, run.id);
          currentIteration = await this.recordGuard(loop, index, evaluation, digest, reverted);
          index += 1;
          decision = decideNext(progress, {
            maxIterations: loop.maxIterations,
            budgetUsd: loop.budgetUsd,
            spentUsd: loop.spentUsd,
          });
          if (decision.action === "stop")
            return await this.finish(loop, decision.status, decision.reason);
          decision = { action: "fix", escalate: false };
        }
      }
    } catch (error) {
      logger.error({ err: error, loopId: loop.id }, "TDD loop crashed");
      await this.finish(
        loop,
        "FAILED",
        error instanceof Error ? error.message : String(error),
      ).catch((finishError: unknown) =>
        logger.error({ err: finishError, loopId: loop.id }, "TDD loop could not be closed"),
      );
    }
  }

  private async fixRun(
    loop: ActiveLoop,
    prompt: string,
    escalation: RoutingEscalation | null,
  ): Promise<ExecutionResult | null> {
    const run = (newSession: boolean) =>
      this.deps.scheduler.runAndWait({
        request: {
          taskId: loop.taskId,
          modelId: null,
          agentConfigId: null,
          prompt,
          newSession,
          tdd: { loopId: loop.id, guard: loop.guard, escalation },
        },
        workspaceId: loop.workspaceId,
        projectId: loop.projectId,
        lockKey: loop.lockKey,
        priority: 100,
        kind: "TDD",
        enqueuedAt: Date.now(),
        holdId: loop.holdId,
      });
    const first = await run(false);
    if (!first?.lostSession || loop.aborted || this.stopped) return first;
    const lost = await this.deps.prisma.agentRun.findUnique({
      where: { id: first.runId },
      select: { costUsd: true },
    });
    loop.spentUsd += lost?.costUsd ?? 0;
    this.deps.logger.warn(
      { loopId: loop.id, runId: first.runId },
      "Claude Code lost the session of a TDD fix run: retrying in a new session",
    );
    this.write(
      loop,
      `${YELLOW}Claude Code no longer has this session: retrying the fix attempt in a new one${RESET}\r\n`,
    );
    return run(true);
  }

  private async evaluate(loop: ActiveLoop): Promise<Evaluation> {
    loop.phase = "tests";
    await this.publish(loop);
    const started = Date.now();
    const reportPath = this.reportPath(loop.id);
    const scopes: Array<"related" | "full"> =
      loop.relatedFiles.length > 0 ? ["related", "full"] : ["full"];
    let lastReport: Evaluation | null = null;
    for (const scope of scopes) {
      await rm(reportPath, { force: true });
      const line = testCommandLine({
        runner: loop.runner,
        base: loop.base,
        scope,
        files: loop.relatedFiles,
        reportPath,
      });
      const result = await this.runCommand(loop, STAGE_LABEL[scope], line);
      if (loop.aborted) return this.interrupted(scope, started, result);
      const raw = await readFile(reportPath, "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => null);
      const report = raw === null ? null : parseJsonReport(raw, loop.paths);
      const base = {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: Date.now() - started,
        noTests: false,
      };
      if (result.timedOut || !report) {
        const failure = commandFailure(
          result.timedOut
            ? `${STAGE_LABEL[scope]} timed out after ${loop.testTimeoutSec} s`
            : STAGE_LABEL[scope],
          result.output,
          result.timedOut ? null : result.exitCode,
          loop.paths,
        );
        return {
          ...base,
          stage: result.timedOut ? scope : "run",
          green: false,
          total: report?.total ?? 0,
          passed: report?.passed ?? 0,
          failed: Math.max(1, report?.failed ?? 0),
          skipped: report?.skipped ?? 0,
          failures: report && report.failures.length > 0 ? report.failures : [failure],
          passedIds: report?.passedIds ?? [],
        };
      }
      const tolerated =
        scope === "full" && report.failures.length > 0
          ? this.tolerate(loop, report.failures)
          : null;
      if ((report.failed > 0 || result.exitCode !== 0) && tolerated?.kept.length !== 0) {
        const failures =
          tolerated !== null
            ? tolerated.kept
            : report.failures.length > 0
              ? report.failures
              : [commandFailure(STAGE_LABEL[scope], result.output, result.exitCode, loop.paths)];
        return {
          ...base,
          stage: scope,
          green: false,
          total: report.total,
          passed: report.passed,
          failed: Math.max(report.failed, failures.length),
          skipped: report.skipped,
          failures,
          passedIds: report.passedIds,
        };
      }
      lastReport = {
        ...base,
        stage: scope,
        green: true,
        total: report.total,
        passed: report.passed,
        failed: 0,
        skipped: report.skipped,
        failures: [],
        passedIds: report.passedIds,
        noTests: scope === "full" && report.total === 0,
      };
      if (lastReport.noTests) return lastReport;
    }
    const tests = lastReport ?? this.interrupted("full", started, null);
    loop.phase = "gates";
    await this.publish(loop);
    for (const gate of ["typecheck", "lint"] as const) {
      const command = loop.gates[gate];
      if (!command) continue;
      const result = await this.runCommand(loop, STAGE_LABEL[gate], command);
      if (loop.aborted) return this.interrupted(gate, started, result);
      if (result.exitCode === 0 && !result.timedOut) continue;
      const parsed =
        gate === "typecheck"
          ? parseTypecheckOutput(result.output, loop.paths)
          : parseLintOutput(result.output, loop.paths);
      const kept = parsed.length > 0 && !result.timedOut ? this.tolerate(loop, parsed).kept : null;
      if (kept !== null && kept.length === 0) continue;
      const failures =
        kept !== null
          ? kept
          : [
              commandFailure(
                STAGE_LABEL[gate],
                result.output,
                result.timedOut ? null : result.exitCode,
                loop.paths,
              ),
            ];
      return {
        ...tests,
        stage: gate,
        green: false,
        failed: failures.length,
        failures,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: Date.now() - started,
      };
    }
    return { ...tests, durationMs: Date.now() - started };
  }

  private interrupted(stage: TddStage, started: number, result: CommandResult | null): Evaluation {
    return {
      stage,
      green: false,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [],
      passedIds: [],
      exitCode: result?.exitCode ?? null,
      timedOut: false,
      durationMs: Date.now() - started,
      noTests: false,
    };
  }

  private tolerate(
    loop: ActiveLoop,
    failures: readonly TestFailure[],
  ): { kept: TestFailure[]; ignored: TestFailure[] } {
    const split = splitBaseline(failures, loop.baseline, loop.relatedFiles);
    for (const failure of split.ignored)
      loop.ignoredLabels.set(baselineKey(failure), baselineLabel(failure));
    if (split.ignored.length > 0)
      this.write(
        loop,
        `${YELLOW}↷ Ignoring ${split.ignored.length} failure(s) that already failed before this work${RESET}\r\n`,
      );
    return split;
  }

  async baseline(taskId: string, root: string): Promise<string[]> {
    const { workspace } = await this.loadTask(taskId);
    const facts = await this.projectFacts(root);
    const runner = workspace.testRunner ?? detectRunner(facts);
    if (!runner) return [];
    const base = this.baseCommand(runner, workspace.testCommand, facts.binaries);
    const id = `baseline-${randomUUID()}`;
    const directory = await this.prepareLoopDirectory(id);
    const target: CommandTarget = {
      id,
      root,
      testTimeoutSec: 600,
      aborted: false,
      session: null,
      output: new TextTail(OUTPUT_TAIL_CHARS),
    };
    const paths = new PathResolver([root, ...this.realRoot(root)]);
    const keys = new Set<string>();
    try {
      const reportPath = this.reportPath(id);
      await this.runCommand(
        target,
        "baseline test suite",
        testCommandLine({ runner, base, scope: "full", files: [], reportPath }),
      );
      const raw = await readFile(reportPath, "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => null);
      const report = raw === null ? null : parseJsonReport(raw, paths);
      for (const failure of report?.failures ?? []) keys.add(baselineKey(failure));
      if (facts.files.has("tsconfig.json")) {
        const result = await this.runCommand(
          target,
          "baseline type check",
          defaultTypecheckCommand(facts.binaries),
        );
        if (result.exitCode !== 0 && !result.timedOut)
          for (const failure of parseTypecheckOutput(result.output, paths))
            keys.add(baselineKey(failure));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return [...keys];
  }

  private runCommand(loop: CommandTarget, label: string, line: string): Promise<CommandResult> {
    const started = Date.now();
    this.write(loop, `\r\n${ACCENT}▶ ${label}${RESET}  ${line}\r\n`);
    let output = "";
    return new Promise<CommandResult>((resolve) => {
      let timedOut = false;
      const session = new PtySession(
        {
          command: SHELL,
          args: ["-c", line],
          cwd: loop.root,
          env: this.childEnv(),
          cols: PTY_COLS,
          rows: PTY_ROWS,
        },
        {
          onData: (data) => {
            output += data;
            this.write(loop, data);
          },
          onExit: (exit) => {
            clearTimeout(timer);
            loop.session = null;
            const durationMs = Date.now() - started;
            if (!timedOut && !loop.aborted) {
              const seconds = (durationMs / 1_000).toFixed(1);
              this.write(
                loop,
                exit.exitCode === 0
                  ? `${GREEN}✓ ${label} passed${RESET} · ${seconds} s\r\n`
                  : `${YELLOW}✗ ${label} exited with ${exit.exitCode}${RESET} · ${seconds} s\r\n`,
              );
            }
            resolve({ exitCode: timedOut ? null : exit.exitCode, output, durationMs, timedOut });
          },
        },
        {
          ...(this.deps.killGraceMs === undefined ? {} : { killGraceMs: this.deps.killGraceMs }),
          sourceEnv: { ...process.env, ...this.deps.sourceEnv },
          sandbox: this.deps.config.agentSandbox,
          tracker: this.deps.tracker ?? null,
          label: `test:${loop.id}`,
        },
      );
      const timer = setTimeout(() => {
        timedOut = true;
        this.write(loop, `\r\n${RED}Timed out after ${loop.testTimeoutSec} s${RESET}\r\n`);
        void session.stop();
      }, loop.testTimeoutSec * 1_000);
      loop.session = session;
      try {
        session.start();
      } catch (error) {
        clearTimeout(timer);
        loop.session = null;
        resolve({
          exitCode: 127,
          output: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started,
          timedOut: false,
        });
      }
    });
  }

  private childEnv(): Record<string, string> {
    const source = this.deps.sourceEnv ?? process.env;
    const env: Record<string, string> = { FORCE_COLOR: "1" };
    for (const name of this.deps.config.childEnvPassthrough) {
      const value = source[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }

  private async afterFix(
    loop: ActiveLoop,
    iterationId: string,
    result: ExecutionResult | null,
  ): Promise<{
    id: string;
    status: string;
    resultSubtype: string | null;
    errorMessage: string | null;
    changedFiles: unknown;
  } | null> {
    const { prisma } = this.deps;
    loop.iterationCount += 1;
    if (!result) {
      await prisma.tddLoop.update({
        where: { id: loop.id },
        data: { iterationCount: loop.iterationCount },
      });
      return null;
    }
    const run = await prisma.agentRun.findUnique({
      where: { id: result.runId },
      select: {
        id: true,
        status: true,
        resultSubtype: true,
        errorMessage: true,
        changedFiles: true,
        costUsd: true,
      },
    });
    loop.spentUsd += run?.costUsd ?? 0;
    await prisma.$transaction([
      prisma.tddIteration.update({
        where: { id: iterationId },
        data: { agentRunId: result.runId },
      }),
      prisma.tddLoop.update({
        where: { id: loop.id },
        data: { iterationCount: loop.iterationCount, costUsd: loop.spentUsd },
      }),
    ]);
    if (run) {
      this.write(
        loop,
        `${run.status === "COMPLETED" ? GREEN : YELLOW}■ Fix attempt ${loop.iterationCount} ${run.status.toLowerCase()}${RESET}${run.costUsd !== null ? ` · $${run.costUsd.toFixed(4)}` : ""}\r\n`,
      );
    }
    return run;
  }

  private async startFailure(taskId: string): Promise<string> {
    const task = await this.deps.prisma.task.findUnique({
      where: { id: taskId },
      select: { resultSummary: true },
    });
    return `The fix run could not start: ${task?.resultSummary ?? "unknown error"}`;
  }

  private async revert(
    loop: ActiveLoop,
    changes: readonly ProtectedChange[],
    runId: string,
  ): Promise<string[]> {
    const { prisma } = this.deps;
    await loop.snapshot.restore(changes);
    loop.violations += 1;
    const files = changes.map((change) => change.path);
    await prisma.tddLoop.update({ where: { id: loop.id }, data: { violations: loop.violations } });
    await prisma.auditLog
      .create({
        data: {
          actor: `run:${runId}`,
          action: "tdd.test_reverted",
          target: loop.id,
          meta: { taskId: loop.taskId, changes: changes.map((change) => ({ ...change })) },
        },
      })
      .catch(() => undefined);
    this.write(
      loop,
      `${RED}⚠ The agent changed protected test files: ${files.join(", ")}. Restored them and recorded a violation.${RESET}\r\n`,
    );
    return files;
  }

  private addRelated(loop: ActiveLoop, changed: readonly string[]): void {
    const additions = changed.filter(
      (path) => !loop.guard.isProtected(path) && existsSync(join(loop.root, path)),
    );
    if (additions.length === 0) return;
    loop.relatedFiles = [...new Set([...loop.relatedFiles, ...additions])].slice(
      0,
      MAX_RELATED_FILES,
    );
    void this.deps.prisma.tddLoop
      .update({
        where: { id: loop.id },
        data: {
          relatedFiles: loop.relatedFiles,
          relatedCommand: testCommandLine({
            runner: loop.runner,
            base: loop.base,
            scope: "related",
            files: loop.relatedFiles,
            reportPath: this.reportPath(loop.id),
          }),
        },
      })
      .catch(() => undefined);
  }

  private async recordIteration(
    loop: ActiveLoop,
    index: number,
    evaluation: Evaluation,
    digest: { text: string; tokens: number; signature: string | null } | null,
    regressions: readonly string[],
  ): Promise<string> {
    const row = await this.deps.prisma.tddIteration.create({
      data: {
        loopId: loop.id,
        index,
        scope: evaluation.stage,
        passed: evaluation.passed,
        failed: evaluation.failed,
        skipped: evaluation.skipped,
        durationMs: evaluation.durationMs,
        exitCode: evaluation.exitCode,
        timedOut: evaluation.timedOut,
        failureSignature: digest?.signature ?? null,
        digest: digest?.text ?? null,
        digestTokens: digest?.tokens ?? null,
        regressions: regressions.length,
        rawLogPath: join(this.loopDirectory(loop.id), "loop.log"),
      },
      select: { id: true },
    });
    await this.publish(loop);
    return row.id;
  }

  private async recordGuard(
    loop: ActiveLoop,
    index: number,
    evaluation: Evaluation,
    digest: { text: string; tokens: number; signature: string | null },
    reverted: readonly string[],
  ): Promise<string> {
    const row = await this.deps.prisma.tddIteration.create({
      data: {
        loopId: loop.id,
        index,
        scope: "guard",
        passed: evaluation.passed,
        failed: evaluation.failed,
        skipped: evaluation.skipped,
        durationMs: 0,
        failureSignature: digest.signature,
        digest: digest.text,
        digestTokens: digest.tokens,
        revertedFiles: [...reverted],
      },
      select: { id: true },
    });
    await this.publish(loop);
    return row.id;
  }

  private async finish(loop: ActiveLoop, status: TddStatus, message: string): Promise<void> {
    const { prisma, hub, logger } = this.deps;
    if (loop.finished) return;
    loop.finished = true;
    loop.phase = null;
    let finalMessage = message;
    try {
      const changes = await loop.snapshot.verify((path) => loop.guard.isProtected(path));
      if (changes.length > 0) {
        await loop.snapshot.restore(changes);
        loop.violations += 1;
        finalMessage = `${message}; restored ${changes.length} test file(s) changed during the last attempt`;
        this.write(
          loop,
          `${RED}⚠ Restored ${changes.map((change) => change.path).join(", ")}${RESET}\r\n`,
        );
      }
    } catch (error) {
      logger.warn({ err: error, loopId: loop.id }, "Could not verify the protected test files");
    }
    const endedAt = new Date();
    const taskStatus = FINAL_TASK_STATUS[status];
    const colour = status === "GREEN" ? GREEN : status === "ABORTED" ? YELLOW : RED;
    this.write(
      loop,
      `\r\n${colour}${status === "GREEN" ? "✔" : "■"} ${status}: ${finalMessage}${RESET}\r\n`,
    );
    await loop.snapshot.discard().catch(() => undefined);
    await rm(this.reportPath(loop.id), { force: true }).catch(() => undefined);
    this.active.delete(loop.id);
    loop.release();
    const [finished] = await prisma.$transaction([
      prisma.tddLoop.update({
        where: { id: loop.id },
        data: {
          status,
          message: finalMessage,
          endedAt,
          violations: loop.violations,
          costUsd: loop.spentUsd,
          iterationCount: loop.iterationCount,
          ...(status === "GREEN" ? { greenAt: endedAt } : {}),
        },
      }),
      prisma.task.update({
        where: { id: loop.taskId },
        data: {
          status: taskStatus,
          resultSummary: `TDD loop ${status.toLowerCase()}: ${finalMessage}`,
          ...(taskStatus === "COMPLETED" ? { completedAt: endedAt } : {}),
        },
      }),
    ]);
    hub.publishTaskStatus({
      taskId: loop.taskId,
      projectId: loop.projectId,
      status: taskStatus,
      runId: null,
    });
    if (status === "GREEN" && this.deps.onGreen) {
      const lastRun = await prisma.agentRun.findFirst({
        where: { taskId: loop.taskId },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      this.deps.onGreen({
        projectId: loop.projectId,
        fullCommand: finished.fullCommand,
        runId: lastRun?.id ?? null,
      });
    }
    await this.publish(loop);
    this.states.delete(loop.id);
    logger.info({ loopId: loop.id, status, attempts: loop.iterationCount }, "TDD loop finished");
  }

  private async escalationFor(runId: string): Promise<RoutingEscalation | null> {
    if (!(await this.deps.router.autoEscalate().catch(() => false))) return null;
    const run = await this.deps.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { routingDecision: { select: { tier: true, strategy: true } } },
    });
    const decision = run?.routingDecision;
    if (!decision || decision.strategy === "OVERRIDE") return null;
    const next = raiseTier(decision.tier);
    if (TIER_ORDER[next] <= TIER_ORDER[decision.tier]) return null;
    return {
      tier: next,
      reason: `the TDD loop made no progress in ${NO_PROGRESS_BEFORE_ESCALATION} attempts on ${decision.tier}`,
    };
  }

  private summaryLine(evaluation: Evaluation): string {
    if (evaluation.stage === "typecheck" || evaluation.stage === "lint")
      return `All ${evaluation.passed} tests pass, but the ${STAGE_LABEL[evaluation.stage]} reports ${evaluation.failed} error(s).`;
    if (evaluation.stage === "run")
      return "The test runner failed before producing a report. Its output:";
    return `${STAGE_LABEL[evaluation.stage]}: ${evaluation.failed} failed, ${evaluation.passed} passed, ${evaluation.skipped} skipped.`;
  }

  private async sourcesFor(
    loop: ActiveLoop,
    failures: readonly TestFailure[],
  ): Promise<Map<string, string>> {
    const sources = new Map<string, string>();
    for (const failure of failures) {
      const file = failure.location?.file;
      if (!file || sources.has(file)) continue;
      const absolute = join(loop.root, file);
      if (!absolute.startsWith(loop.root)) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info?.isFile() || info.size > MAX_SOURCE_BYTES) continue;
      const text = await readFile(absolute, "utf8").catch(() => null);
      if (text !== null) sources.set(file, text);
    }
    return sources;
  }

  private write(loop: Pick<ActiveLoop, "id" | "output">, data: string): void {
    loop.output.append(data);
    this.deps.hub.publishPtyOutput(terminalIdOf(loop.id), data);
    void appendFile(join(this.loopDirectory(loop.id), "loop.log"), data).catch(() => undefined);
  }

  private async publish(loop: ActiveLoop): Promise<TddLoopDto> {
    const dto = await this.load(loop.id);
    if (this.active.has(loop.id)) this.states.set(loop.id, dto);
    const shown = localizeLoop(dto);
    this.deps.hub.publishTddState(shown);
    return shown;
  }

  private remember(loopId: string, output: TextTail): void {
    this.outputs.set(loopId, output);
    while (this.outputs.size > RECENT_OUTPUTS) {
      const oldest = this.outputs.keys().next().value;
      if (oldest === undefined) break;
      if (this.active.has(oldest)) break;
      this.outputs.delete(oldest);
    }
  }

  private logTail(loopId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(loopId)) return "";
    try {
      const text = readFileSync(join(this.loopDirectory(loopId), "loop.log"), "utf8");
      return text.length > LOG_TAIL_BYTES ? text.slice(text.length - LOG_TAIL_BYTES) : text;
    } catch {
      return "";
    }
  }

  private async countProtected(root: string): Promise<number> {
    const guard = new TestGuard(root);
    const files = await listProjectFiles(root).catch(() => []);
    return files.filter((path) => guard.isProtected(path)).length;
  }

  private loopDirectory(loopId: string): string {
    return join(this.deps.config.runtimeDir, "tdd", loopId);
  }

  private reportPath(loopId: string): string {
    return join(this.loopDirectory(loopId), "reports", "report.json");
  }

  private async prepareLoopDirectory(loopId: string): Promise<string> {
    const directory = this.loopDirectory(loopId);
    await mkdir(directory, { recursive: true, mode: 0o750 });
    await mkdir(join(directory, "reports"), { mode: 0o770 });
    await chmod(join(directory, "reports"), 0o770);
    return directory;
  }

  private realRoot(root: string): string[] {
    try {
      return [realpathSync(root)];
    } catch {
      return [];
    }
  }

  private baseCommand(
    runner: TestRunner,
    override: string | null,
    binaries: ReadonlySet<string>,
  ): string {
    if (override && override.trim().length > 0) return override.trim();
    return binaryInvocation(runner === "VITEST" ? "vitest" : "jest", binaries);
  }

  private async loadTask(taskId: string) {
    const task = await this.deps.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true, workspace: true },
    });
    if (!task) throw notFound("Task");
    if (!task.workspace) throw badRequest("Task has no workspace");
    return { task, workspace: task.workspace };
  }

  private async projectFacts(root: string): Promise<{
    packageJson: Record<string, unknown> | null;
    files: Set<string>;
    binaries: Set<string>;
  }> {
    const files = new Set(await readdir(root).catch(() => []));
    const binaries = new Set(await readdir(join(root, "node_modules", ".bin")).catch(() => []));
    const packageJson = await readFile(join(root, "package.json"), "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .then((value) =>
        typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null,
      )
      .catch(() => null);
    return { packageJson, files, binaries };
  }

  private async defaultRelatedFiles(root: string, targetPaths: unknown): Promise<string[]> {
    const guard = new TestGuard(root);
    const candidates = new Set(toStringArray(targetPaths));
    const status = await execFileAsync("git", safeGitArgs(["status", "--porcelain", "-uall"]), {
      cwd: root,
      env: gitEnvironment(),
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }).catch(() => null);
    for (const change of status ? parsePorcelain(status.stdout).changes : []) {
      if (change.kind !== "deleted") candidates.add(change.path);
    }
    return [...candidates]
      .map((path) => path.replace(/^\.\//, ""))
      .filter((path) => /\.[cm]?[jt]sx?$|\.vue$|\.svelte$/.test(path))
      .filter((path) => existsSync(join(root, path)))
      .sort(
        (a, b) => Number(guard.isProtected(b)) - Number(guard.isProtected(a)) || a.localeCompare(b),
      )
      .slice(0, MAX_RELATED_FILES);
  }
}
