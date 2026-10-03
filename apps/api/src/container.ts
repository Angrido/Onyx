import { statfs } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { AgentPool, detectCliVersion, type ClaudeBinary } from "@onyx/agent-runtime";
import type { ReadyResponse } from "@onyx/contracts";
import { connectDatabase, seedDatabase, type PrismaClient } from "@onyx/db";
import { AdjustableTokenEstimator, LeanAnalyzer } from "@onyx/lean-ctx";
import type { Logger } from "pino";
import { AuthService } from "./application/auth-service";
import { CalibrationService } from "./application/calibration-service";
import { CatalogService } from "./application/catalog-service";
import { CompartmentService } from "./application/compartment-service";
import { IndexService } from "./application/index-service";
import { ProjectService } from "./application/project-service";
import { recoverInterruptedWork } from "./application/recovery";
import { RunExecutor } from "./application/run-executor";
import { RunScheduler } from "./application/run-scheduler";
import { RouterService } from "./application/router-service";
import { RunService } from "./application/run-service";
import { SurgeonService } from "./application/surgeon-service";
import { TaskService } from "./application/task-service";
import { TelemetryService } from "./application/telemetry-service";
import { WorkspaceService } from "./application/workspace-service";
import type { AppConfig } from "./config";
import {
  AnthropicAuxModel,
  type HandoffSummarizer,
  type TaskClassifier,
} from "./infrastructure/aux-model";
import { EventWriter } from "./infrastructure/event-writer";
import { IndexStore } from "./infrastructure/index-store";
import { RunTokenRegistry } from "./infrastructure/run-tokens";
import { AnthropicTokenizer, O200kTokenizer } from "./infrastructure/token-meter";
import { WsHub } from "./infrastructure/ws-hub";

export interface ContainerOverrides {
  binary?: ClaudeBinary;
  sourceEnv?: NodeJS.ProcessEnv;
  closeGraceMs?: number;
  indexRefreshDelayMs?: number;
  classifier?: TaskClassifier | null;
  summarizer?: HandoffSummarizer | null;
}

export interface Container {
  config: AppConfig;
  logger: Logger;
  prisma: PrismaClient;
  pool: AgentPool;
  writer: EventWriter;
  hub: WsHub;
  indexes: IndexService;
  surgeon: SurgeonService;
  calibration: CalibrationService;
  router: RouterService;
  compartments: CompartmentService;
  runTokens: RunTokenRegistry;
  executor: RunExecutor;
  scheduler: RunScheduler;
  auth: AuthService;
  projects: ProjectService;
  workspaces: WorkspaceService;
  tasks: TaskService;
  runs: RunService;
  telemetry: TelemetryService;
  catalog: CatalogService;
  cliVersion(): string | null;
  readiness(): Promise<ReadyResponse>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const MIN_FREE_DISK_RATIO = 0.1;

export async function createContainer(
  config: AppConfig,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  await mkdir(config.runtimeDir, { recursive: true, mode: 0o700 });
  await mkdir(config.projectsDir, { recursive: true });

  const prisma = await connectDatabase({ url: config.databaseUrl });
  const binary = overrides.binary ?? { command: config.claudeBin, args: [] };
  let cliVersion: string | null = null;

  const pool = new AgentPool({
    maxConcurrent: config.maxConcurrentAgents,
    binary,
    escalationGraceMs: config.escalationGraceMs,
    ...(overrides.closeGraceMs === undefined ? {} : { closeGraceMs: overrides.closeGraceMs }),
  });
  const writer = new EventWriter(prisma, {
    onError: (error, rows) =>
      logger.error(
        { err: error, runId: rows[0]?.runId, rows: rows.length },
        "Failed to persist run events",
      ),
  });

  const runs: { service: RunService | null } = { service: null };
  const hub = new WsHub((runId, after, before) =>
    runs.service ? runs.service.storedEvents(runId, after, before) : Promise.resolve([]),
  );

  const estimator = new AdjustableTokenEstimator();
  const offlineTokenizer = new O200kTokenizer();
  const auxModel =
    config.credentials.kind === "api-key"
      ? new AnthropicAuxModel({ apiKey: config.credentials.value })
      : null;
  const calibration = new CalibrationService({
    prisma,
    estimator,
    logger,
    tokenizer: () => (auxModel ? new AnthropicTokenizer(auxModel) : offlineTokenizer),
  });
  const indexes = new IndexService({
    prisma,
    store: new IndexStore(prisma),
    hub,
    logger,
    analyzer: new LeanAnalyzer({ estimator }),
    versionSuffix: () => calibration.fingerprint,
    ...(overrides.indexRefreshDelayMs === undefined
      ? {}
      : { refreshDelayMs: overrides.indexRefreshDelayMs }),
  });
  const runTokens = new RunTokenRegistry();
  const surgeon = new SurgeonService({ prisma, indexes, calibration, logger });
  const scheduling: { scheduler: RunScheduler | null } = { scheduler: null };
  const router = new RouterService({
    prisma,
    indexes,
    classifier: overrides.classifier === undefined ? auxModel : overrides.classifier,
    logger,
  });
  const compartments = new CompartmentService({
    prisma,
    estimator,
    summarizer: overrides.summarizer === undefined ? auxModel : overrides.summarizer,
    logger,
    isBusy: (workspaceId) => scheduling.scheduler?.isWorkspaceBusy(workspaceId) ?? false,
  });

  const executor = new RunExecutor({
    prisma,
    pool,
    writer,
    hub,
    logger,
    config,
    indexes,
    surgeon,
    router,
    compartments,
    runTokens,
    cliVersion: () => cliVersion,
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
  });
  const scheduler = new RunScheduler({
    executor,
    pool,
    hub,
    logger,
    maxConcurrent: config.maxConcurrentAgents,
  });
  scheduling.scheduler = scheduler;
  const runService = new RunService(prisma, scheduler);
  runs.service = runService;

  const container: Container = {
    config,
    logger,
    prisma,
    pool,
    writer,
    hub,
    indexes,
    surgeon,
    calibration,
    router,
    compartments,
    runTokens,
    executor,
    scheduler,
    auth: new AuthService(prisma, config.sessionTtlMs),
    projects: new ProjectService(prisma, config.allowedProjectRoots, (projectId) => {
      indexes
        .start(projectId)
        .catch((error: unknown) =>
          logger.warn({ err: error, projectId }, "Initial indexing could not start"),
        );
    }),
    workspaces: new WorkspaceService(prisma),
    tasks: new TaskService(prisma, scheduler, hub, (projectId, targetPaths, prompt) =>
      router.inferWorkspace(projectId, targetPaths, prompt),
    ),
    runs: runService,
    telemetry: new TelemetryService(prisma, () => ({
      activeRuns: scheduler.activeCount,
      queuedTasks: scheduler.queuedCount,
    })),
    catalog: new CatalogService(prisma),
    cliVersion: () => cliVersion,

    async readiness(): Promise<ReadyResponse> {
      const checks: ReadyResponse["checks"] = [];
      try {
        await prisma.$queryRawUnsafe("SELECT 1");
        checks.push({ name: "database", ok: true, detail: null });
      } catch (error) {
        checks.push({ name: "database", ok: false, detail: String(error) });
      }
      checks.push({
        name: "claude-cli",
        ok: cliVersion !== null,
        detail: cliVersion === null ? `${binary.command} is not executable` : cliVersion,
      });
      checks.push({
        name: "credentials",
        ok: config.credentials.kind !== "none",
        detail: config.credentials.kind,
      });
      try {
        const disk = await statfs(config.dataDir);
        const freeRatio = disk.bavail / disk.blocks;
        checks.push({
          name: "disk",
          ok: freeRatio >= MIN_FREE_DISK_RATIO,
          detail: `${Math.round(freeRatio * 100)}% free`,
        });
      } catch (error) {
        checks.push({ name: "disk", ok: false, detail: String(error) });
      }
      return {
        ready: checks.every((check) => check.ok || check.name === "credentials"),
        checks,
        cliVersion,
      };
    },

    async start(): Promise<void> {
      cliVersion = await detectCliVersion(binary);
      if (cliVersion === null)
        logger.warn({ command: binary.command }, "Claude Code CLI not found");
      const seeded = await seedDatabase(prisma);
      await calibration.load();
      logger.info({ seeded, cliVersion }, "Database ready");
      const recovery = await recoverInterruptedWork(prisma, logger, {
        claudeBin: binary.args[0] ?? binary.command,
        autoResumeQueued: config.autoResumeQueued,
      });
      for (const item of recovery.requeued) scheduler.enqueue(item);
    },

    async stop(): Promise<void> {
      await indexes.shutdown();
      await scheduler.shutdown();
      await writer.close();
      await prisma.$disconnect();
    },
  };
  return container;
}
