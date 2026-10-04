import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentPool, ProcessExit } from "@onyx/agent-runtime";
import {
  normalizeClaudeEvent,
  type CreateOrchestrationRequestSchema,
  type NodeStateName,
  type OrchestrationDto,
  type OrchestrationNode,
  type OrchestrationStatus,
  type PlanActivity,
  type PublishPlanResult,
  type RunItemOf,
  type TaskStatus,
} from "@onyx/contracts";
import type { Approval, Orchestration, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import type { AppConfig } from "../config";
import {
  activeCount,
  dagOutcome,
  newlyBlocked,
  parseNodeState,
  readyNodes,
  type DagNode,
  type NodeState,
} from "../domain/orchestration/dag";
import {
  buildPlannerPrompt,
  extractPlan,
  nodePrompt,
  PLAN_JSON_SCHEMA,
  validatePlan,
  type PlanNode,
  type ValidatedPlan,
} from "../domain/orchestration/plan";
import { buildRunSettings, guardHooks, RUN_TOKEN_ENV } from "../domain/permission-rules";
import { badRequest, conflict, notFound } from "../errors";
import { GitRepo, linkDependencies } from "../infrastructure/git-worktree";
import {
  buildMcpConfig,
  emptyMcpConfig,
  isReadableFile,
  ONYX_MCP_ALLOW_RULE,
} from "../infrastructure/mcp-config";
import type { RunTokenRegistry } from "../infrastructure/run-tokens";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import { orchestrationStateMessage, type WsHub } from "../infrastructure/ws-hub";
import type { ApprovalPayload, ApprovalService } from "./approval-service";
import type { BudgetService } from "./budget-service";
import type { CredentialService } from "./credential-service";
import type { GitService } from "./git-service";
import type { IndexService } from "./index-service";
import { toStringArray } from "./mappers";
import { shortAction } from "./roadmap-service";
import { priceUsage, type RouterService } from "./router-service";
import type { RunScheduler } from "./run-scheduler";
import type { SurgeonService } from "./surgeon-service";
import type { TddService } from "./tdd-service";
import { gitEnvironment, safeGitArgs } from "../infrastructure/git-env";

type CreateInput = z.output<typeof CreateOrchestrationRequestSchema>;

export interface OrchestratorDeps {
  prisma: PrismaClient;
  logger: Logger;
  hub: WsHub;
  pool: AgentPool;
  scheduler: RunScheduler;
  tdd: TddService;
  approvals: ApprovalService;
  budgets: Pick<BudgetService, "admit" | "refresh">;
  git: Pick<GitService, "commitEnv" | "pushBranch">;
  indexes: IndexService;
  surgeon: SurgeonService;
  router: RouterService;
  runTokens: RunTokenRegistry;
  credentials: Pick<CredentialService, "childEnv">;
  config: Pick<
    AppConfig,
    | "runtimeDir"
    | "childEnvPassthrough"
    | "context"
    | "internalApiUrl"
    | "dataDir"
    | "agentProtectedPaths"
  >;
  sourceEnv?: NodeJS.ProcessEnv;
  plannerTimeouts?: { wallClockMs: number; idleMs: number; initMs: number };
  verifyIterations?: number;
}

interface Planner {
  runId: string;
  activity: PlanActivity;
  done: Promise<void>;
}

interface Driver {
  id: string;
  cancelled: boolean;
  running: Map<string, Promise<void>>;
  pulse: Promise<void>;
  wake: () => void;
  mergeChain: Promise<unknown>;
  done: Promise<void>;
}

const execFileAsync = promisify(execFile);
const MAP_BUDGET_TOKENS = 6_000;
const README_CHARS = 5_000;
const PLANNER_MAX_TURNS = 40;
const DEFAULT_VERIFY_ITERATIONS = 3;
const NODE_PRIORITY = 50;
const DEFAULT_PLANNER_TIMEOUTS = { wallClockMs: 25 * 60_000, idleMs: 5 * 60_000, initMs: 120_000 };

const NODE_TASK_STATUS: Readonly<Record<NodeState, TaskStatus | null>> = {
  pending: "DRAFT",
  running: null,
  verifying: null,
  merging: null,
  merged: "COMPLETED",
  conflict: null,
  failed: "FAILED",
  blocked: "CANCELLED",
  cancelled: "CANCELLED",
};

function shorten(text: string, length: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= length ? single : `${single.slice(0, length - 1)}…`;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "plan"
  );
}

function day(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll("-", "");
}

interface StoredPlan {
  nodes: Array<Pick<PlanNode, "key" | "tier">>;
  levels: Record<string, number>;
  warnings: string[];
}

function readStoredPlan(value: unknown): StoredPlan {
  const empty: StoredPlan = { nodes: [], levels: {}, warnings: [] };
  if (typeof value !== "object" || value === null) return empty;
  const record = value as Record<string, unknown>;
  const nodes = Array.isArray(record["nodes"])
    ? record["nodes"].flatMap((node): StoredPlan["nodes"] => {
        if (typeof node !== "object" || node === null) return [];
        const entry = node as Record<string, unknown>;
        if (typeof entry["key"] !== "string") return [];
        const tier = entry["tier"];
        return [
          {
            key: entry["key"],
            tier:
              tier === "SCOUT" || tier === "BUILDER" || tier === "ARCHITECT" || tier === "APEX"
                ? tier
                : null,
          },
        ];
      })
    : [];
  const levels: Record<string, number> = {};
  if (typeof record["levels"] === "object" && record["levels"] !== null) {
    for (const [key, level] of Object.entries(record["levels"] as Record<string, unknown>)) {
      if (typeof level === "number") levels[key] = level;
    }
  }
  return { nodes, levels, warnings: toStringArray(record["warnings"]) };
}

export class OrchestratorService {
  private readonly planners = new Map<string, Planner>();
  private readonly drivers = new Map<string, Driver>();
  private readonly states = new Map<string, OrchestrationDto>();
  private stopped = false;

  constructor(private readonly deps: OrchestratorDeps) {
    deps.hub.registerSnapshot("orchestration:", (channel) => {
      const state = this.states.get(channel.slice("orchestration:".length));
      return state ? [orchestrationStateMessage(state)] : [];
    });
    deps.approvals.register("PLAN", {
      approve: (approval, payload, actor) => this.approvePlan(approval, payload, actor),
      reject: (approval, payload, actor) => this.rejectPlan(approval, payload, actor),
    });
    deps.approvals.register("MERGE", {
      approve: (approval, payload) => this.retryMerge(approval, payload),
      reject: (approval, payload) => this.dropNode(approval, payload),
    });
  }

  async list(projectId: string): Promise<OrchestrationDto[]> {
    const rows = await this.deps.prisma.orchestration.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async get(id: string): Promise<OrchestrationDto> {
    const row = await this.deps.prisma.orchestration.findUnique({ where: { id } });
    if (!row) throw notFound("Plan");
    return this.toDto(row);
  }

  async create(projectId: string, input: CreateInput, actor: string): Promise<OrchestrationDto> {
    const { prisma, scheduler } = this.deps;
    if (this.stopped) throw conflict("Onyx is shutting down");
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { workspaces: { orderBy: { position: "asc" } } },
    });
    if (!project) throw notFound("Project");
    const firstWorkspace = project.workspaces[0];
    if (!firstWorkspace) throw badRequest("The project has no workspaces");
    const admission = this.deps.budgets.admit(projectId);
    if (admission.decision !== "go") throw conflict(admission.reason);
    const modelId = input.modelId ?? (await this.deps.router.referenceProfile())?.id;
    if (!modelId) throw badRequest("No enabled model for the planner");
    const reservation = scheduler.reserve(null);
    if (!reservation.ok)
      throw conflict(
        reservation.reason === "full"
          ? "Every agent slot is busy: try again shortly"
          : "Onyx is shutting down",
      );
    try {
      const root = await prisma.task.create({
        data: {
          projectId,
          workspaceId: firstWorkspace.id,
          title: `Plan: ${shorten(input.goal, 90)}`,
          prompt: input.goal,
          kind: "ARCHITECTURE",
          status: "PLANNING",
          startedAt: new Date(),
        },
      });
      const orchestration = await prisma.orchestration.create({
        data: {
          projectId,
          rootTaskId: root.id,
          goal: input.goal,
          parallelism: input.parallelism,
          verify: input.verify,
          plannerModelId: modelId,
        },
      });
      const planner: Planner = {
        runId: `plan-${orchestration.id}`,
        activity: { turns: 0, toolCalls: 0, lastAction: "Reading the project index" },
        done: Promise.resolve(),
      };
      this.planners.set(orchestration.id, planner);
      planner.done = this.plan(orchestration, planner)
        .catch((error: unknown) =>
          this.deps.logger.error(
            { err: error, orchestrationId: orchestration.id },
            "Planner crashed",
          ),
        )
        .finally(() => {
          reservation.release();
          this.planners.delete(orchestration.id);
          void this.publish(orchestration.id);
        });
      await this.audit(actor, "plan.requested", orchestration.id, { projectId, modelId });
      return this.publish(orchestration.id);
    } catch (error) {
      reservation.release();
      throw error;
    }
  }

  async settledPlanning(id: string): Promise<void> {
    await this.planners.get(id)?.done;
  }

  async settled(id: string): Promise<void> {
    await this.planners.get(id)?.done;
    await this.drivers.get(id)?.done;
  }

  async approve(id: string, actor: string): Promise<OrchestrationDto> {
    const approval = await this.deps.approvals.pendingFor("PLAN", `plan:${id}`);
    if (!approval) throw conflict("This plan is not waiting for approval");
    await this.deps.approvals.decide(approval.id, "approve", actor, null);
    return this.get(id);
  }

  async reject(id: string, actor: string): Promise<OrchestrationDto> {
    const approval = await this.deps.approvals.pendingFor("PLAN", `plan:${id}`);
    if (!approval) throw conflict("This plan is not waiting for approval");
    await this.deps.approvals.decide(approval.id, "reject", actor, null);
    return this.get(id);
  }

  async cancel(id: string, actor: string): Promise<OrchestrationDto> {
    const { prisma } = this.deps;
    const orchestration = await prisma.orchestration.findUnique({ where: { id } });
    if (!orchestration) throw notFound("Plan");
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(orchestration.status))
      throw conflict(`The plan is already ${orchestration.status.toLowerCase()}`);
    const planner = this.planners.get(id);
    if (planner) {
      await this.deps.pool.abort(planner.runId);
      await planner.done;
    }
    const driver = this.drivers.get(id);
    if (driver) {
      driver.cancelled = true;
      for (const taskId of driver.running.keys()) await this.stopNodeWork(taskId);
      driver.wake();
      await driver.done;
    }
    const nodes = await this.loadNodes(orchestration.rootTaskId);
    for (const node of nodes) {
      if (node.state !== "merged") await this.setNode(node.taskId, "cancelled", "Plan cancelled");
    }
    await this.deps.approvals.expire((payload) => payload.orchestrationId === id);
    await this.cleanupWorktrees(orchestration, true);
    await this.finish(id, "CANCELLED", "Cancelled by the operator", "CANCELLED");
    await this.audit(actor, "plan.cancelled", id, {});
    return this.get(id);
  }

  async resume(id: string, actor: string): Promise<OrchestrationDto> {
    const { prisma } = this.deps;
    const orchestration = await prisma.orchestration.findUnique({ where: { id } });
    if (!orchestration) throw notFound("Plan");
    if (orchestration.status !== "FAILED" || !orchestration.workBranch)
      throw conflict("Only a plan that stopped while running can be resumed");
    if (this.drivers.has(id)) throw conflict("The plan is already running");
    const nodes = await this.loadNodes(orchestration.rootTaskId);
    await this.deps.approvals.expire(
      (payload, approval) => approval.kind === "MERGE" && payload.orchestrationId === id,
    );
    for (const node of nodes) {
      if (node.state === "merged") continue;
      await this.resetNode(orchestration, node.taskId, node.key);
    }
    const repo = await this.repoOf(orchestration.projectId);
    if (orchestration.integrationPath) {
      await repo.removeWorktree(orchestration.integrationPath);
      await repo.addWorktree(
        orchestration.integrationPath,
        orchestration.workBranch,
        orchestration.workBranch,
      );
      await linkDependencies(repo.root, orchestration.integrationPath);
    }
    await prisma.orchestration.update({
      where: { id },
      data: { status: "RUNNING", message: null, endedAt: null },
    });
    await prisma.task.update({
      where: { id: orchestration.rootTaskId },
      data: { status: "RUNNING", resultSummary: null },
    });
    await this.audit(actor, "plan.resumed", id, {});
    this.startDriver(id);
    return this.publish(id);
  }

  async pushWorkBranch(id: string, actor: string): Promise<PublishPlanResult> {
    const orchestration = await this.deps.prisma.orchestration.findUnique({ where: { id } });
    if (!orchestration) throw notFound("Plan");
    if (orchestration.status !== "COMPLETED" || !orchestration.workBranch)
      throw conflict("Only a merged plan can be pushed");
    const result = await this.deps.git.pushBranch(
      orchestration.projectId,
      orchestration.workBranch,
      actor,
    );
    return { branch: orchestration.workBranch, ...result };
  }

  async recover(): Promise<void> {
    const { prisma } = this.deps;
    const stale = await prisma.orchestration.findMany({
      where: { status: { in: ["PLANNING", "RUNNING", "VERIFYING"] } },
    });
    for (const orchestration of stale) {
      const planning = orchestration.status === "PLANNING";
      await prisma.orchestration.update({
        where: { id: orchestration.id },
        data: {
          status: "FAILED",
          endedAt: new Date(),
          message: planning
            ? "Interrupted by an Onyx restart while planning"
            : "Interrupted by an Onyx restart: resume it to continue",
        },
      });
      await prisma.task.update({
        where: { id: orchestration.rootTaskId },
        data: { status: "FAILED" },
      });
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const planner of this.planners.values()) await this.deps.pool.abort(planner.runId);
    for (const driver of this.drivers.values()) {
      driver.cancelled = true;
      for (const taskId of driver.running.keys())
        await this.stopNodeWork(taskId).catch(() => undefined);
      driver.wake();
    }
    await Promise.allSettled([
      ...[...this.planners.values()].map((planner) => planner.done),
      ...[...this.drivers.values()].map((driver) => driver.done),
    ]);
  }

  private async plan(orchestration: Orchestration, planner: Planner): Promise<void> {
    const { prisma, pool, config } = this.deps;
    const fail = async (message: string) => {
      await this.finish(orchestration.id, "FAILED", message, "FAILED");
    };
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: orchestration.projectId },
      include: { workspaces: { orderBy: { position: "asc" } } },
    });
    const workspaces = project.workspaces.map((workspace) => ({
      name: workspace.name,
      domain: workspace.domain,
      pathGlobs: toStringArray(workspace.pathGlobs),
    }));
    const context = await this.deps.indexes
      .waitForIndex(project.id, config.context.indexWaitMs)
      .catch(() => null);
    const scope = await this.deps.surgeon.runScope(project.id, null);
    planner.activity.lastAction = "Collecting the README, the tests and the history";
    const [readme, gitLog, defaults] = await Promise.all([
      this.readme(project.rootPath),
      this.gitLog(project.rootPath),
      this.deps.tdd.defaults(orchestration.rootTaskId).catch(() => null),
    ]);
    const prompt = buildPlannerPrompt({
      projectName: project.name,
      goal: orchestration.goal,
      map: context ? context.projectMap(MAP_BUDGET_TOKENS, scope.policy).text : null,
      readme,
      workspaces,
      testRunner:
        defaults?.runner === "VITEST" ? "Vitest" : defaults?.runner === "JEST" ? "Jest" : null,
      gitLog,
    });
    const token = this.deps.runTokens.issue(planner.runId, project.id, {
      workspaceId: null,
      policy: scope.policy,
      guard: scope.guard,
      fence: null,
    });
    const mcpEnabled =
      config.context.enabled &&
      config.context.mcpServerPath !== null &&
      isReadableFile(config.context.mcpServerPath);
    const files = await writeRuntimeFiles({
      runtimeDir: config.runtimeDir,
      runId: planner.runId,
      settings: buildRunSettings({
        deny: [...scope.compiled.readDeny, ...scope.compiled.editDeny],
        protectedPaths: config.agentProtectedPaths,
        hooks: guardHooks(config.internalApiUrl),
      }),
      primer: null,
      mcpConfig:
        mcpEnabled && config.context.mcpServerPath !== null
          ? buildMcpConfig({
              serverPath: config.context.mcpServerPath,
              apiUrl: config.internalApiUrl,
              token,
            })
          : emptyMcpConfig(),
    });
    const modelId = orchestration.plannerModelId ?? "";
    let result: RunItemOf<"result"> | null = null;
    let exit: ProcessExit;
    planner.activity.lastAction = "Claude is studying the project";
    void this.publish(orchestration.id);
    try {
      exit = await pool.run(
        {
          runId: planner.runId,
          cwd: project.rootPath,
          prompt,
          model: modelId,
          fallbackModels: [],
          permissionMode: "plan",
          maxTurns: PLANNER_MAX_TURNS,
          session: { mode: "ephemeral" },
          allowedTools: [
            "Read",
            "Grep",
            "Glob",
            "LS",
            ...(mcpEnabled ? [ONYX_MCP_ALLOW_RULE] : []),
          ],
          disallowedTools: ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"],
          settingsFile: files.settingsFile,
          mcpConfigFile: files.mcpConfigFile,
          appendSystemPromptFile: null,
          includePartialMessages: false,
          env: {
            ...this.passthroughEnv(),
            ...(await this.deps.credentials.childEnv()),
            [RUN_TOKEN_ENV]: token,
          },
          timeouts: this.deps.plannerTimeouts ?? DEFAULT_PLANNER_TIMEOUTS,
          jsonSchema: JSON.stringify(PLAN_JSON_SCHEMA),
        },
        {
          onSpawn: () => undefined,
          onEvent: (event) => {
            for (const item of normalizeClaudeEvent(event)) {
              if (item.kind === "tool_use") {
                planner.activity.toolCalls += 1;
                planner.activity.lastAction = shortAction(item);
                void this.publish(orchestration.id);
              } else if (item.kind === "turn_usage") {
                planner.activity.turns += 1;
              } else if (item.kind === "result") {
                result = item;
              }
            }
          },
          onInvalidLine: () => undefined,
          onStderr: () => undefined,
          onHandlerError: (error) =>
            this.deps.logger.warn(
              { err: error, orchestrationId: orchestration.id },
              "Planner handler failed",
            ),
        },
      );
    } finally {
      this.deps.runTokens.revoke(planner.runId);
    }
    const final = result as RunItemOf<"result"> | null;
    if (exit.reason !== "completed" || !final) {
      return fail(
        exit.reason === "aborted" || exit.reason === "shutdown"
          ? "Planning was interrupted"
          : `Claude Code stopped before answering (${exit.reason})`,
      );
    }
    const costUsd = await this.recordUsage(modelId, final);
    void this.deps.budgets.refresh().catch(() => undefined);
    await prisma.orchestration.update({
      where: { id: orchestration.id },
      data: { plannerCostUsd: costUsd, plannerTurns: final.numTurns },
    });
    if (final.isError) {
      return fail(
        `Claude Code reported an error: ${(final.resultText ?? final.subtype).slice(0, 300)}`,
      );
    }
    let validated: ValidatedPlan;
    try {
      validated = validatePlan(extractPlan(final.structuredOutput, final.resultText), workspaces);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    await this.storePlan(orchestration, project.workspaces, validated);
  }

  private async storePlan(
    orchestration: Orchestration,
    workspaces: ReadonlyArray<{ id: string; name: string }>,
    plan: ValidatedPlan,
  ): Promise<void> {
    const { prisma } = this.deps;
    const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace.id]));
    const fallback = workspaces[0]?.id ?? null;
    const ids = new Map<string, string>();
    const nodes = plan.order
      .map((key) => plan.nodes.find((node) => node.key === key))
      .filter((node): node is PlanNode => node !== undefined);
    for (const node of nodes) {
      const workspaceId =
        (node.workspace ? byName.get(node.workspace) : undefined) ??
        (await this.deps.router
          .inferWorkspace(orchestration.projectId, node.targetPaths, node.description)
          .catch(() => null)) ??
        fallback;
      const task = await prisma.task.create({
        data: {
          projectId: orchestration.projectId,
          workspaceId,
          parentTaskId: orchestration.rootTaskId,
          title: node.title,
          prompt: node.description,
          kind: node.kind,
          status: "AWAITING_APPROVAL",
          priority: -(plan.levels[node.key] ?? 0),
          targetPaths: node.targetPaths,
          acceptance: node.acceptance,
          planKey: node.key,
          mergeState: "pending",
        },
      });
      ids.set(node.key, task.id);
    }
    const edges = nodes.flatMap((node) =>
      node.dependsOn.flatMap((dep) => {
        const taskId = ids.get(node.key);
        const dependsOnId = ids.get(dep);
        return taskId && dependsOnId ? [{ taskId, dependsOnId }] : [];
      }),
    );
    if (edges.length > 0) await prisma.taskDependency.createMany({ data: edges });
    await prisma.orchestration.update({
      where: { id: orchestration.id },
      data: {
        status: "AWAITING_APPROVAL",
        summary: plan.summary,
        plan: {
          summary: plan.summary,
          nodes: nodes.map((node) => ({ key: node.key, tier: node.tier })),
          levels: plan.levels,
          warnings: plan.warnings,
        },
      },
    });
    await prisma.task.update({
      where: { id: orchestration.rootTaskId },
      data: { status: "AWAITING_APPROVAL" },
    });
    const project = await prisma.project.findUnique({
      where: { id: orchestration.projectId },
      select: { name: true },
    });
    await this.deps.approvals.create({
      kind: "PLAN",
      title: `Plan for ${project?.name ?? "the project"}: ${shorten(orchestration.goal, 80)}`,
      projectId: orchestration.projectId,
      taskId: orchestration.rootTaskId,
      payload: {
        key: `plan:${orchestration.id}`,
        orchestrationId: orchestration.id,
        detail: `${nodes.length} task${nodes.length === 1 ? "" : "s"}: ${plan.summary}`,
        link: `/projects/${orchestration.projectId}/plans/${orchestration.id}`,
        approveLabel: "Approve and run",
        rejectLabel: "Discard the plan",
      },
    });
  }

  private async approvePlan(
    _approval: Approval,
    payload: ApprovalPayload,
    actor: string,
  ): Promise<void> {
    const id = payload.orchestrationId;
    if (!id) return;
    const { prisma } = this.deps;
    const orchestration = await prisma.orchestration.findUnique({ where: { id } });
    if (!orchestration) throw notFound("Plan");
    if (orchestration.status !== "AWAITING_APPROVAL")
      throw conflict("This plan is not waiting for approval");
    const admission = this.deps.budgets.admit(orchestration.projectId);
    if (admission.decision === "deny") throw conflict(admission.reason);
    const repo = await this.repoOf(orchestration.projectId);
    if (!(await repo.isRepo()))
      throw badRequest("Plans run in git worktrees: the project folder must be a git repository");
    const head = await repo.head();
    const now = new Date();
    let workBranch = `onyx/plan-${day(now)}-${slug(orchestration.goal)}`;
    for (let suffix = 2; await repo.branchExists(workBranch); suffix += 1)
      workBranch = `onyx/plan-${day(now)}-${slug(orchestration.goal)}-${suffix}`;
    await repo.createBranch(workBranch, head.commit);
    const integrationPath = join(this.worktreesRoot(orchestration.projectId), id, "_integration");
    await repo.removeWorktree(integrationPath);
    await repo.addWorktree(integrationPath, workBranch, workBranch);
    await linkDependencies(repo.root, integrationPath);
    await prisma.orchestration.update({
      where: { id },
      data: {
        status: "RUNNING",
        approvedAt: now,
        startedAt: now,
        baseBranch: head.branch,
        baseCommit: head.commit,
        workBranch,
        integrationPath,
      },
    });
    await prisma.task.update({
      where: { id: orchestration.rootTaskId },
      data: { status: "RUNNING" },
    });
    await prisma.task.updateMany({
      where: { parentTaskId: orchestration.rootTaskId },
      data: { status: "DRAFT" },
    });
    await this.audit(actor, "plan.approved", id, { workBranch });
    this.startDriver(id);
    await this.publish(id);
  }

  private async rejectPlan(
    _approval: Approval,
    payload: ApprovalPayload,
    actor: string,
  ): Promise<void> {
    const id = payload.orchestrationId;
    if (!id) return;
    const orchestration = await this.deps.prisma.orchestration.findUnique({ where: { id } });
    if (!orchestration || orchestration.status !== "AWAITING_APPROVAL") return;
    await this.deps.prisma.task.updateMany({
      where: { parentTaskId: orchestration.rootTaskId },
      data: { status: "CANCELLED", mergeState: "cancelled" },
    });
    await this.finish(id, "CANCELLED", "Plan discarded", "CANCELLED");
    await this.audit(actor, "plan.rejected", id, {});
  }

  private startDriver(id: string): void {
    let wake: () => void = () => undefined;
    const driver: Driver = {
      id,
      cancelled: false,
      running: new Map(),
      pulse: new Promise<void>((resolve) => {
        wake = resolve;
      }),
      wake: () => undefined,
      mergeChain: Promise.resolve(),
      done: Promise.resolve(),
    };
    driver.wake = () => {
      const current = wake;
      driver.pulse = new Promise<void>((resolve) => {
        wake = resolve;
      });
      current();
    };
    this.drivers.set(id, driver);
    driver.done = this.drive(driver)
      .catch(async (error: unknown) => {
        this.deps.logger.error({ err: error, orchestrationId: id }, "Plan driver crashed");
        await this.finish(
          id,
          "FAILED",
          error instanceof Error ? error.message : String(error),
          "FAILED",
        ).catch(() => undefined);
      })
      .finally(() => {
        this.drivers.delete(id);
        void this.publish(id);
      });
  }

  private async drive(driver: Driver): Promise<void> {
    const { prisma } = this.deps;
    for (;;) {
      if (driver.cancelled || this.stopped) {
        await Promise.allSettled(driver.running.values());
        return;
      }
      const orchestration = await prisma.orchestration.findUniqueOrThrow({
        where: { id: driver.id },
      });
      const nodes = await this.loadNodes(orchestration.rootTaskId);
      const dag: DagNode[] = nodes.map((node) => ({
        key: node.key,
        dependsOn: node.dependsOn,
        state: driver.running.has(node.taskId) && node.state === "pending" ? "running" : node.state,
      }));
      const blocked = newlyBlocked(dag);
      if (blocked.length > 0) {
        for (const key of blocked) {
          const node = nodes.find((entry) => entry.key === key);
          if (node) await this.setNode(node.taskId, "blocked", "A task it depends on failed");
        }
        continue;
      }
      const capacity = orchestration.parallelism - Math.max(driver.running.size, activeCount(dag));
      for (const key of readyNodes(dag).slice(0, Math.max(0, capacity))) {
        const node = nodes.find((entry) => entry.key === key);
        if (!node) continue;
        await this.setNode(node.taskId, "running", null);
        const work = this.runNode(driver, orchestration, node.taskId).finally(() => {
          driver.running.delete(node.taskId);
          driver.wake();
        });
        driver.running.set(node.taskId, work);
      }
      await this.publish(driver.id);
      if (driver.running.size === 0) {
        const outcome = dagOutcome(
          (await this.loadNodes(orchestration.rootTaskId)).map((node) => ({
            key: node.key,
            dependsOn: node.dependsOn,
            state: node.state,
          })),
        );
        if (outcome === "merged") return this.finalize(driver, orchestration);
        if (outcome === "failed") {
          const failed = (await this.loadNodes(orchestration.rootTaskId)).filter(
            (node) => node.state === "failed",
          );
          return this.finish(
            driver.id,
            "FAILED",
            `${failed.length} task${failed.length === 1 ? "" : "s"} failed: ${failed.map((node) => node.title).join(", ")}`,
            "FAILED",
          );
        }
        if (outcome === "waiting") {
          await prisma.orchestration.update({
            where: { id: driver.id },
            data: { message: "Waiting for a merge decision in Approvals" },
          });
          await this.publish(driver.id);
          await driver.pulse;
          await prisma.orchestration.update({ where: { id: driver.id }, data: { message: null } });
          continue;
        }
      }
      await Promise.race([...driver.running.values(), driver.pulse]);
    }
  }

  private async runNode(
    driver: Driver,
    orchestration: Orchestration,
    taskId: string,
  ): Promise<void> {
    const { prisma, scheduler, tdd } = this.deps;
    try {
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          dependsOn: { include: { dependsOn: { select: { title: true, resultSummary: true } } } },
        },
      });
      if (!task.workspaceId) throw new Error("The task has no workspace");
      const key = task.planKey ?? task.id;
      const repo = await this.repoOf(orchestration.projectId);
      const workBranch = orchestration.workBranch ?? "";
      const path = join(this.worktreesRoot(orchestration.projectId), orchestration.id, key);
      const branch = `${workBranch}--${key}`;
      await repo.removeWorktree(path);
      if (await repo.branchExists(branch)) await repo.run(["branch", "-D", branch]);
      await repo.addWorktree(path, branch, workBranch);
      const excludes = await linkDependencies(repo.root, path);
      await prisma.task.update({
        where: { id: taskId },
        data: { worktreePath: path, branchName: branch, status: "QUEUED" },
      });
      await this.publish(orchestration.id);

      const siblings = await prisma.task.findMany({
        where: { parentTaskId: orchestration.rootTaskId, id: { not: taskId } },
        include: { workspace: { select: { name: true } } },
      });
      const stored = readStoredPlan(orchestration.plan);
      const tier = stored.nodes.find((node) => node.key === key)?.tier ?? null;
      const prompt = nodePrompt({
        goal: orchestration.goal,
        summary: orchestration.summary ?? "",
        node: {
          key,
          title: task.title,
          description: task.prompt,
          workspace: null,
          kind: task.kind,
          tier,
          dependsOn: [],
          targetPaths: toStringArray(task.targetPaths),
          acceptance: toStringArray(task.acceptance),
        },
        dependencies: task.dependsOn.map((edge) => ({
          title: edge.dependsOn.title,
          summary: edge.dependsOn.resultSummary,
        })),
        siblings: siblings.map((sibling) => ({
          title: sibling.title,
          workspace: sibling.workspace?.name ?? null,
        })),
      });
      const result = await scheduler.runAndWait({
        request: {
          taskId,
          modelId: null,
          agentConfigId: null,
          prompt,
          newSession: true,
          tierHint: tier ? { tier, reason: "suggested by the plan" } : null,
        },
        workspaceId: task.workspaceId,
        projectId: orchestration.projectId,
        lockKey: `task:${taskId}`,
        priority: NODE_PRIORITY,
        enqueuedAt: Date.now(),
      });
      if (driver.cancelled) return;
      const run = result
        ? await prisma.agentRun.findUnique({
            where: { id: result.runId },
            select: { status: true, resultSubtype: true, errorMessage: true },
          })
        : null;
      if (!run) {
        const latest = await prisma.task.findUnique({
          where: { id: taskId },
          select: { resultSummary: true },
        });
        throw new Error(latest?.resultSummary ?? "The agent run could not start");
      }
      if (run.status !== "COMPLETED" && run.resultSubtype !== "error_max_turns")
        throw new Error(
          `The agent run ended ${run.status.toLowerCase()}: ${run.errorMessage ?? "no details"}`,
        );

      if (orchestration.verify) {
        const defaults = await tdd.defaults(taskId);
        if (defaults.runner) {
          await this.setNode(taskId, "verifying", null);
          const loop = await tdd.start(
            taskId,
            {
              maxIterations: this.deps.verifyIterations ?? DEFAULT_VERIFY_ITERATIONS,
              budgetUsd: null,
              testTimeoutSec: 300,
              typecheck: defaults.typecheckCommand !== null,
              lint: false,
            },
            "orchestrator",
          );
          const final = await tdd.settled(loop.id);
          if (driver.cancelled) return;
          if (final.status !== "GREEN")
            throw new Error(
              `The tests did not pass: ${final.message ?? final.status.toLowerCase()}`,
            );
        }
      }

      const env = await this.deps.git.commitEnv();
      await repo.commitAll(path, `Onyx: ${task.title}`, env, excludes);
      await this.mergeNode(driver, orchestration, taskId);
    } catch (error) {
      if (driver.cancelled) return;
      await this.setNode(taskId, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  private async mergeNode(
    driver: Driver | null,
    orchestration: Orchestration,
    taskId: string,
  ): Promise<void> {
    const { prisma } = this.deps;
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (!task.branchName || !orchestration.integrationPath)
      throw new Error("The task has no branch to merge");
    await this.setNode(taskId, "merging", null);
    const repo = await this.repoOf(orchestration.projectId);
    const env = await this.deps.git.commitEnv();
    const merge = () =>
      repo.merge(
        orchestration.integrationPath ?? "",
        task.branchName ?? "",
        `Merge "${task.title}" (Onyx plan)`,
        env,
      );
    const outcome = driver
      ? await (driver.mergeChain = driver.mergeChain.then(merge, merge))
      : await merge();
    if (outcome.ok) {
      await prisma.task.update({
        where: { id: taskId },
        data: { mergeCommit: outcome.commit, mergedAt: new Date() },
      });
      await this.setNode(taskId, "merged", null);
      if (task.worktreePath) await repo.removeWorktree(task.worktreePath);
      await repo.run(["branch", "-D", task.branchName ?? ""]).catch(() => undefined);
      return;
    }
    await this.setNode(taskId, "conflict", `Merge conflict in ${outcome.conflicts.join(", ")}`);
    await this.deps.approvals.create({
      kind: "MERGE",
      title: `Merge conflict: ${task.title}`,
      projectId: orchestration.projectId,
      taskId,
      payload: {
        key: `merge:${taskId}`,
        orchestrationId: orchestration.id,
        detail: `${task.branchName} conflicts with ${orchestration.workBranch} in ${outcome.conflicts.length} file(s). Resolve it on ${task.branchName} (for example in ${task.worktreePath ?? "its worktree"}) and retry, or drop the task.`,
        files: outcome.conflicts,
        link: `/projects/${orchestration.projectId}/plans/${orchestration.id}`,
        approveLabel: "Retry the merge",
        rejectLabel: "Drop this task",
      },
    });
  }

  private async retryMerge(approval: Approval, payload: ApprovalPayload): Promise<void> {
    const id = payload.orchestrationId;
    if (!id || !approval.taskId) return;
    const orchestration = await this.deps.prisma.orchestration.findUnique({ where: { id } });
    if (!orchestration) throw notFound("Plan");
    const driver = this.drivers.get(id) ?? null;
    await this.mergeNode(driver, orchestration, approval.taskId);
    driver?.wake();
    await this.publish(id);
  }

  private async dropNode(approval: Approval, payload: ApprovalPayload): Promise<void> {
    const id = payload.orchestrationId;
    if (!id || !approval.taskId) return;
    await this.setNode(approval.taskId, "failed", "Merge declined: the task was dropped");
    this.drivers.get(id)?.wake();
    await this.publish(id);
  }

  private async finalize(driver: Driver, orchestration: Orchestration): Promise<void> {
    const { prisma, tdd } = this.deps;
    const id = orchestration.id;
    const integration = orchestration.integrationPath;
    const nodes = await this.loadNodes(orchestration.rootTaskId);
    if (orchestration.verify && integration) {
      await prisma.orchestration.update({ where: { id }, data: { status: "VERIFYING" } });
      await prisma.task.update({
        where: { id: orchestration.rootTaskId },
        data: {
          status: "COMPLETED",
          worktreePath: integration,
          branchName: orchestration.workBranch,
        },
      });
      await this.publish(id);
      const defaults = await tdd.defaults(orchestration.rootTaskId);
      if (defaults.runner) {
        const loop = await tdd.start(
          orchestration.rootTaskId,
          {
            maxIterations: this.deps.verifyIterations ?? DEFAULT_VERIFY_ITERATIONS,
            budgetUsd: null,
            testTimeoutSec: 600,
            typecheck: defaults.typecheckCommand !== null,
            lint: false,
            relatedFiles: [],
          },
          "orchestrator",
        );
        const final = await tdd.settled(loop.id);
        if (driver.cancelled) return;
        if (final.status !== "GREEN")
          return this.finish(
            id,
            "FAILED",
            `The merged branch does not pass the tests: ${final.message ?? final.status.toLowerCase()}`,
            "FAILED",
          );
        const repo = await this.repoOf(orchestration.projectId);
        await repo.commitAll(
          integration,
          "Onyx: integration fixes",
          await this.deps.git.commitEnv(),
          await linkDependencies(repo.root, integration),
        );
      }
    }
    await this.cleanupWorktrees(orchestration, false);
    await this.finish(
      id,
      "COMPLETED",
      `Merged ${nodes.length} task${nodes.length === 1 ? "" : "s"} into ${orchestration.workBranch ?? "the work branch"}`,
      "COMPLETED",
    );
  }

  private async finish(
    id: string,
    status: OrchestrationStatus,
    message: string,
    rootStatus: TaskStatus,
  ): Promise<void> {
    const { prisma } = this.deps;
    const orchestration = await prisma.orchestration.update({
      where: { id },
      data: { status, message, endedAt: new Date() },
    });
    await prisma.task.update({
      where: { id: orchestration.rootTaskId },
      data: {
        status: rootStatus,
        resultSummary: message,
        ...(rootStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
    });
    this.deps.hub.publishTaskStatus({
      taskId: orchestration.rootTaskId,
      projectId: orchestration.projectId,
      status: rootStatus,
      runId: null,
    });
    await this.publish(id);
  }

  private async cleanupWorktrees(
    orchestration: Orchestration,
    includeNodes: boolean,
  ): Promise<void> {
    const repo = await this.repoOf(orchestration.projectId).catch(() => null);
    if (!repo) return;
    const nodes = await this.loadNodes(orchestration.rootTaskId);
    for (const node of nodes) {
      if (!node.worktreePath) continue;
      if (includeNodes || node.state === "merged") await repo.removeWorktree(node.worktreePath);
    }
    if (orchestration.integrationPath) await repo.removeWorktree(orchestration.integrationPath);
    await this.deps.prisma.task.update({
      where: { id: orchestration.rootTaskId },
      data: { worktreePath: null },
    });
  }

  private async resetNode(
    orchestration: Orchestration,
    taskId: string,
    key: string,
  ): Promise<void> {
    const repo = await this.repoOf(orchestration.projectId);
    const path = join(this.worktreesRoot(orchestration.projectId), orchestration.id, key);
    await repo.removeWorktree(path);
    await this.deps.prisma.task.update({
      where: { id: taskId },
      data: { mergeState: "pending", status: "DRAFT", worktreePath: null, resultSummary: null },
    });
  }

  private async stopNodeWork(taskId: string): Promise<void> {
    await this.deps.tdd.abortForTask(taskId, "orchestrator").catch(() => false);
    if (!this.deps.scheduler.removeQueued(taskId)) await this.deps.scheduler.abortTask(taskId);
  }

  private async setNode(taskId: string, state: NodeState, message: string | null): Promise<void> {
    const status = NODE_TASK_STATUS[state];
    const task = await this.deps.prisma.task.update({
      where: { id: taskId },
      data: {
        mergeState: state,
        ...(status ? { status } : {}),
        ...(message !== null &&
        (state === "failed" || state === "blocked" || state === "conflict" || state === "cancelled")
          ? { resultSummary: message }
          : {}),
        ...(state === "merged" ? { completedAt: new Date() } : {}),
      },
    });
    if (status)
      this.deps.hub.publishTaskStatus({
        taskId,
        projectId: task.projectId,
        status,
        runId: null,
      });
  }

  private async loadNodes(rootTaskId: string) {
    const tasks = await this.deps.prisma.task.findMany({
      where: { parentTaskId: rootTaskId },
      include: {
        workspace: { select: { name: true } },
        dependsOn: { include: { dependsOn: { select: { planKey: true, id: true } } } },
        runs: {
          select: { costUsd: true, modelId: true, startedAt: true },
          orderBy: { startedAt: "desc" },
        },
        tddLoops: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    return tasks.map((task) => ({
      taskId: task.id,
      key: task.planKey ?? task.id,
      title: task.title,
      task,
      state: parseNodeState(task.mergeState) as NodeState,
      dependsOn: task.dependsOn.map((edge) => edge.dependsOn.planKey ?? edge.dependsOn.id),
      worktreePath: task.worktreePath,
    }));
  }

  private async publish(id: string): Promise<OrchestrationDto> {
    const dto = await this.get(id);
    const live = this.planners.has(id) || this.drivers.has(id);
    if (live) this.states.set(id, dto);
    else this.states.delete(id);
    this.deps.hub.publishOrchestration(dto);
    return dto;
  }

  private async toDto(row: Orchestration): Promise<OrchestrationDto> {
    const nodes = await this.loadNodes(row.rootTaskId);
    const stored = readStoredPlan(row.plan);
    const approval = await this.deps.approvals.pendingFor("PLAN", `plan:${row.id}`);
    const rootLoop = await this.deps.prisma.tddLoop.findFirst({
      where: { taskId: row.rootTaskId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const rootRuns = await this.deps.prisma.agentRun.aggregate({
      _sum: { costUsd: true },
      where: { taskId: row.rootTaskId },
    });
    const dtoNodes: OrchestrationNode[] = nodes.map((node) => {
      const task = node.task;
      return {
        taskId: task.id,
        key: node.key,
        title: task.title,
        description: task.prompt,
        kind: task.kind,
        tier: stored.nodes.find((entry) => entry.key === node.key)?.tier ?? null,
        workspaceId: task.workspaceId,
        workspaceName: task.workspace?.name ?? null,
        dependsOn: node.dependsOn,
        level: stored.levels[node.key] ?? 0,
        targetPaths: toStringArray(task.targetPaths),
        acceptance: toStringArray(task.acceptance),
        state: node.state as NodeStateName,
        taskStatus: task.status,
        branch: task.branchName,
        worktreePath: task.worktreePath,
        mergeCommit: task.mergeCommit,
        mergedAt: task.mergedAt?.toISOString() ?? null,
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        costUsd: task.runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
        runs: task.runs.length,
        lastModelId: task.runs[0]?.modelId ?? null,
        tddLoopId: task.tddLoops[0]?.id ?? null,
        message: task.resultSummary,
      };
    });
    const nodesCost = dtoNodes.reduce((sum, node) => sum + node.costUsd, 0);
    return {
      id: row.id,
      projectId: row.projectId,
      rootTaskId: row.rootTaskId,
      status: row.status,
      goal: row.goal,
      summary: row.summary,
      warnings: stored.warnings,
      baseBranch: row.baseBranch,
      baseCommit: row.baseCommit,
      workBranch: row.workBranch,
      parallelism: row.parallelism,
      verify: row.verify,
      plannerModelId: row.plannerModelId,
      plannerCostUsd: row.plannerCostUsd,
      costUsd: nodesCost + (rootRuns._sum.costUsd ?? 0) + (row.plannerCostUsd ?? 0),
      message: row.message,
      activity: this.planners.get(row.id)?.activity ?? null,
      approvalId: approval?.id ?? null,
      verifyLoopId: rootLoop?.id ?? null,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      nodes: dtoNodes,
    };
  }

  private async recordUsage(modelId: string, result: RunItemOf<"result">): Promise<number | null> {
    const profile = await this.deps.prisma.modelProfile.findUnique({ where: { id: modelId } });
    const costUsd = result.costUsd ?? (profile ? priceUsage(result.usage, profile) : null);
    await this.deps.prisma.tokenLog
      .create({
        data: { modelId, scope: "AUX", purpose: "planner", ...result.usage, costUsd },
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Planner token log failed"));
    return costUsd;
  }

  private async readme(root: string): Promise<string | null> {
    for (const name of ["README.md", "readme.md", "README"]) {
      const content = await readFile(join(root, name), "utf8").catch(() => null);
      if (content !== null) return content.slice(0, README_CHARS);
    }
    return null;
  }

  private async gitLog(root: string): Promise<string[]> {
    const output = await execFileAsync("git", safeGitArgs(["log", "--oneline", "-15"]), {
      cwd: root,
      env: gitEnvironment(),
      timeout: 15_000,
    }).catch(() => null);
    return output ? output.stdout.split("\n").filter((line) => line.trim().length > 0) : [];
  }

  private async repoOf(projectId: string): Promise<GitRepo> {
    const project = await this.deps.prisma.project.findUnique({
      where: { id: projectId },
      select: { rootPath: true },
    });
    if (!project) throw notFound("Project");
    return new GitRepo(project.rootPath, { ...process.env, ...this.deps.sourceEnv });
  }

  private worktreesRoot(projectId: string): string {
    return join(this.deps.config.dataDir, "worktrees", projectId);
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

  private async audit(actor: string, action: string, target: string, meta: object): Promise<void> {
    await this.deps.prisma.auditLog
      .create({ data: { actor, action, target, meta: { ...meta } } })
      .catch(() => undefined);
  }
}
