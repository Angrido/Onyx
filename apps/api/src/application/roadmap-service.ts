import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentPool, ProcessExit } from "@onyx/agent-runtime";
import {
  normalizeClaudeEvent,
  RoadmapLanguageSchema,
  type GenerateRoadmapRequestSchema,
  type ProjectBoard,
  type RoadmapActivity,
  type RoadmapEffort,
  type RoadmapGenerationDto,
  type RoadmapItemDto,
  type RunItemOf,
  type TaskDto,
} from "@onyx/contracts";
import type { PrismaClient, RoadmapGeneration, RoadmapItem } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import type { AppConfig } from "../config";
import { buildRunSettings, guardHooks, RUN_TOKEN_ENV } from "../domain/permission-rules";
import {
  buildRoadmapPrompt,
  collectTodos,
  parseRoadmap,
  PRIORITY_WEIGHT,
  taskPromptFor,
  withoutDuplicates,
  type RoadmapProposal,
} from "../domain/roadmap";
import { AppError, conflict, notFound } from "../errors";
import { ErrorCode } from "@onyx/contracts";
import { msg, tx } from "../i18n";
import {
  buildMcpConfig,
  emptyMcpConfig,
  isReadableFile,
  ONYX_MCP_ALLOW_RULE,
} from "../infrastructure/mcp-config";
import type { RunTokenRegistry } from "../infrastructure/run-tokens";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import { EXPLORER_AGENTS, EXPLORER_HINT, EXPLORER_TOOLS } from "../domain/exploration";
import type { OptionsService } from "./options-service";
import type { CredentialService } from "./credential-service";
import type { IndexService } from "./index-service";
import { toStringArray } from "./mappers";
import { priceUsage, type RouterService } from "./router-service";
import type { SlotReservation } from "./run-scheduler";
import type { SurgeonService } from "./surgeon-service";
import type { TaskService } from "./task-service";
import { gitEnvironment, safeGitArgs } from "../infrastructure/git-env";

type GenerateInput = z.output<typeof GenerateRoadmapRequestSchema>;

export interface RoadmapServiceDeps {
  options?: Pick<OptionsService, "get">;
  prisma: PrismaClient;
  logger: Logger;
  pool: AgentPool;
  indexes: IndexService;
  surgeon: SurgeonService;
  router: RouterService;
  tasks: TaskService;
  runTokens: RunTokenRegistry;
  credentials: Pick<CredentialService, "childEnv">;
  config: Pick<
    AppConfig,
    "runtimeDir" | "childEnvPassthrough" | "context" | "internalApiUrl" | "agentProtectedPaths"
  >;
  reserve: (workspaceId: string | null) => SlotReservation;
  sourceEnv?: NodeJS.ProcessEnv;
  timeouts?: { wallClockMs: number; idleMs: number; initMs: number };
}

interface ActiveGeneration {
  runId: string;
  activity: RoadmapActivity;
  done: Promise<void>;
}

const execFileAsync = promisify(execFile);
const MAP_BUDGET_TOKENS = 6_000;
const README_CHARS = 6_000;
const MANIFEST_CHARS = 2_500;
const MAX_TODO_FILES = 400;
const MAX_TODO_FILE_BYTES = 200_000;
const MAX_TURNS = 30;
const DEFAULT_TIMEOUTS = { wallClockMs: 20 * 60_000, idleMs: 4 * 60_000, initMs: 120_000 };
const MANIFEST_NAMES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "pom.xml",
];
const TEXT_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|py|go|rs|rb|php|java|kt|cs|swift|vue|svelte|css|scss|md|ya?ml|toml|sql|sh)$/i;

const FIXED_TEXTS: ReadonlySet<string> = new Set([
  msg("Interrupted"),
  msg("The roadmap was interrupted"),
  msg("Claude did not return a roadmap in the expected JSON format"),
  msg("Reading the project index"),
  msg("Collecting README, manifests, TODOs and history"),
  msg("Claude is studying the project"),
]);

function localized<T extends string | null>(text: T): T {
  return (text !== null && FIXED_TEXTS.has(text) ? tx(text) : text) as T;
}

function toItemDto(item: RoadmapItem): RoadmapItemDto {
  return {
    id: item.id,
    projectId: item.projectId,
    generationId: item.generationId,
    title: item.title,
    description: item.description,
    kind: item.kind,
    priority: item.priority,
    effort: (["S", "M", "L"].includes(item.effort) ? item.effort : "M") as RoadmapEffort,
    workspaceName: item.workspaceName,
    targetPaths: toStringArray(item.targetPaths),
    rationale: item.rationale,
    status: item.status,
    taskId: item.taskId,
    createdAt: item.createdAt.toISOString(),
  };
}

export function shortAction(item: RunItemOf<"tool_use">): string {
  const input = item.input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of ["file_path", "path", "pattern", "query", "handle"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0)
        return `${item.name} ${value}`.slice(0, 160);
    }
  }
  return item.name;
}

export class RoadmapService {
  private readonly active = new Map<string, ActiveGeneration>();

  constructor(private readonly deps: RoadmapServiceDeps) {}

  async board(projectId: string): Promise<ProjectBoard> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const [generation, items, tasks] = await Promise.all([
      prisma.roadmapGeneration.findFirst({ where: { projectId }, orderBy: { startedAt: "desc" } }),
      prisma.roadmapItem.findMany({
        where: { projectId, status: { in: ["SUGGESTED", "ACCEPTED"] } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      this.deps.tasks.list({ projectId, limit: 200 }),
    ]);
    return {
      projectId,
      generation: generation ? this.toGenerationDto(generation) : null,
      suggestions: items.filter((item) => item.status === "SUGGESTED").map(toItemDto),
      accepted: items.filter((item) => item.status === "ACCEPTED").map(toItemDto),
      tasks,
    };
  }

  async generate(
    projectId: string,
    input: GenerateInput,
    actor: string,
  ): Promise<RoadmapGenerationDto> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const running = await prisma.roadmapGeneration.findFirst({
      where: { projectId, status: "RUNNING" },
    });
    if (running && this.active.has(running.id))
      throw conflict("A roadmap is already being generated");
    if (running) {
      await prisma.roadmapGeneration.update({
        where: { id: running.id },
        data: { status: "FAILED", error: "Interrupted", endedAt: new Date() },
      });
    }
    const cheap = (await this.deps.options?.get())?.cheapExploration === true;
    const modelId =
      input.modelId ??
      (cheap ? (await this.deps.router.profileForTier("BUILDER"))?.id : undefined) ??
      (await this.deps.router.referenceProfile())?.id;
    if (!modelId) throw new AppError(400, ErrorCode.BadRequest, "No enabled model for the roadmap");
    const reservation = this.deps.reserve(null);
    if (!reservation.ok) {
      throw conflict(
        reservation.reason === "full"
          ? "Every agent slot is busy: try again shortly"
          : "Onyx is shutting down",
      );
    }
    const generation = await prisma.roadmapGeneration.create({
      data: {
        projectId,
        modelId,
        language: input.language,
        focus: input.focus && input.focus.length > 0 ? input.focus : null,
      },
    });
    const entry: ActiveGeneration = {
      runId: `roadmap-${generation.id}`,
      activity: { turns: 0, toolCalls: 0, lastAction: "Reading the project index" },
      done: Promise.resolve(),
    };
    this.active.set(generation.id, entry);
    entry.done = this.run(generation, entry)
      .catch((error: unknown) =>
        this.deps.logger.error({ err: error, generationId: generation.id }, "Roadmap failed"),
      )
      .finally(() => {
        reservation.release();
        this.active.delete(generation.id);
      });
    await prisma.auditLog
      .create({
        data: { actor, action: "roadmap.generate", target: projectId, meta: { modelId } },
      })
      .catch(() => undefined);
    return this.toGenerationDto(generation);
  }

  async settled(generationId: string): Promise<void> {
    await this.active.get(generationId)?.done;
  }

  async accept(itemId: string, workspaceId: string | null, actor: string): Promise<TaskDto> {
    const { prisma } = this.deps;
    const item = await prisma.roadmapItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound("Roadmap item");
    if (item.status !== "SUGGESTED") throw conflict("This suggestion was already handled");
    const workspaces = await prisma.workspace.findMany({
      where: { projectId: item.projectId },
      orderBy: { position: "asc" },
    });
    const named = item.workspaceName
      ? workspaces.find(
          (workspace) => workspace.name.toLowerCase() === item.workspaceName?.toLowerCase(),
        )
      : undefined;
    const targetPaths = toStringArray(item.targetPaths);
    const base = {
      projectId: item.projectId,
      title: item.title,
      prompt: taskPromptFor({
        description: item.description,
        rationale: item.rationale,
        targetPaths,
      }),
      kind: item.kind,
      priority: PRIORITY_WEIGHT[item.priority],
      targetPaths,
      canWait: false,
    };
    const task = await this.deps.tasks.create({
      ...base,
      workspaceId: workspaceId ?? named?.id ?? null,
    });
    await prisma.roadmapItem.update({
      where: { id: item.id },
      data: { status: "ACCEPTED", taskId: task.id },
    });
    await prisma.auditLog
      .create({
        data: { actor, action: "roadmap.accept", target: item.id, meta: { taskId: task.id } },
      })
      .catch(() => undefined);
    return task;
  }

  async dismiss(itemId: string): Promise<RoadmapItemDto> {
    const item = await this.deps.prisma.roadmapItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound("Roadmap item");
    if (item.status !== "SUGGESTED") throw conflict("This suggestion was already handled");
    return toItemDto(
      await this.deps.prisma.roadmapItem.update({
        where: { id: itemId },
        data: { status: "DISMISSED" },
      }),
    );
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.active.values()].map(async (entry) => {
        await this.deps.pool.abort(entry.runId);
        await entry.done;
      }),
    );
  }

  private async run(generation: RoadmapGeneration, entry: ActiveGeneration): Promise<void> {
    const { prisma, pool, config } = this.deps;
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: generation.projectId },
      include: { workspaces: { orderBy: { position: "asc" } } },
    });
    const fail = async (message: string) => {
      await prisma.roadmapGeneration.update({
        where: { id: generation.id },
        data: { status: "FAILED", error: message.slice(0, 1_000), endedAt: new Date() },
      });
    };
    try {
      const context = await this.deps.indexes.waitForIndex(project.id, config.context.indexWaitMs);
      const scope = await this.deps.surgeon.runScope(project.id, null);
      entry.activity.lastAction = "Collecting README, manifests, TODOs and history";
      const [readme, manifests, todos, gitLog, existing] = await Promise.all([
        this.readExcerpt(project.rootPath, ["README.md", "readme.md", "README"], README_CHARS),
        this.manifests(project.rootPath),
        this.todos(project.rootPath, context ? [...context.index.files.values()] : [], (path) =>
          scope.policy.isExcluded(path),
        ),
        this.gitLog(project.rootPath),
        this.existingTitles(project.id),
      ]);
      const prompt = buildRoadmapPrompt({
        projectName: project.name,
        language: RoadmapLanguageSchema.catch("en").parse(generation.language),
        focus: generation.focus,
        map: context ? context.projectMap(MAP_BUDGET_TOKENS, scope.policy).text : null,
        readme,
        manifests,
        todos,
        gitLog,
        workspaces: project.workspaces.map((workspace) => ({
          name: workspace.name,
          domain: workspace.domain,
          pathGlobs: toStringArray(workspace.pathGlobs),
        })),
        existingTitles: existing,
      });

      const token = this.deps.runTokens.issue(entry.runId, project.id, {
        workspaceId: null,
        policy: scope.policy,
        guard: scope.guard,
        fence: null,
      });
      const mcpEnabled =
        config.context.enabled &&
        config.context.mcpServerPath !== null &&
        isReadableFile(config.context.mcpServerPath);
      const cheap = (await this.deps.options?.get())?.cheapExploration === true;
      const files = await writeRuntimeFiles({
        runtimeDir: config.runtimeDir,
        runId: entry.runId,
        agents: cheap ? EXPLORER_AGENTS : null,
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

      let result: RunItemOf<"result"> | null = null;
      entry.activity.lastAction = "Claude is studying the project";
      let exit: ProcessExit;
      try {
        exit = await pool.run(
          {
            runId: entry.runId,
            cwd: project.rootPath,
            prompt: cheap ? `${prompt}\n\n${EXPLORER_HINT}` : prompt,
            model: generation.modelId,
            fallbackModels: [],
            permissionMode: "plan",
            maxTurns: MAX_TURNS,
            agentsFile: files.agentsFile,
            session: { mode: "ephemeral" },
            allowedTools: [
              "Read",
              "Grep",
              "Glob",
              "LS",
              ...(mcpEnabled ? [ONYX_MCP_ALLOW_RULE] : []),
              ...(cheap ? EXPLORER_TOOLS : []),
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
            timeouts: this.deps.timeouts ?? DEFAULT_TIMEOUTS,
          },
          {
            onSpawn: () => undefined,
            onEvent: (event) => {
              for (const item of normalizeClaudeEvent(event)) {
                if (item.kind === "tool_use") {
                  entry.activity.toolCalls += 1;
                  entry.activity.lastAction = shortAction(item);
                } else if (item.kind === "turn_usage") {
                  entry.activity.turns += 1;
                } else if (item.kind === "result") {
                  result = item;
                }
              }
            },
            onInvalidLine: () => undefined,
            onStderr: () => undefined,
            onHandlerError: (error) =>
              this.deps.logger.warn(
                { err: error, generationId: generation.id },
                "Roadmap handler failed",
              ),
          },
        );
      } finally {
        this.deps.runTokens.revoke(entry.runId);
      }
      const finalResult = result as RunItemOf<"result"> | null;
      if (exit.reason !== "completed" || !finalResult) {
        await fail(
          exit.reason === "aborted" || exit.reason === "shutdown"
            ? "The roadmap was interrupted"
            : `Claude Code stopped before answering (${exit.reason})`,
        );
        return;
      }
      await this.recordUsage(generation.modelId, finalResult);
      if (finalResult.isError) {
        await fail(
          `Claude Code reported an error: ${(finalResult.resultText ?? finalResult.subtype).slice(0, 300)}`,
        );
        return;
      }
      let proposal: RoadmapProposal;
      try {
        proposal = parseRoadmap(finalResult.resultText ?? "");
      } catch (error) {
        await fail(error instanceof Error ? error.message : String(error));
        return;
      }
      const items = withoutDuplicates(proposal.items, existing);
      await prisma.$transaction(async (tx) => {
        await tx.roadmapItem.deleteMany({ where: { projectId: project.id, status: "SUGGESTED" } });
        await tx.roadmapItem.createMany({
          data: items.map((item, position) => ({
            projectId: project.id,
            generationId: generation.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            priority: item.priority,
            effort: item.effort,
            workspaceName: item.workspace,
            targetPaths: item.targetPaths,
            rationale: item.rationale,
            position,
          })),
        });
        await tx.roadmapGeneration.update({
          where: { id: generation.id },
          data: {
            status: "COMPLETED",
            summary: proposal.summary,
            itemCount: items.length,
            numTurns: finalResult.numTurns,
            costUsd: finalResult.costUsd,
            endedAt: new Date(),
          },
        });
      });
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error));
    }
  }

  private async recordUsage(modelId: string, result: RunItemOf<"result">): Promise<void> {
    const profile = await this.deps.prisma.modelProfile.findUnique({ where: { id: modelId } });
    await this.deps.prisma.tokenLog
      .create({
        data: {
          modelId,
          scope: "AUX",
          purpose: "roadmap",
          ...result.usage,
          costUsd: result.costUsd ?? (profile ? priceUsage(result.usage, profile) : null),
        },
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Roadmap token log failed"));
  }

  private async readExcerpt(
    root: string,
    names: readonly string[],
    limit: number,
  ): Promise<string | null> {
    for (const name of names) {
      const content = await readFile(join(root, name), "utf8").catch(() => null);
      if (content !== null) return content.slice(0, limit);
    }
    return null;
  }

  private async manifests(root: string): Promise<Array<{ path: string; excerpt: string }>> {
    const found = await Promise.all(
      MANIFEST_NAMES.map(async (name) => {
        const excerpt = await this.readExcerpt(root, [name], MANIFEST_CHARS);
        return excerpt === null ? null : { path: name, excerpt };
      }),
    );
    return found.filter((entry): entry is { path: string; excerpt: string } => entry !== null);
  }

  private async todos(
    root: string,
    files: ReadonlyArray<{
      relPath: string;
      binary: boolean;
      sensitive: boolean;
      sizeBytes: number;
    }>,
    excluded: (path: string) => boolean,
  ): Promise<string[]> {
    const candidates = files
      .filter(
        (file) =>
          !file.binary &&
          !file.sensitive &&
          file.sizeBytes <= MAX_TODO_FILE_BYTES &&
          TEXT_EXTENSIONS.test(file.relPath) &&
          !excluded(file.relPath),
      )
      .slice(0, MAX_TODO_FILES);
    const contents = await Promise.all(
      candidates.map(async (file) => ({
        relPath: file.relPath,
        content: await readFile(join(root, file.relPath), "utf8").catch(() => ""),
      })),
    );
    return collectTodos(contents);
  }

  private async gitLog(root: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("git", safeGitArgs(["log", "--oneline", "-n", "15"]), {
        cwd: root,
        env: gitEnvironment(),
        timeout: 10_000,
      });
      return stdout.split("\n").filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  private async existingTitles(projectId: string): Promise<string[]> {
    const [tasks, items] = await Promise.all([
      this.deps.prisma.task.findMany({
        where: { projectId, status: { notIn: ["CANCELLED"] } },
        select: { title: true },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
      this.deps.prisma.roadmapItem.findMany({
        where: { projectId, status: { in: ["ACCEPTED", "DISMISSED"] } },
        select: { title: true },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    ]);
    return [...new Set([...tasks, ...items].map((entry) => entry.title))];
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

  private toGenerationDto(generation: RoadmapGeneration): RoadmapGenerationDto {
    const activity = this.active.get(generation.id)?.activity ?? null;
    return {
      id: generation.id,
      projectId: generation.projectId,
      status: generation.status,
      modelId: generation.modelId,
      language: RoadmapLanguageSchema.catch("en").parse(generation.language),
      focus: generation.focus,
      summary: generation.summary,
      error: localized(generation.error),
      itemCount: generation.itemCount,
      numTurns: generation.numTurns,
      costUsd: generation.costUsd,
      startedAt: generation.startedAt.toISOString(),
      endedAt: generation.endedAt?.toISOString() ?? null,
      activity: activity ? { ...activity, lastAction: localized(activity.lastAction) } : null,
    };
  }
}
