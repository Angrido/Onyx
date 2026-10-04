import { statfs } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import {
  AgentPool,
  checkCliCompatibility,
  detectCliVersion,
  type ClaudeBinary,
  type CliCompatibility,
} from "@onyx/agent-runtime";
import type { ReadyResponse } from "@onyx/contracts";
import { connectDatabase, seedDatabase, type PrismaClient } from "@onyx/db";
import { AdjustableTokenEstimator, LeanAnalyzer } from "@onyx/lean-ctx";
import type { Logger } from "pino";
import { ApprovalService } from "./application/approval-service";
import { AuthService } from "./application/auth-service";
import { BackupService } from "./application/backup-service";
import { BudgetService } from "./application/budget-service";
import { CalibrationService } from "./application/calibration-service";
import { CatalogService } from "./application/catalog-service";
import { CompartmentService } from "./application/compartment-service";
import { CredentialService } from "./application/credential-service";
import { GitService } from "./application/git-service";
import { GitHubService } from "./application/github-service";
import { IndexService } from "./application/index-service";
import { OrchestratorService } from "./application/orchestrator-service";
import { ProjectService } from "./application/project-service";
import { recoverInterruptedWork } from "./application/recovery";
import { RunExecutor } from "./application/run-executor";
import { RunScheduler } from "./application/run-scheduler";
import { RoadmapService } from "./application/roadmap-service";
import { RouterService } from "./application/router-service";
import { RunService } from "./application/run-service";
import { SurgeonService } from "./application/surgeon-service";
import { TaskService } from "./application/task-service";
import { TddService } from "./application/tdd-service";
import { SavingsService } from "./application/savings-service";
import { TelemetryService } from "./application/telemetry-service";
import { TerminalService } from "./application/terminal-service";
import { WorkspaceService } from "./application/workspace-service";
import type { AppConfig } from "./config";
import {
  AnthropicAuxModel,
  type HandoffSummarizer,
  type TaskClassifier,
} from "./infrastructure/aux-model";
import { EventWriter } from "./infrastructure/event-writer";
import { GitHubClient } from "./infrastructure/github-client";
import { IndexStore } from "./infrastructure/index-store";
import { RunTokenRegistry } from "./infrastructure/run-tokens";
import { SecretVault } from "./infrastructure/secret-vault";
import { AnthropicTokenizer, O200kTokenizer } from "./infrastructure/token-meter";
import { WsHub } from "./infrastructure/ws-hub";

export interface ContainerOverrides {
  binary?: ClaudeBinary;
  sourceEnv?: NodeJS.ProcessEnv;
  closeGraceMs?: number;
  indexRefreshDelayMs?: number;
  terminalKillGraceMs?: number;
  credentialTestTimeoutMs?: number;
  classifier?: TaskClassifier | null;
  summarizer?: HandoffSummarizer | null;
  checkCli?: boolean;
  armRandom?: () => number;
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
  credentials: CredentialService;
  executor: RunExecutor;
  scheduler: RunScheduler;
  terminals: TerminalService;
  github: GitHubService;
  git: GitService;
  roadmap: RoadmapService;
  tdd: TddService;
  approvals: ApprovalService;
  budgets: BudgetService;
  orchestrator: OrchestratorService;
  backups: BackupService;
  vault: SecretVault;
  auth: AuthService;
  projects: ProjectService;
  workspaces: WorkspaceService;
  tasks: TaskService;
  runs: RunService;
  telemetry: TelemetryService;
  savings: SavingsService;
  catalog: CatalogService;
  cliVersion(): string | null;
  cliCompatibility(): CliCompatibility | null;
  checkCli(): Promise<CliCompatibility>;
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
  const vault = await SecretVault.open(config.secrets.keyFile, config.secrets.key);
  if (vault.created)
    logger.info({ keyFile: vault.keyFile }, "Created the secret key for stored tokens");
  const binary = overrides.binary ?? { command: config.claudeBin, args: [] };
  let cliVersion: string | null = null;
  let compatibility: CliCompatibility | null = null;
  let checking: Promise<CliCompatibility> | null = null;
  const checkCli = (): Promise<CliCompatibility> => {
    checking ??= checkCliCompatibility(binary, {
      env: { ...process.env, ...overrides.sourceEnv },
    })
      .then((result) => {
        compatibility = result;
        if (!result.ok)
          logger.warn(
            {
              version: result.version,
              missingFlags: result.missingFlags,
              missingModes: result.missingModes,
              missingCommands: result.missingCommands,
              error: result.error,
            },
            "This Claude Code version lacks options Onyx needs",
          );
        return result;
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  };

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
  const surgeon = new SurgeonService({
    prisma,
    indexes,
    calibration,
    logger,
    protectedPaths: config.agentProtectedPaths,
  });
  const scheduling: { scheduler: RunScheduler | null; terminals: TerminalService | null } = {
    scheduler: null,
    terminals: null,
  };
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

  const credentials = new CredentialService({
    prisma,
    logger,
    hub,
    binary,
    config,
    cliVersion: () => cliVersion,
    cliCompatibility: () => compatibility,
    vault,
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
    ...(overrides.terminalKillGraceMs === undefined
      ? {}
      : { killGraceMs: overrides.terminalKillGraceMs }),
    ...(overrides.credentialTestTimeoutMs === undefined
      ? {}
      : { testTimeoutMs: overrides.credentialTestTimeoutMs }),
  });

  const savings = new SavingsService({
    prisma,
    router,
    contextEnabled: config.context.enabled,
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
    credentials,
    cliVersion: () => cliVersion,
    experiment: () => savings.experimentSettings(),
    estimator,
    ...(overrides.armRandom ? { random: overrides.armRandom } : {}),
    onRunFinished: (change) => scheduling.terminals?.foreignChange(change),
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
  });
  const approvals = new ApprovalService({ prisma, logger, hub });
  const spending: { budgets: BudgetService | null } = { budgets: null };
  const scheduler = new RunScheduler({
    executor,
    pool,
    hub,
    logger,
    maxConcurrent: config.maxConcurrentAgents,
    admit: (projectId) => spending.budgets?.admit(projectId) ?? { decision: "go" },
    reject: async (item, reason) => {
      const task = await prisma.task.update({
        where: { id: item.request.taskId },
        data: { status: "FAILED", resultSummary: reason },
      });
      hub.publishTaskStatus({
        taskId: task.id,
        projectId: task.projectId,
        status: "FAILED",
        runId: null,
      });
    },
    afterRun: () => {
      void spending.budgets?.refresh().catch(() => undefined);
    },
  });
  scheduling.scheduler = scheduler;
  const budgets = new BudgetService({
    prisma,
    logger,
    approvals,
    onHardLimit: (projectId, reason) => {
      void scheduler
        .abortScope(projectId)
        .then((aborted) => {
          if (aborted > 0) logger.warn({ projectId, aborted }, reason);
        })
        .catch((error: unknown) => logger.error({ err: error }, "Could not stop runs over budget"));
    },
    onChange: () => scheduler.poke(),
  });
  spending.budgets = budgets;
  const terminals = new TerminalService({
    prisma,
    hub,
    logger,
    binary,
    config,
    surgeon,
    indexes,
    compartments,
    runTokens,
    credentials,
    reserve: (workspaceId) => scheduler.reserve(workspaceId),
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
    ...(overrides.terminalKillGraceMs === undefined
      ? {}
      : { killGraceMs: overrides.terminalKillGraceMs }),
  });
  scheduling.terminals = terminals;
  const runService = new RunService(prisma, scheduler);
  const loops: { service: TddService | null } = { service: null };
  const tasks = new TaskService(
    prisma,
    scheduler,
    hub,
    (projectId, targetPaths, prompt, kind) =>
      router.inferWorkspace(projectId, targetPaths, prompt, kind),
    (taskId, actor) => loops.service?.abortForTask(taskId, actor) ?? Promise.resolve(false),
  );
  const projects = new ProjectService(prisma, config.allowedProjectRoots, (projectId) => {
    indexes
      .start(projectId)
      .catch((error: unknown) =>
        logger.warn({ err: error, projectId }, "Initial indexing could not start"),
      );
  });
  const github = new GitHubService({
    prisma,
    logger,
    client: new GitHubClient({ baseUrl: config.github.apiUrl }),
    projects,
    config,
    vault,
  });
  const roadmap = new RoadmapService({
    prisma,
    logger,
    pool,
    indexes,
    surgeon,
    router,
    tasks,
    runTokens,
    credentials,
    config,
    reserve: (workspaceId) => scheduler.reserve(workspaceId),
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
  });
  const tdd = new TddService({
    prisma,
    logger,
    hub,
    scheduler,
    router,
    config,
    estimate: (text) => estimator.estimate(text, "markdown"),
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
    ...(overrides.terminalKillGraceMs === undefined
      ? {}
      : { killGraceMs: overrides.terminalKillGraceMs }),
  });
  loops.service = tdd;
  runs.service = runService;
  const git = new GitService({
    prisma,
    logger,
    github,
    isWorkspaceBusy: (workspaceId) => scheduler.isWorkspaceBusy(workspaceId),
  });
  const orchestrator = new OrchestratorService({
    prisma,
    logger,
    hub,
    pool,
    scheduler,
    tdd,
    approvals,
    budgets,
    git,
    indexes,
    surgeon,
    router,
    runTokens,
    credentials,
    config,
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
  });

  const backups = new BackupService({
    prisma,
    logger,
    config,
    keyFingerprint: vault.fingerprint(),
  });

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
    credentials,
    executor,
    scheduler,
    terminals,
    auth: new AuthService(prisma, config.sessionTtlMs),
    projects,
    github,
    git,
    workspaces: new WorkspaceService(prisma),
    tasks,
    roadmap,
    tdd,
    approvals,
    budgets,
    orchestrator,
    backups,
    vault,
    runs: runService,
    savings,
    telemetry: new TelemetryService(prisma, () => ({
      activeRuns: scheduler.activeCount,
      queuedTasks: scheduler.queuedCount,
    })),
    catalog: new CatalogService(prisma),
    cliVersion: () => cliVersion,
    cliCompatibility: () => compatibility,
    checkCli,

    async readiness(): Promise<ReadyResponse> {
      const checks: ReadyResponse["checks"] = [];
      try {
        await prisma.$queryRawUnsafe("SELECT 1");
        checks.push({ name: "database", ok: true, detail: null });
      } catch (error) {
        checks.push({ name: "database", ok: false, detail: String(error) });
      }
      const missing = compatibility
        ? [
            ...compatibility.missingFlags,
            ...compatibility.missingModes.map((mode) => `permission mode ${mode}`),
            ...compatibility.missingCommands.map((command) => `command ${command}`),
          ]
        : [];
      checks.push({
        name: "claude-cli",
        ok: cliVersion !== null && compatibility?.ok !== false,
        detail:
          cliVersion === null
            ? `${binary.command} is not executable`
            : compatibility?.ok === false
              ? `${cliVersion} is not compatible: ${missing.length > 0 ? `missing ${missing.join(", ")}` : (compatibility.error ?? "check failed")}`
              : cliVersion,
      });
      const resolved = await credentials.resolve();
      checks.push({
        name: "credentials",
        ok: resolved.credentials.kind !== "none",
        detail:
          resolved.source === null
            ? "none"
            : `${resolved.credentials.kind} (${resolved.source === "env" ? "environment" : "settings"})`,
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
      else if (overrides.checkCli !== false) void checkCli();
      const seeded = await seedDatabase(prisma);
      const sealed = [await credentials.sealStored(), await container.github.sealStored()];
      if (sealed.some(Boolean)) logger.info("Encrypted the tokens saved by an older version");
      await container.github.cleanup();
      await calibration.load();
      logger.info({ seeded, cliVersion }, "Database ready");
      await tdd.recover();
      await orchestrator.recover();
      await budgets.refresh();
      const recovery = await recoverInterruptedWork(prisma, logger, {
        claudeBin: binary.args[0] ?? binary.command,
        autoResumeQueued: config.autoResumeQueued,
      });
      for (const item of recovery.requeued) scheduler.enqueue(item);
      backups.start();
    },

    async stop(): Promise<void> {
      await checking?.catch(() => undefined);
      await backups.stop();
      await indexes.shutdown();
      await roadmap.shutdown();
      await orchestrator.shutdown();
      await tdd.shutdown();
      await terminals.shutdown();
      await credentials.shutdown();
      await scheduler.shutdown();
      await writer.close();
      await prisma.$disconnect();
    },
  };
  return container;
}
