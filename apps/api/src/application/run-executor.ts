import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  buildClaudeArgs,
  notStartedExit,
  type AgentPool,
  type ProcessExit,
  type RunSpec,
} from "@onyx/agent-runtime";
import {
  PermissionModeSchema,
  type OnyxRunItem,
  type RunStatus,
  type TaskStatus,
} from "@onyx/contracts";
import { DEFAULT_AGENT_CONFIG_NAME, type AgentConfig, type PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import { credentialEnv, type AppConfig } from "../config";
import { buildRunSettings } from "../domain/permission-rules";
import { resolveRunOutcome } from "../domain/run-outcome";
import { decideSession, type SessionDecision } from "../domain/session-policy";
import { badRequest, notFound } from "../errors";
import type { EventWriter } from "../infrastructure/event-writer";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import type { WsHub } from "../infrastructure/ws-hub";
import { toStringArray } from "./mappers";
import { RunRecorder } from "./run-recorder";

export interface RunRequest {
  taskId: string;
  modelId: string | null;
  agentConfigId: string | null;
  prompt: string | null;
  newSession: boolean;
}

export interface RunLifecycleHooks {
  onRunCreated(runId: string, taskId: string): void;
}

export interface ExecutionResult {
  runId: string;
  status: RunStatus;
}

export interface RunExecutorDeps {
  prisma: PrismaClient;
  pool: AgentPool;
  writer: EventWriter;
  hub: WsHub;
  logger: Logger;
  config: Pick<AppConfig, "runtimeDir" | "credentials" | "childEnvPassthrough">;
  cliVersion: () => string | null;
  sourceEnv?: NodeJS.ProcessEnv;
}

const INIT_TIMEOUT_MS = 120_000;
const MAX_STDERR_ITEM_CHARS = 2_000;
const MAX_RESULT_SUMMARY_CHARS = 4_000;

interface PreparedRun {
  runId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  sessionId: string;
  sessionIsNew: boolean;
  modelId: string;
  startedAt: number;
  spec: RunSpec;
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

  constructor(private readonly deps: RunExecutorDeps) {}

  requestAbort(runId: string): void {
    this.abortRequests.add(runId);
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

    const recorder = new RunRecorder(prepared.runId, writer, hub, (init) => {
      established = true;
      pendingWrites.push(
        prisma.session
          .update({
            where: { id: prepared.sessionId },
            data: { claudeSessionId: init.sessionId, lastActivityAt: new Date() },
          })
          .then(() => undefined),
      );
    });
    recorder.recordOnyx({ kind: "prompt", text: prepared.spec.prompt });
    recorder.recordOnyx(statusItem("SPAWNING"));

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

    await Promise.allSettled(pendingWrites);
    return this.finalize(prepared, recorder, exit, established);
  }

  private async finalize(
    prepared: PreparedRun,
    recorder: RunRecorder,
    exit: ProcessExit,
    established: boolean,
  ): Promise<ExecutionResult> {
    const { prisma, writer, hub, logger } = this.deps;
    const result = recorder.result;
    const outcome = resolveRunOutcome(exit, result);
    recorder.recordOnyx(
      statusItem(outcome.runStatus, {
        exitCode: exit.exitCode,
        signal: exit.signal,
        message: outcome.errorMessage,
      }),
    );
    await writer.flush();

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
            ...(established
              ? { status: "IDLE" as const }
              : { status: "CLOSED" as const, endReason: "ERROR" as const, endedAt }),
          },
        });
        if (!established) {
          await tx.workspace.updateMany({
            where: { id: session.workspaceId, activeSessionId: session.id },
            data: { activeSessionId: null },
          });
        }

        await tx.task.update({
          where: { id: prepared.taskId },
          data: {
            status: outcome.taskStatus,
            ...(outcome.taskStatus === "COMPLETED" ? { completedAt: endedAt } : {}),
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
      status: outcome.taskStatus,
      runId: prepared.runId,
    });
    logger.info(
      { runId: prepared.runId, status: outcome.runStatus, reason: exit.reason },
      "Run finished",
    );
    return { runId: prepared.runId, status: outcome.runStatus };
  }

  private async prepare(request: RunRequest): Promise<PreparedRun> {
    const { prisma, config, cliVersion } = this.deps;
    const task = await prisma.task.findUnique({
      where: { id: request.taskId },
      include: { project: true, workspace: { include: { activeSession: true } } },
    });
    if (!task) throw notFound("Task");
    const workspace = task.workspace;
    if (!workspace) throw badRequest("Task has no workspace");

    const rootStats = await stat(task.project.rootPath).catch(() => null);
    if (!rootStats?.isDirectory())
      throw badRequest(`Project root ${task.project.rootPath} is not a directory`);

    const agentConfig = await this.resolveAgentConfig(
      request.agentConfigId ?? workspace.agentConfigId,
    );
    const modelId = request.modelId ?? task.modelOverride ?? agentConfig.modelId;
    const profile = await prisma.modelProfile.findUnique({ where: { id: modelId } });
    if (!profile || !profile.enabled) throw badRequest(`Model ${modelId} is not enabled`);

    const active = workspace.activeSession;
    const decision = decideSession(
      active
        ? {
            id: active.id,
            modelId: active.modelId,
            status: active.status,
            contextTokens: active.contextTokens,
            established: active.claudeSessionId !== null,
          }
        : null,
      { modelId, forceNew: request.newSession, maxSessionTokens: workspace.maxSessionTokens },
    );
    const session = await this.applySessionDecision(decision, workspace.id, modelId);
    const prompt = request.prompt ?? task.prompt;
    const permissionMode = PermissionModeSchema.parse(agentConfig.permissionMode);

    const { run, startedAt } = await prisma.$transaction(async (tx) => {
      const routing = await tx.routingDecision.create({
        data: {
          taskId: task.id,
          strategy: "OVERRIDE",
          features: {
            source: request.modelId
              ? "run-request"
              : task.modelOverride
                ? "task-override"
                : "agent-config",
          },
          tier: profile.tier,
          modelId,
          rationale: request.modelId
            ? "Model selected manually for this run"
            : task.modelOverride
              ? "Model pinned on the task"
              : `Default model of agent config ${agentConfig.name}`,
        },
      });
      const created = await tx.agentRun.create({
        data: {
          taskId: task.id,
          sessionId: session.id,
          agentConfigId: agentConfig.id,
          routingDecisionId: routing.id,
          modelId,
          prompt,
          args: [],
          cliVersion: cliVersion(),
        },
      });
      await tx.task.update({
        where: { id: task.id },
        data: { status: "RUNNING", ...(task.startedAt ? {} : { startedAt: new Date() }) },
      });
      return { run: created, startedAt: created.startedAt.getTime() };
    });

    const files = await writeRuntimeFiles({
      runtimeDir: config.runtimeDir,
      runId: run.id,
      settings: buildRunSettings(),
      primer: [workspace.primer, agentConfig.appendSystemPrompt]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join("\n\n"),
    });

    const spec: RunSpec = {
      runId: run.id,
      cwd: task.project.rootPath,
      prompt,
      model: modelId,
      fallbackModels: toStringArray(agentConfig.fallbackModelIds).filter((id) => id !== modelId),
      permissionMode,
      maxTurns: agentConfig.maxTurns,
      session:
        decision.action === "resume"
          ? { mode: "resume", sessionId: session.claudeSessionId ?? session.id }
          : { mode: "new", sessionId: session.id },
      allowedTools: toStringArray(agentConfig.allowedTools),
      disallowedTools: toStringArray(agentConfig.disallowedTools),
      settingsFile: files.settingsFile,
      mcpConfigFile: files.mcpConfigFile,
      appendSystemPromptFile: files.primerFile,
      includePartialMessages: agentConfig.partialMessages,
      env: { ...this.passthroughEnv(), ...credentialEnv(config.credentials) },
      timeouts: {
        wallClockMs: agentConfig.timeoutSec * 1_000,
        idleMs: agentConfig.idleTimeoutSec * 1_000,
        initMs: INIT_TIMEOUT_MS,
      },
    };
    await prisma.agentRun.update({ where: { id: run.id }, data: { args: buildClaudeArgs(spec) } });

    this.publishStatus(task.id, task.projectId, "RUNNING", run.id);
    return {
      runId: run.id,
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: workspace.id,
      sessionId: session.id,
      sessionIsNew: decision.action === "start",
      modelId,
      startedAt,
      spec,
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

  private async applySessionDecision(
    decision: SessionDecision,
    workspaceId: string,
    modelId: string,
  ) {
    const { prisma } = this.deps;
    if (decision.action === "resume") {
      return prisma.session.update({
        where: { id: decision.sessionId },
        data: { status: "ACTIVE", lastActivityAt: new Date() },
      });
    }
    return prisma.$transaction(async (tx) => {
      if (decision.rotate) {
        await tx.session.update({
          where: { id: decision.rotate.sessionId },
          data: { status: "ROTATED", endReason: decision.rotate.reason, endedAt: new Date() },
        });
      }
      const created = await tx.session.create({
        data: {
          id: randomUUID(),
          workspaceId,
          modelId,
          status: "ACTIVE",
          previousId: decision.rotate?.sessionId ?? null,
        },
      });
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { activeSessionId: created.id },
      });
      return created;
    });
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
