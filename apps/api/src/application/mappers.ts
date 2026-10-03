import {
  EMPTY_USAGE,
  PermissionModeSchema,
  type AgentConfigDto,
  type ModelProfileDto,
  type ProjectDto,
  type RunDto,
  type SessionDto,
  type TaskDto,
  type TokenUsage,
  type WorkspaceDto,
} from "@onyx/contracts";
import type {
  AgentConfig,
  AgentRun,
  ModelProfile,
  Project,
  RoutingDecision,
  Session,
  Task,
  TokenLog,
  Workspace,
} from "@onyx/db";

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function iso(date: Date): string {
  return date.toISOString();
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export function usageFromTokenLog(log: TokenLog | undefined): TokenUsage {
  if (!log) return EMPTY_USAGE;
  return {
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    cacheCreationTokens: log.cacheCreationTokens,
    cacheReadTokens: log.cacheReadTokens,
  };
}

function indexedFileCount(stats: unknown): number | null {
  if (stats === null || typeof stats !== "object") return null;
  const files = (stats as { files?: unknown }).files;
  return typeof files === "number" ? files : null;
}

export type ProjectWithCounts = Project & { _count: { workspaces: number; tasks: number } };

export function toProjectDto(project: ProjectWithCounts): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    gitRemote: project.gitRemote,
    defaultBranch: project.defaultBranch,
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
    workspaceCount: project._count.workspaces,
    taskCount: project._count.tasks,
    indexedAt: isoOrNull(project.indexedAt),
    indexedFiles: indexedFileCount(project.indexStats),
  };
}

export function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    name: workspace.name,
    domain: workspace.domain,
    pathGlobs: toStringArray(workspace.pathGlobs),
    writeFenceGlobs: toStringArray(workspace.writeFenceGlobs),
    primer: workspace.primer,
    resetStrategy: workspace.resetStrategy,
    maxSessionTokens: workspace.maxSessionTokens,
    agentConfigId: workspace.agentConfigId,
    testRunner: workspace.testRunner,
    testCommand: workspace.testCommand,
    activeSessionId: workspace.activeSessionId,
    color: workspace.color,
    position: workspace.position,
  };
}

export type SessionWithRunCount = Session & { _count: { runs: number } };

export function toSessionDto(session: SessionWithRunCount): SessionDto {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    claudeSessionId: session.claudeSessionId,
    modelId: session.modelId,
    status: session.status,
    endReason: session.endReason,
    previousId: session.previousId,
    handoffNote: session.handoffNote,
    handoffTokens: session.handoffTokens,
    runs: session._count.runs,
    turns: session.turns,
    contextTokens: session.contextTokens,
    startedAt: iso(session.startedAt),
    lastActivityAt: iso(session.lastActivityAt),
    endedAt: isoOrNull(session.endedAt),
  };
}

export type RunWithRelations = AgentRun & {
  session: Pick<Session, "workspaceId">;
  tokenLogs: TokenLog[];
  routingDecision: Pick<RoutingDecision, "strategy" | "tier" | "rationale"> | null;
};

export const RUN_INCLUDE = {
  session: { select: { workspaceId: true } },
  tokenLogs: { where: { scope: "RUN_TOTAL" as const }, take: 1 },
  routingDecision: { select: { strategy: true, tier: true, rationale: true } },
} as const;

export function toRunDto(run: RunWithRelations): RunDto {
  return {
    id: run.id,
    taskId: run.taskId,
    sessionId: run.sessionId,
    workspaceId: run.session.workspaceId,
    modelId: run.modelId,
    mode: run.mode,
    status: run.status,
    prompt: run.prompt,
    exitCode: run.exitCode,
    signal: run.signal,
    resultSubtype: run.resultSubtype,
    isError: run.isError,
    numTurns: run.numTurns,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    errorMessage: run.errorMessage,
    cliVersion: run.cliVersion,
    usage: usageFromTokenLog(run.tokenLogs[0]),
    context: {
      baselineTokens: run.ctxBaselineTokens,
      deliveredTokens: run.ctxDeliveredTokens,
      expansions: run.ctxExpansions,
    },
    guardDenials: run.guardDenials,
    changedFiles: toStringArray(run.changedFiles),
    routing: run.routingDecision
      ? {
          strategy: run.routingDecision.strategy,
          tier: run.routingDecision.tier,
          rationale: run.routingDecision.rationale,
        }
      : null,
    startedAt: iso(run.startedAt),
    endedAt: isoOrNull(run.endedAt),
  };
}

export type TaskWithLastRun = Task & { runs: RunWithRelations[] };

export function taskIncludeLastRun() {
  return { runs: { orderBy: { startedAt: "desc" as const }, take: 1, include: RUN_INCLUDE } };
}

export function toTaskDto(task: TaskWithLastRun): TaskDto {
  const lastRun = task.runs[0];
  return {
    id: task.id,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    prompt: task.prompt,
    kind: task.kind,
    status: task.status,
    priority: task.priority,
    modelOverride: task.modelOverride,
    targetPaths: toStringArray(task.targetPaths),
    branchName: task.branchName,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
    startedAt: isoOrNull(task.startedAt),
    completedAt: isoOrNull(task.completedAt),
    lastRun: lastRun ? toRunDto(lastRun) : null,
  };
}

export function toModelProfileDto(profile: ModelProfile): ModelProfileDto {
  return {
    id: profile.id,
    displayName: profile.displayName,
    alias: profile.alias,
    tier: profile.tier,
    contextWindow: profile.contextWindow,
    inputUsdPerMTok: profile.inputUsdPerMTok,
    outputUsdPerMTok: profile.outputUsdPerMTok,
    enabled: profile.enabled,
  };
}

export function toAgentConfigDto(config: AgentConfig): AgentConfigDto {
  const permissionMode = PermissionModeSchema.safeParse(config.permissionMode);
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    tier: config.tier,
    modelId: config.modelId,
    permissionMode: permissionMode.success ? permissionMode.data : "manual",
    maxTurns: config.maxTurns,
    isBuiltin: config.isBuiltin,
  };
}
