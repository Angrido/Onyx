import { statfs } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import {
  AgentPool,
  checkCliCompatibility,
  detectCliVersion,
  type ClaudeBinary,
  type CliCompatibility,
} from "@onyx/agent-runtime";
import type { ReadyResponse, RunStatus } from "@onyx/contracts";
import { connectDatabase, seedDatabase, type PrismaClient } from "@onyx/db";
import { AdjustableTokenEstimator, LeanAnalyzer } from "@onyx/lean-ctx";
import type { Logger } from "pino";
import { ApprovalService } from "./application/approval-service";
import { AuthService } from "./application/auth-service";
import { BackupService } from "./application/backup-service";
import { BudgetService } from "./application/budget-service";
import { MemoryService } from "./application/memory-service";
import { MissionService } from "./application/mission-service";
import { NotificationService } from "./application/notification-service";
import { OptionsService } from "./application/options-service";
import { QueueService } from "./application/queue-service";
import { SearchService } from "./application/search-service";
import { QuotaService } from "./application/quota-service";
import {
  prepareAgentSandbox,
  shareProjectTree,
  type SandboxCheck,
} from "./infrastructure/agent-sandbox";
import { shareWorkTrees } from "./infrastructure/git-env";
import { WorkTreeActivity } from "./infrastructure/work-tree-activity";
import { CalibrationService } from "./application/calibration-service";
import { CatalogService } from "./application/catalog-service";
import { CompartmentService } from "./application/compartment-service";
import { CredentialService } from "./application/credential-service";
import { ChangelogService } from "./application/changelog-service";
import { GitService } from "./application/git-service";
import { IssueService } from "./application/issue-service";
import { PullRequestService } from "./application/pull-request-service";
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
import { ensureSearchIndex } from "./infrastructure/search-index";
import { SecretVault } from "./infrastructure/secret-vault";
import { AnthropicTokenizer, O200kTokenizer } from "./infrastructure/token-meter";
import { WsHub } from "./infrastructure/ws-hub";

export interface ContainerOverrides {
  binary?: ClaudeBinary;
  now?: () => Date;
  sourceEnv?: NodeJS.ProcessEnv;
  closeGraceMs?: number;
  indexRefreshDelayMs?: number;
  terminalKillGraceMs?: number;
  credentialTestTimeoutMs?: number;
  classifier?: TaskClassifier | null;
  summarizer?: HandoffSummarizer | null;
  checkCli?: boolean;
  armRandom?: () => number;
  fetcher?: typeof fetch;
  telegramApiUrl?: string;
  pullRequestPollMs?: number;
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
  issues: IssueService;
  pulls: PullRequestService;
  changelog: ChangelogService;
  roadmap: RoadmapService;
  tdd: TddService;
  approvals: ApprovalService;
  budgets: BudgetService;
  quota: QuotaService;
  queue: QueueService;
  mission: MissionService;
  memory: MemoryService;
  options: OptionsService;
  notifications: NotificationService;
  search: SearchService;
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

  let sandboxCheck: SandboxCheck = { ok: true, detail: "not checked yet" };
  const pool = new AgentPool({
    maxConcurrent: config.maxConcurrentAgents,
    binary,
    escalationGraceMs: config.escalationGraceMs,
    ...(overrides.closeGraceMs === undefined ? {} : { closeGraceMs: overrides.closeGraceMs }),
    sandbox: config.agentSandbox,
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
  const options = new OptionsService(prisma, overrides.now);
  const memory = new MemoryService({
    prisma,
    logger,
    count: (text) => estimator.estimate(text, "markdown"),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
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
    memory,
    options,
  });
  const activity = new WorkTreeActivity();
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
    memory,
    options,
    onBatchLeftover: (taskId: string): Promise<void> => tasks.requeue(taskId),
    ...(overrides.armRandom ? { random: overrides.armRandom } : {}),
    onRunFinished: (change) => scheduling.terminals?.foreignChange(change),
    onRateLimit: (item) => quota.observe(item),
    grantedRules: (projectId, target) => projects.grantedRules(projectId, target),
    activity,
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
  });
  const notifications = new NotificationService({
    prisma,
    logger,
    vault,
    linkBase: config.publicOrigin,
    ...(overrides.fetcher ? { fetcher: overrides.fetcher } : {}),
    ...(overrides.telegramApiUrl ? { telegramApiUrl: overrides.telegramApiUrl } : {}),
  });
  const approvals = new ApprovalService({
    prisma,
    logger,
    hub,
    onCreated: (approval) => {
      void prisma.project
        .findUnique({ where: { id: approval.projectId ?? "" }, select: { name: true } })
        .then((project) =>
          notifications.approvalCreated({
            id: approval.id,
            kind: approval.kind,
            title: approval.title,
            projectName: project?.name ?? null,
          }),
        )
        .catch(() => undefined);
    },
  });
  const spending: { budgets: BudgetService | null } = { budgets: null };
  const quota = new QuotaService({
    prisma,
    logger,
    publish: (dto) => hub.publishQuota(dto),
    onChange: () => scheduling.scheduler?.poke(),
    onLevel: (previous, next, message) => notifications.quotaChanged(previous, next, message),
    waitingTasks: () =>
      (scheduling.scheduler?.queuedRuns() ?? []).map((item) => ({
        canWait: item.canWait === true,
      })),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const queue = new QueueService({
    prisma,
    logger,
    scheduler: () => scheduling.scheduler,
    maxConcurrent: config.maxConcurrentAgents,
    batching: () => options.current()?.batchSmallTasks === true,
  });
  const scheduler = new RunScheduler({
    executor,
    pool,
    hub,
    logger,
    maxConcurrent: config.maxConcurrentAgents,
    policy: () => queue.policy(),
    admit: (item) => {
      const budget = spending.budgets?.admit(item.projectId ?? null) ?? { decision: "go" };
      if (budget.decision !== "go") return budget;
      const admission = quota.admit(item);
      if (admission.decision === "hold") item.request.quotaDeferred = true;
      return admission;
    },
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
    afterRun: (taskId, outcome) => {
      router.forgetTelemetry();
      savings.forget();
      void memory
        .learnFromRun(outcome.runId)
        .catch((error: unknown) =>
          logger.warn({ err: error, taskId }, "Could not learn from the run"),
        );
      void notifyRun(outcome).catch((error: unknown) =>
        logger.warn({ err: error, taskId }, "Could not prepare the run notification"),
      );
      void mission.forgetTask(taskId).catch(() => undefined);
      void spending.budgets?.refresh().catch(() => undefined);
    },
  });
  scheduling.scheduler = scheduler;
  const budgets = new BudgetService({
    prisma,
    logger,
    approvals,
    onHardLimit: (projectId, reason) => {
      void prisma.project
        .findUnique({ where: { id: projectId ?? "" }, select: { name: true } })
        .then((project) => notifications.budgetStopped(project?.name ?? null, reason))
        .catch(() => undefined);
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
    memory,
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
    activity,
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
    ...(overrides.terminalKillGraceMs === undefined
      ? {}
      : { killGraceMs: overrides.terminalKillGraceMs }),
  });
  scheduling.terminals = terminals;
  const runService = new RunService(prisma, scheduler, (projectId, target) =>
    projects.grantedRules(projectId, target),
  );
  const loops: { service: TddService | null } = { service: null };
  const tasks = new TaskService(
    prisma,
    scheduler,
    hub,
    (projectId, targetPaths, prompt, kind) =>
      router.inferWorkspace(projectId, targetPaths, prompt, kind),
    (taskId, actor) => loops.service?.abortForTask(taskId, actor) ?? Promise.resolve(false),
  );
  const projects = new ProjectService(
    prisma,
    config.allowedProjectRoots,
    (projectId) => {
      indexes
        .start(projectId)
        .catch((error: unknown) =>
          logger.warn({ err: error, projectId }, "Initial indexing could not start"),
        );
    },
    async (root) => {
      if (!config.agentSandbox) return;
      const report = await shareProjectTree(root, config.agentSandbox.group);
      if (report.failed > 0)
        logger.warn(
          { root, failed: report.failed, group: config.agentSandbox.group },
          "Some project files could not be shared with the agents: run deploy/scripts/agent-sandbox.sh",
        );
    },
  );
  const githubClient = new GitHubClient({ baseUrl: config.github.apiUrl });
  const github = new GitHubService({
    prisma,
    logger,
    client: githubClient,
    projects,
    config,
    vault,
  });
  const roadmap = new RoadmapService({
    options,
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
    onGreen: (loop) => {
      void memory
        .learnFromLoop(loop)
        .catch((error: unknown) =>
          logger.warn({ err: error }, "Could not remember the test command"),
        );
    },
    ...(overrides.sourceEnv ? { sourceEnv: overrides.sourceEnv } : {}),
    ...(overrides.terminalKillGraceMs === undefined
      ? {}
      : { killGraceMs: overrides.terminalKillGraceMs }),
  });
  loops.service = tdd;
  runs.service = runService;
  async function notifyRun(outcome: { runId: string; status: RunStatus }): Promise<void> {
    const blocked =
      outcome.status === "COMPLETED" || outcome.status === "FAILED"
        ? (await runService.blockedCommands(outcome.runId)).commands.length
        : 0;
    await notifications.runFinished({ ...outcome, blockedCommands: blocked });
  }
  const git = new GitService({
    prisma,
    logger,
    github,
    isWorkspaceBusy: (workspaceId) => scheduler.isWorkspaceBusy(workspaceId),
  });
  const issues = new IssueService({
    prisma,
    logger,
    client: githubClient,
    github,
    git,
    indexes,
    tasks,
  });
  const pulls = new PullRequestService({
    prisma,
    logger,
    client: githubClient,
    github,
    git,
    notify: (message) => notifications.notify(message),
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.pullRequestPollMs === undefined ? {} : { tickMs: overrides.pullRequestPollMs }),
  });
  tasks.pullRequestOf = (task) => pulls.forTask(task);
  const changelog = new ChangelogService({
    prisma,
    logger,
    git,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const mission = new MissionService({
    prisma,
    scheduler: () => scheduling.scheduler,
    gitSummary: (rootPath, now) => git.summary(rootPath, now),
    limitOf: (projectId) => queue.limitOf(projectId),
    maxConcurrent: config.maxConcurrentAgents,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const orchestrator = new OrchestratorService({
    options,
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
    issues,
    pulls,
    changelog,
    workspaces: new WorkspaceService(prisma),
    tasks,
    roadmap,
    tdd,
    approvals,
    budgets,
    quota,
    queue,
    mission,
    memory,
    options,
    notifications,
    search: new SearchService(prisma),
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
      if (config.agentSandbox)
        checks.push({ name: "agent-sandbox", ok: sandboxCheck.ok, detail: sandboxCheck.detail });
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
      if (config.agentSandbox) {
        process.umask(0o027);
        shareWorkTrees(0o007);
      }
      sandboxCheck = await prepareAgentSandbox(config);
      if (!sandboxCheck.ok)
        logger.error({ detail: sandboxCheck.detail }, "Agent sandbox is not ready");
      else if (config.agentSandbox)
        logger.info({ user: config.agentSandbox.user }, "Agents run in their own user");
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
      await quota.load();
      await queue.load();
      await options.get();
      await notifications.load();
      if (await ensureSearchIndex(prisma)) logger.info("Built the search index");
      const recovery = await recoverInterruptedWork(prisma, logger, {
        claudeBin: binary.args[0] ?? binary.command,
        autoResumeQueued: config.autoResumeQueued,
      });
      for (const item of recovery.requeued) scheduler.enqueue(item);
      backups.start();
      pulls.start();
    },

    async stop(): Promise<void> {
      await checking?.catch(() => undefined);
      await pulls.stop();
      await backups.stop();
      await indexes.shutdown();
      await roadmap.shutdown();
      await orchestrator.shutdown();
      await tdd.shutdown();
      await terminals.shutdown();
      await credentials.shutdown();
      await scheduler.shutdown();
      quota.stop();
      await quota.idle();
      await notifications.idle();
      await writer.close();
      if (config.agentSandbox) shareWorkTrees(null);
      await prisma.$disconnect();
    },
  };
  return container;
}
