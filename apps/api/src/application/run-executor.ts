import { stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  buildClaudeArgs,
  notStartedExit,
  type AgentPool,
  type ProcessExit,
  type RunSpec,
} from "@onyx/agent-runtime";
import {
  PermissionModeSchema,
  type ContextArm,
  type MemoryArm,
  type ContextExperimentSettings,
  type ContextItem,
  type GuardItem,
  type ModelTier,
  type OnyxRunItem,
  type RoutingItem,
  type RoutingStrategy,
  type RunItemOf,
  type RunStatus,
  type SessionItem,
  type TaskStatus,
} from "@onyx/contracts";
import {
  DEFAULT_AGENT_CONFIG_NAME,
  type AgentConfig,
  type Prisma,
  type PrismaClient,
} from "@onyx/db";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import { WriteFence, type ContextPolicy } from "@onyx/ignore-compiler";
import { captureFence, reviewFence, type FenceSnapshot } from "../infrastructure/fence-audit";
import type { WorkTreeActivity } from "../infrastructure/work-tree-activity";
import type { TokenEstimator } from "@onyx/lean-ctx";
import { composePrimer, composeUserMessage } from "../domain/context-primer";
import { drawMemoryArm } from "../domain/memory";
import { buildRunSettings, guardHooks, RUN_TOKEN_ENV } from "../domain/permission-rules";
import { classifyCacheLoss, DEFAULT_PROMPT_CACHE_TTL_MS, prefixHash } from "../domain/prompt-cache";
import { lostSession, resolveRunOutcome } from "../domain/run-outcome";
import { shouldEscalate, TIER_ORDER, type RoutingEscalation } from "../domain/routing/decide";
import {
  auditReads,
  DEFAULT_EXPERIMENT,
  drawArm,
  type FileRead,
  type ReadAudit,
} from "../domain/savings";
import type { TestGuard } from "../domain/tdd/test-guard";
import { badRequest, notFound } from "../errors";
import type { EventWriter } from "../infrastructure/event-writer";
import {
  buildMcpConfig,
  emptyMcpConfig,
  isReadableFile,
  ONYX_MCP_ALLOW_RULE,
  type McpConfigFile,
} from "../infrastructure/mcp-config";
import type { RunTokenRegistry } from "../infrastructure/run-tokens";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import type { WsHub } from "../infrastructure/ws-hub";
import type { CompartmentService } from "./compartment-service";
import type { CredentialService } from "./credential-service";
import type { IndexService } from "./index-service";
import { storedMemory, type MemoryService } from "./memory-service";
import { toStringArray } from "./mappers";
import { priceUsage, type RouterService } from "./router-service";
import type { SurgeonService } from "./surgeon-service";
import { RunRecorder, type RecordedRead } from "./run-recorder";
import type { ForeignChange } from "./terminal-service";

export interface TddRunScope {
  loopId: string;
  guard: TestGuard;
  escalation: RoutingEscalation | null;
}

export interface RunRequest {
  taskId: string;
  modelId: string | null;
  agentConfigId: string | null;
  prompt: string | null;
  newSession: boolean;
  tdd?: TddRunScope;
  tierHint?: RoutingEscalation | null;
  quotaDeferred?: boolean;
}

export interface RunLifecycleHooks {
  onRunCreated(runId: string, taskId: string): void;
}

export interface ExecutionResult {
  runId: string;
  status: RunStatus;
  followUp: RunRequest | null;
}

export interface RunExecutorDeps {
  prisma: PrismaClient;
  pool: AgentPool;
  writer: EventWriter;
  hub: WsHub;
  logger: Logger;
  config: Pick<
    AppConfig,
    "runtimeDir" | "childEnvPassthrough" | "context" | "internalApiUrl" | "agentProtectedPaths"
  >;
  indexes: IndexService;
  surgeon: SurgeonService;
  router: RouterService;
  compartments: CompartmentService;
  runTokens: RunTokenRegistry;
  credentials: Pick<CredentialService, "childEnv">;
  cliVersion: () => string | null;
  experiment: () => Promise<ContextExperimentSettings>;
  estimator: TokenEstimator;
  memory?: Pick<MemoryService, "compose" | "settings">;
  random?: () => number;
  onRunFinished?: (change: ForeignChange) => void;
  onRateLimit?: (item: RunItemOf<"rate_limit">) => void;
  activity?: WorkTreeActivity;
  grantedRules?: (
    projectId: string,
    target: { taskId: string; agentConfigId: string | null },
  ) => Promise<string[]>;
  sourceEnv?: NodeJS.ProcessEnv;
}

const INIT_TIMEOUT_MS = 120_000;
const MAX_STDERR_ITEM_CHARS = 2_000;
const MAX_RESULT_SUMMARY_CHARS = 4_000;
const MAX_CHANGED_FILES = 200;

interface PreparedRun {
  runId: string;
  taskId: string;
  projectId: string;
  projectRoot: string;
  isolated: boolean;
  workspaceId: string;
  sessionId: string;
  sessionIsNew: boolean;
  modelId: string;
  tier: ModelTier;
  strategy: RoutingStrategy;
  request: RunRequest;
  startedAt: number;
  displayPrompt: string;
  routing: RoutingItem;
  session: SessionItem;
  context: ContextItem;
  spec: RunSpec;
  messageTokens: number;
  prefixHash: string;
  delivered: ReadonlyMap<string, string>;
  packFingerprints: readonly (readonly [string, string])[];
  fence: WriteFence;
  workspaceName: string;
}

interface PrimerMap {
  text: string;
  tokens: number;
  includedFiles: number;
  omittedFiles: number;
}

interface PreparedContext {
  item: ContextItem;
  primerMap: PrimerMap | null;
  packText: string | null;
  packFingerprints: readonly (readonly [string, string])[];
  mapDrift: boolean;
  mcpConfig: McpConfigFile;
  mcpEnabled: boolean;
}

interface SessionContext {
  frozenMap: PrimerMap | null;
  delivered: ReadonlyMap<string, string>;
}

function storedMap(value: unknown): PrimerMap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = record["text"];
  const tokens = record["tokens"];
  const includedFiles = record["includedFiles"];
  const omittedFiles = record["omittedFiles"];
  return typeof text === "string" &&
    typeof tokens === "number" &&
    typeof includedFiles === "number" &&
    typeof omittedFiles === "number"
    ? { text, tokens, includedFiles, omittedFiles }
    : null;
}

function storedDelivered(value: unknown): Map<string, string> {
  const delivered = new Map<string, string>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return delivered;
  for (const [path, fingerprint] of Object.entries(value))
    if (typeof fingerprint === "string") delivered.set(path, fingerprint);
  return delivered;
}

function subagentsOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const agents: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(value)) {
    if (typeof definition !== "object" || definition === null) continue;
    const record = definition as Record<string, unknown>;
    if (typeof record["description"] !== "string" || typeof record["prompt"] !== "string") continue;
    agents[name] = record;
  }
  return Object.keys(agents).length > 0 ? agents : null;
}

function statusItem(
  status: RunStatus,
  details: { exitCode?: number | null; signal?: string | null; message?: string | null } = {},
): OnyxRunItem {
  return {
    kind: "status",
    status,
    exitCode: details.exitCode ?? null,
    signal: details.signal ?? null,
    message: details.message ?? null,
  };
}

export class RunExecutor {
  private readonly abortRequests = new Set<string>();
  private readonly activeRecorders = new Map<string, RunRecorder>();

  constructor(private readonly deps: RunExecutorDeps) {}

  requestAbort(runId: string): void {
    this.abortRequests.add(runId);
  }

  recordGuard(runId: string, item: GuardItem): boolean {
    const recorder = this.activeRecorders.get(runId);
    if (!recorder) return false;
    recorder.recordOnyx(item);
    return true;
  }

  async execute(request: RunRequest, hooks: RunLifecycleHooks): Promise<ExecutionResult | null> {
    let prepared: PreparedRun;
    try {
      prepared = await this.prepare(request);
    } catch (error) {
      await this.failBeforeStart(request.taskId, error);
      return null;
    }
    hooks.onRunCreated(prepared.runId, prepared.taskId);
    return this.run(prepared);
  }

  private async run(prepared: PreparedRun): Promise<ExecutionResult> {
    const { prisma, pool, writer, hub, logger } = this.deps;
    const pendingWrites: Promise<unknown>[] = [];
    let established = !prepared.sessionIsNew;

    const recorder = new RunRecorder(
      prepared.runId,
      writer,
      hub,
      (init) => {
        established = true;
        pendingWrites.push(
          prisma.session
            .update({
              where: { id: prepared.sessionId },
              data: { claudeSessionId: init.sessionId, lastActivityAt: new Date() },
            })
            .then(() => undefined),
        );
      },
      (item) => this.deps.onRateLimit?.(item),
    );
    this.activeRecorders.set(prepared.runId, recorder);
    recorder.recordOnyx({ kind: "prompt", text: prepared.displayPrompt });
    recorder.recordOnyx(prepared.routing);
    recorder.recordOnyx(prepared.session);
    recorder.recordOnyx(prepared.context);
    recorder.recordOnyx(statusItem("SPAWNING"));

    const fenced = (path: string) => !prepared.fence.verdict(path).allowed;
    const activity = this.deps.activity?.begin(prepared.projectRoot, prepared.workspaceName);
    const snapshot = await captureFence(prepared.projectRoot, fenced, this.gitEnv()).catch(
      (error: unknown) => {
        logger.warn({ err: error, runId: prepared.runId }, "Could not record the fenced files");
        return null;
      },
    );

    let exit: ProcessExit;
    if (this.abortRequests.has(prepared.runId)) {
      exit = notStartedExit("aborted");
    } else {
      exit = await pool.run(prepared.spec, {
        onSpawn: (pid) => {
          recorder.recordOnyx(statusItem("RUNNING"));
          pendingWrites.push(
            prisma.agentRun
              .update({ where: { id: prepared.runId }, data: { pid, status: "RUNNING" } })
              .then(() => undefined),
          );
        },
        onEvent: (event) => recorder.recordClaudeEvent(event),
        onInvalidLine: (line) =>
          recorder.recordOnyx({
            kind: "stderr",
            text: `invalid stream-json line: ${line.slice(0, 500)}`,
          }),
        onStderr: (text) =>
          recorder.recordOnyx({ kind: "stderr", text: text.slice(0, MAX_STDERR_ITEM_CHARS) }),
        onHandlerError: (error) =>
          logger.error({ err: error, runId: prepared.runId }, "Run handler failed"),
      });
    }
    this.abortRequests.delete(prepared.runId);

    const concurrent =
      activity === undefined
        ? new Set<string>()
        : (this.deps.activity?.concurrent(activity) ?? new Set<string>());
    if (activity !== undefined) this.deps.activity?.end(activity);
    if (snapshot) await this.undoFencedWrites(prepared, recorder, snapshot, fenced, concurrent);

    await Promise.allSettled(pendingWrites);
    return this.finalize(prepared, recorder, exit, established);
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return this.deps.sourceEnv ?? process.env;
  }

  private async undoFencedWrites(
    prepared: PreparedRun,
    recorder: RunRecorder,
    snapshot: FenceSnapshot,
    fenced: (path: string) => boolean,
    concurrent: ReadonlySet<string>,
  ): Promise<void> {
    const { prisma, logger } = this.deps;
    try {
      const review = await reviewFence(
        snapshot,
        fenced,
        (path) => concurrent.has(prepared.fence.verdict(path).owner ?? ""),
        this.gitEnv(),
      );
      const undone = [...review.restored, ...review.removed].sort();
      if (undone.length === 0) return;
      const owners = [...new Set(undone.map((path) => prepared.fence.verdict(path).owner))];
      recorder.recordOnyx({
        kind: "guard",
        source: "audit",
        tool: "Run",
        toolUseId: null,
        target: undone.join(", "),
        rule: `write fence (${prepared.workspaceName})`,
        reason: `The run changed ${undone.length} ${undone.length === 1 ? "file" : "files"} of the ${owners.join(", ")} workspace, which ${prepared.workspaceName} may not change: Onyx put ${undone.length === 1 ? "it" : "them"} back.`,
      });
      await prisma.auditLog.create({
        data: {
          actor: `run:${prepared.runId}`,
          action: "fence.undone",
          target: prepared.projectId,
          meta: { restored: review.restored, removed: review.removed, skipped: review.skipped },
        },
      });
    } catch (error) {
      logger.error({ err: error, runId: prepared.runId }, "Could not undo the fenced writes");
    }
  }

  private async finalize(
    prepared: PreparedRun,
    recorder: RunRecorder,
    exit: ProcessExit,
    established: boolean,
  ): Promise<ExecutionResult> {
    const { prisma, writer, hub, logger, runTokens, indexes } = this.deps;
    const result = recorder.result;
    const expansions = runTokens.usage(prepared.runId);
    runTokens.revoke(prepared.runId);
    this.activeRecorders.delete(prepared.runId);
    const ctxDeliveredTokens = prepared.context.deliveredTokens + expansions.tokens;
    const ctxBaselineTokens =
      prepared.context.baselineTokens > 0 ? prepared.context.baselineTokens : null;
    const outcome = resolveRunOutcome(exit, result);
    const lostResume = !prepared.sessionIsNew && lostSession(result);
    const sessionAlive = established && !lostResume;
    const retryInNewSession = lostResume && !prepared.request.tdd;
    const followUp = prepared.request.tdd
      ? null
      : retryInNewSession
        ? { ...prepared.request, newSession: false }
        : await this.escalationFollowUp(prepared, outcome.runStatus, result?.subtype ?? null);
    const taskStatus: TaskStatus = followUp
      ? "QUEUED"
      : prepared.request.tdd && outcome.taskStatus !== "CANCELLED"
        ? "TDD_LOOP"
        : outcome.taskStatus;
    recorder.recordOnyx(
      statusItem(outcome.runStatus, {
        exitCode: exit.exitCode,
        signal: exit.signal,
        message: retryInNewSession
          ? `${outcome.errorMessage ?? "Run failed"}. Claude Code no longer has this session: re-queued in a new one.`
          : followUp
            ? `${outcome.errorMessage ?? "Run failed"}. Re-queued on a higher tier.`
            : outcome.errorMessage,
      }),
    );
    await writer.flush();
    hub.releaseRun(prepared.runId);
    const changedFiles = this.normalizeChanged(prepared.projectRoot, recorder.changedFiles);
    const reference = await this.deps.router.referenceProfile().catch(() => null);
    const audit = await this.readAudit(prepared, recorder.reads);
    const previous = prepared.sessionIsNew
      ? null
      : await prisma.agentRun
          .findFirst({
            where: {
              sessionId: prepared.sessionId,
              id: { not: prepared.runId },
              endedAt: { not: null },
            },
            orderBy: { endedAt: "desc" },
            select: { modelId: true, cachePrefixHash: true, endedAt: true },
          })
          .catch(() => null);
    const cache = classifyCacheLoss({
      sessionIsNew: prepared.sessionIsNew,
      firstTurn: recorder.firstMainTurn,
      messageTokens: prepared.messageTokens,
      modelId: prepared.modelId,
      prefixHash: prepared.prefixHash,
      startedAt: new Date(prepared.startedAt),
      previous: previous?.endedAt
        ? {
            modelId: previous.modelId,
            prefixHash: previous.cachePrefixHash,
            endedAt: previous.endedAt,
          }
        : null,
      ttlMs: this.deps.config.context.promptCacheTtlMs ?? DEFAULT_PROMPT_CACHE_TTL_MS,
    });
    const deliveredPack = recorder.compacted
      ? {}
      : Object.fromEntries([...prepared.delivered, ...prepared.packFingerprints]);

    const endedAt = new Date();
    const usage = recorder.usage;
    const turns = recorder.turnUsages();
    const numTurns = result?.numTurns ?? (turns.length > 0 ? turns.length : null);
    const hasUsage = turns.length > 0 || result !== null;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.agentRun.update({
          where: { id: prepared.runId },
          data: {
            status: outcome.runStatus,
            exitCode: exit.exitCode,
            signal: exit.signal,
            resultSubtype: result?.subtype ?? null,
            isError: outcome.runStatus !== "COMPLETED",
            numTurns,
            durationMs: result?.durationMs ?? endedAt.getTime() - prepared.startedAt,
            durationApiMs: result?.durationApiMs ?? null,
            costUsd: result?.costUsd ?? null,
            ctxDeliveredTokens,
            ctxExpansions: expansions.calls,
            ctxReadFiles: audit.readFiles,
            ctxRereadFiles: audit.rereadFiles,
            ctxRereadTokens: audit.rereadTokens,
            ctxMissedFiles: audit.missedFiles,
            ctxRereadPaths: audit.rereadPaths,
            ctxReusedTokens:
              prepared.context.reusedTokens > 0 ? prepared.context.reusedTokens : null,
            cacheLoss: cache.reason,
            cacheReadTokens: cache.readTokens,
            cacheWriteTokens: cache.writeTokens,
            cacheLostTokens: cache.lostTokens,
            guardDenials: recorder.guardDenials,
            quotaLimited: recorder.rateLimited,
            changedFiles,
            errorMessage: outcome.errorMessage,
            endedAt,
          },
        });

        if (hasUsage) {
          await tx.tokenLog.createMany({
            data: [
              ...turns.map((turn) => ({
                runId: prepared.runId,
                sessionId: prepared.sessionId,
                modelId: turn.model ?? prepared.modelId,
                scope: "TURN" as const,
                purpose: turn.messageId,
                ...turn.usage,
              })),
              {
                runId: prepared.runId,
                sessionId: prepared.sessionId,
                modelId: prepared.modelId,
                scope: "RUN_TOTAL" as const,
                ...usage,
                costUsd: result?.costUsd ?? null,
                counterfactualUsd: reference ? priceUsage(usage, reference) : null,
                ctxBaselineTokens,
                ctxDeliveredTokens,
              },
            ],
          });
        }

        const session = await tx.session.update({
          where: { id: prepared.sessionId },
          data: {
            turns: { increment: numTurns ?? 0 },
            lastActivityAt: endedAt,
            ...(recorder.lastContextTokens > 0
              ? { contextTokens: recorder.lastContextTokens }
              : {}),
            ...(sessionAlive
              ? { status: "IDLE" as const, deliveredPack }
              : { status: "CLOSED" as const, endReason: "ERROR" as const, endedAt }),
          },
        });
        if (!sessionAlive) {
          await tx.workspace.updateMany({
            where: { id: session.workspaceId, activeSessionId: session.id },
            data: { activeSessionId: null },
          });
        }

        await tx.task.update({
          where: { id: prepared.taskId },
          data: {
            status: taskStatus,
            ...(taskStatus === "COMPLETED" ? { completedAt: endedAt } : {}),
            ...(result?.resultText
              ? { resultSummary: result.resultText.slice(0, MAX_RESULT_SUMMARY_CHARS) }
              : {}),
          },
        });
      });
    } catch (error) {
      logger.error({ err: error, runId: prepared.runId }, "Failed to finalize run");
    }

    hub.publishTaskStatus({
      taskId: prepared.taskId,
      projectId: prepared.projectId,
      status: taskStatus,
      runId: prepared.runId,
    });
    if (exit.sawInit && !prepared.isolated && recorder.mayHaveWritten)
      indexes.scheduleRefresh(prepared.projectId);
    if (changedFiles.length > 0 && !prepared.isolated) {
      try {
        this.deps.onRunFinished?.({
          projectId: prepared.projectId,
          workspaceId: prepared.workspaceId,
          changedFiles,
        });
      } catch (error) {
        logger.warn({ err: error, runId: prepared.runId }, "Run finished listener failed");
      }
    }
    logger.info(
      { runId: prepared.runId, status: outcome.runStatus, reason: exit.reason },
      "Run finished",
    );
    return { runId: prepared.runId, status: outcome.runStatus, followUp };
  }

  private async escalationFollowUp(
    prepared: PreparedRun,
    status: RunStatus,
    resultSubtype: string | null,
  ): Promise<RunRequest | null> {
    if (prepared.strategy === "OVERRIDE") return null;
    if (!shouldEscalate({ status, resultSubtype })) return null;
    if (TIER_ORDER[prepared.tier] >= TIER_ORDER.ARCHITECT) return null;
    if (!(await this.deps.router.autoEscalate().catch(() => false))) return null;
    return { ...prepared.request, modelId: null, newSession: false };
  }

  private relativeInside(projectRoot: string, path: string): string | null {
    const inside = isAbsolute(path) ? relative(projectRoot, path) : path.replace(/^\.\//, "");
    if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return null;
    return inside.split("\\").join("/");
  }

  private normalizeChanged(projectRoot: string, paths: readonly string[]): string[] {
    const normalized = new Set<string>();
    for (const path of paths) {
      const inside = this.relativeInside(projectRoot, path);
      if (inside !== null) normalized.add(inside);
    }
    return [...normalized].sort().slice(0, MAX_CHANGED_FILES);
  }

  private async readAudit(
    prepared: PreparedRun,
    reads: readonly RecordedRead[],
  ): Promise<ReadAudit> {
    const project =
      reads.length > 0
        ? await this.deps.indexes.context(prepared.projectId).catch(() => null)
        : null;
    const files: FileRead[] = [];
    for (const read of reads) {
      const relPath = this.relativeInside(prepared.projectRoot, read.path);
      if (relPath === null) continue;
      const measured = this.deps.estimator.estimate(read.content, "text");
      const indexed = project?.fileFacts(relPath)?.rawTokens ?? null;
      files.push({
        relPath,
        tokens: read.partial && !read.truncated ? measured : (indexed ?? measured),
      });
    }
    return auditReads(files, prepared.context.entries);
  }

  private async prepare(request: RunRequest): Promise<PreparedRun> {
    const { prisma, config, cliVersion, router, compartments } = this.deps;
    const task = await prisma.task.findUnique({
      where: { id: request.taskId },
      include: {
        project: { include: { workspaces: { orderBy: { position: "asc" } } } },
        workspace: true,
      },
    });
    if (!task) throw notFound("Task");
    const workspace = task.workspace;
    if (!workspace) throw badRequest("Task has no workspace");

    const root = task.worktreePath ?? task.project.rootPath;
    const rootStats = await stat(root).catch(() => null);
    if (!rootStats?.isDirectory())
      throw badRequest(
        task.worktreePath
          ? `The task worktree ${root} is missing`
          : `Project root ${root} is not a directory`,
      );

    const agentConfig = await this.resolveAgentConfig(
      request.agentConfigId ?? workspace.agentConfigId,
    );
    const prompt = request.prompt ?? task.prompt;
    const evaluation = await router.evaluate({
      projectId: task.projectId,
      workspace: { id: workspace.id, name: workspace.name, domain: workspace.domain },
      taskId: task.id,
      kind: request.tdd ? "TEST_FIX" : task.kind,
      title: task.title,
      prompt,
      targetPaths: toStringArray(task.targetPaths),
      escalation: request.tdd?.escalation ?? request.tierHint ?? null,
      override: request.modelId
        ? { modelId: request.modelId, source: "run-request" }
        : task.modelOverride
          ? { modelId: task.modelOverride, source: "task-override" }
          : null,
      purpose: "router.classifier",
    });
    const modelId = evaluation.modelId;
    const profile = await prisma.modelProfile.findUnique({ where: { id: modelId } });
    if (!profile || !profile.enabled) throw badRequest(`Model ${modelId} is not enabled`);

    const plan = task.worktreePath
      ? await compartments.prepareIsolated({
          taskId: task.id,
          workspace,
          modelId,
          forceNew: request.newSession,
        })
      : await compartments.prepare({
          projectId: task.projectId,
          workspace,
          modelId,
          forceNew: request.newSession,
        });
    const session = plan.session;
    const permissionMode = PermissionModeSchema.parse(agentConfig.permissionMode);
    const arm = drawArm({
      settings: await this.deps.experiment().catch(() => DEFAULT_EXPERIMENT),
      freshSession: plan.decision.action === "start",
      contextEnabled: config.context.enabled,
      random: this.deps.random ?? Math.random,
    });
    const memory = await this.sessionMemory(
      task.projectId,
      session,
      plan.decision.action === "start",
    );

    const { run, startedAt } = await prisma.$transaction(async (tx) => {
      const routingDecisionId = await router.record(tx, task.id, evaluation);
      const created = await tx.agentRun.create({
        data: {
          taskId: task.id,
          sessionId: session.id,
          agentConfigId: agentConfig.id,
          routingDecisionId,
          modelId,
          prompt,
          args: [],
          cliVersion: cliVersion(),
          contextArm: arm,
          memoryArm: memory.arm,
          quotaDeferred: request.quotaDeferred === true,
        },
      });
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: request.tdd ? "TDD_LOOP" : "RUNNING",
          ...(task.startedAt ? {} : { startedAt: new Date() }),
        },
      });
      return { run: created, startedAt: created.startedAt.getTime() };
    });

    const scope = await this.deps.surgeon.runScope(task.projectId, workspace.id, task.worktreePath);
    const protectedPaths = [
      ...config.agentProtectedPaths,
      ...(task.worktreePath ? [join(task.project.rootPath, ".git")] : []),
    ];
    const indexed = await this.deps.indexes.context(task.projectId);
    const fence = new WriteFence(
      root,
      { name: workspace.name, globs: toStringArray(workspace.writeFenceGlobs) },
      task.project.workspaces
        .filter((candidate) => candidate.id !== workspace.id)
        .map((candidate) => ({ name: candidate.name, globs: toStringArray(candidate.pathGlobs) })),
      undefined,
      protectedPaths,
    );
    const fenceRules = fence.compile(indexed ? [...indexed.index.files.keys()] : []);
    const runToken = this.deps.runTokens.issue(run.id, task.projectId, {
      workspaceId: workspace.id,
      policy: scope.policy,
      guard: scope.guard,
      fence,
      tests: request.tdd?.guard ?? null,
    });
    const resuming = plan.decision.action === "resume";
    const sessionContext: SessionContext = {
      frozenMap: resuming ? storedMap(session.contextMap) : null,
      delivered: resuming ? storedDelivered(session.deliveredPack) : new Map(),
    };
    const context = await this.prepareContext(
      run.id,
      task,
      prompt,
      scope.policy,
      runToken,
      arm,
      sessionContext,
    );
    if (context.primerMap && sessionContext.frozenMap === null)
      await prisma.session.update({
        where: { id: session.id },
        data: {
          contextMap: {
            text: context.primerMap.text,
            tokens: context.primerMap.tokens,
            includedFiles: context.primerMap.includedFiles,
            omittedFiles: context.primerMap.omittedFiles,
          },
        },
      });
    const agents = subagentsOf(agentConfig.subagents);
    const primer = composePrimer({
      workspacePrimer: workspace.primer,
      agentPrompt: agentConfig.appendSystemPrompt,
      projectName: task.project.name,
      map: context.primerMap,
      memory: memory.text,
      mcpEnabled: context.mcpEnabled,
    });
    const prefix = prefixHash({ modelId, primer, agents, mcpEnabled: context.mcpEnabled });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        ignoreHash: scope.hash,
        cachePrefixHash: prefix,
        ctxMapDrift: context.mapDrift,
        ctxBaselineTokens: context.item.baselineTokens > 0 ? context.item.baselineTokens : null,
        ctxDeliveredTokens: context.item.deliveredTokens,
      },
    });
    const files = await writeRuntimeFiles({
      runtimeDir: config.runtimeDir,
      runId: run.id,
      settings: buildRunSettings({
        deny: [
          ...scope.compiled.readDeny,
          ...scope.compiled.editDeny,
          ...fenceRules.editDeny,
          ...(request.tdd ? request.tdd.guard.denyRules() : []),
        ],
        protectedPaths,
        hooks: guardHooks(config.internalApiUrl),
      }),
      primer,
      mcpConfig: context.mcpConfig,
      contextPack: context.packText,
      agents,
    });
    const readOnly = agentConfig.permissionMode === "plan";
    const granted =
      readOnly || !this.deps.grantedRules
        ? []
        : await this.deps.grantedRules(task.projectId, {
            taskId: task.id,
            agentConfigId: agentConfig.id,
          });
    const allowedTools = [
      ...new Set([
        ...toStringArray(agentConfig.allowedTools),
        ...(readOnly ? [] : toStringArray(task.project.allowedTools)),
        ...granted,
      ]),
    ];
    const handoffText = plan.item.handoff?.text ?? null;
    const message = composeUserMessage(context.packText, prompt, handoffText);

    const spec: RunSpec = {
      runId: run.id,
      cwd: root,
      prompt: message,
      model: modelId,
      fallbackModels: toStringArray(agentConfig.fallbackModelIds).filter((id) => id !== modelId),
      permissionMode,
      maxTurns: agentConfig.maxTurns,
      session:
        plan.decision.action === "resume"
          ? { mode: "resume", sessionId: session.claudeSessionId ?? session.id }
          : { mode: "new", sessionId: session.id },
      allowedTools:
        context.mcpEnabled && !allowedTools.includes(ONYX_MCP_ALLOW_RULE)
          ? [...allowedTools, ONYX_MCP_ALLOW_RULE]
          : allowedTools,
      disallowedTools: toStringArray(agentConfig.disallowedTools),
      settingsFile: files.settingsFile,
      mcpConfigFile: files.mcpConfigFile,
      appendSystemPromptFile: files.primerFile,
      includePartialMessages: agentConfig.partialMessages,
      env: {
        ...this.passthroughEnv(),
        ...(await this.deps.credentials.childEnv()),
        [RUN_TOKEN_ENV]: runToken,
      },
      timeouts: {
        wallClockMs: agentConfig.timeoutSec * 1_000,
        idleMs: agentConfig.idleTimeoutSec * 1_000,
        initMs: INIT_TIMEOUT_MS,
      },
      agentsFile: files.agentsFile,
      maxBudgetUsd: task.budgetUsd,
    };
    await prisma.agentRun.update({ where: { id: run.id }, data: { args: buildClaudeArgs(spec) } });

    this.publishStatus(task.id, task.projectId, request.tdd ? "TDD_LOOP" : "RUNNING", run.id);
    return {
      runId: run.id,
      taskId: task.id,
      projectId: task.projectId,
      projectRoot: root,
      isolated: task.worktreePath !== null,
      workspaceId: workspace.id,
      sessionId: session.id,
      sessionIsNew: plan.decision.action === "start",
      modelId,
      tier: evaluation.tier,
      strategy: evaluation.plan.strategy,
      request,
      startedAt,
      displayPrompt: prompt,
      routing: {
        kind: "routing",
        strategy: evaluation.plan.strategy,
        tier: evaluation.tier,
        modelId,
        rationale: evaluation.rationale,
        score: evaluation.plan.score?.value ?? null,
        confidence: evaluation.plan.confidence,
        ruleName: evaluation.plan.rule?.name ?? null,
      },
      session: plan.item,
      context: context.item,
      spec,
      messageTokens: this.deps.estimator.estimate(message, "text"),
      prefixHash: prefix,
      delivered: sessionContext.delivered,
      packFingerprints: context.packFingerprints,
      fence,
      workspaceName: workspace.name,
    };
  }

  private async sessionMemory(
    projectId: string,
    session: { id: string; memory: Prisma.JsonValue | null; memoryArm: MemoryArm | null },
    fresh: boolean,
  ): Promise<{ text: string | null; arm: MemoryArm | null }> {
    const service = this.deps.memory;
    if (!service) return { text: null, arm: null };
    if (!fresh) return { text: storedMemory(session.memory)?.text ?? null, arm: null };
    const settings = await service.settings();
    const arm = drawMemoryArm({
      enabled: settings.enabled,
      experiment: settings.experiment,
      freshSession: true,
      random: this.deps.random ?? Math.random,
    });
    const composed = arm === "NO_MEMORY" ? null : await service.compose(projectId);
    await this.deps.prisma.session.update({
      where: { id: session.id },
      data: {
        memoryArm: arm,
        ...(composed
          ? { memory: { text: composed.text, tokens: composed.tokens, factIds: composed.factIds } }
          : {}),
      },
    });
    return { text: composed?.text ?? null, arm };
  }

  private async prepareContext(
    runId: string,
    task: { projectId: string; targetPaths: unknown },
    prompt: string,
    policy: ContextPolicy,
    runToken: string,
    arm: ContextArm | null,
    session: SessionContext,
  ): Promise<PreparedContext> {
    const { indexes, config, logger } = this.deps;
    const targetPaths = toStringArray(task.targetPaths);
    const empty = (note: string): PreparedContext => ({
      item: {
        kind: "context",
        targets: targetPaths,
        inferredTargets: [],
        entries: [],
        mapTokens: 0,
        packTokens: 0,
        baselineTokens: 0,
        deliveredTokens: 0,
        reusedTokens: 0,
        mapFrozen: false,
        indexedAt: null,
        mcpEnabled: false,
        note,
        arm,
      },
      primerMap: null,
      packText: null,
      packFingerprints: [],
      mapDrift: false,
      mcpConfig: emptyMcpConfig(),
      mcpEnabled: false,
    });
    if (!config.context.enabled) return empty("Onyx context is disabled");
    if (arm === "CONTROL")
      return empty("Control run of the savings experiment: the Onyx context is withheld");

    const project = await indexes
      .waitForIndex(task.projectId, config.context.indexWaitMs)
      .catch((error: unknown) => {
        logger.warn({ err: error, runId }, "Project index unavailable");
        return null;
      });
    if (!project) return empty("The project is not indexed yet: this run has no Onyx context");

    const current = project.projectMap(config.context.mapBudgetTokens, policy);
    const map = session.frozenMap ?? current;
    const mapDrift = session.frozenMap !== null && session.frozenMap.text !== current.text;
    const { pack, targets, inferredTargets, excludedTargets } = project.buildPack({
      targetPaths,
      prompt,
      budgetTokens: config.context.packBudgetTokens,
      policy,
      delivered: session.delivered,
    });
    const mcpEnabled =
      config.context.mcpServerPath !== null && isReadableFile(config.context.mcpServerPath);
    const mcpConfig =
      mcpEnabled && config.context.mcpServerPath !== null
        ? buildMcpConfig({
            serverPath: config.context.mcpServerPath,
            apiUrl: config.internalApiUrl,
            token: runToken,
          })
        : emptyMcpConfig();
    const packTokens = pack?.deliveredTokens ?? 0;
    return {
      item: {
        kind: "context",
        targets,
        inferredTargets,
        entries: (pack?.entries ?? []).map((entry) => ({
          relPath: entry.relPath,
          role: entry.role,
          level: entry.level,
          tokens: entry.tokens,
          symbols: entry.symbols,
          reused: entry.reused,
        })),
        mapTokens: map.tokens,
        packTokens,
        baselineTokens: pack?.baselineTokens ?? 0,
        deliveredTokens: map.tokens + packTokens,
        reusedTokens: pack?.reusedTokens ?? 0,
        mapFrozen: session.frozenMap !== null,
        indexedAt: project.indexedAt?.toISOString() ?? null,
        mcpEnabled,
        note:
          excludedTargets.length > 0
            ? `Excluded by the context profile: ${excludedTargets.join(", ")}`
            : targets.length === 0
              ? "No target files: set target paths on the task or name files in the prompt"
              : null,
        arm,
      },
      primerMap: map,
      packText: pack?.text ?? null,
      packFingerprints: (pack?.entries ?? []).map(
        (entry) => [entry.relPath, entry.fingerprint] as const,
      ),
      mapDrift,
      mcpConfig,
      mcpEnabled,
    };
  }

  private async resolveAgentConfig(agentConfigId: string | null): Promise<AgentConfig> {
    const { prisma } = this.deps;
    const config = agentConfigId
      ? await prisma.agentConfig.findUnique({ where: { id: agentConfigId } })
      : await prisma.agentConfig.findUnique({ where: { name: DEFAULT_AGENT_CONFIG_NAME } });
    if (!config) throw badRequest("Agent configuration not found");
    return config;
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

  private async failBeforeStart(taskId: string, error: unknown): Promise<void> {
    const { prisma, logger } = this.deps;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ taskId, err: error }, "Run could not start");
    const task = await prisma.task
      .update({ where: { id: taskId }, data: { status: "FAILED", resultSummary: message } })
      .catch(() => null);
    if (task) this.publishStatus(task.id, task.projectId, "FAILED", null);
  }

  private publishStatus(
    taskId: string,
    projectId: string,
    status: TaskStatus,
    runId: string | null,
  ): void {
    this.deps.hub.publishTaskStatus({ taskId, projectId, status, runId });
  }
}
