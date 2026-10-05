import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import {
  ClaudeTerminal,
  TextTail,
  type ClaudeBinary,
  type ProcessTracker,
  type TerminalExit,
} from "@onyx/agent-runtime";
import {
  channels,
  PermissionModeSchema,
  type ResetStrategy,
  type SessionEndReason,
  type SessionStartInput,
  type StatusLineInput,
  type TerminalDto,
  type TerminalInjection,
  type TerminalInjectionAction,
} from "@onyx/contracts";
import { DEFAULT_AGENT_CONFIG_NAME, type PrismaClient } from "@onyx/db";
import { WriteFence } from "@onyx/ignore-compiler";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import { composePrimer } from "../domain/context-primer";
import type { Handoff, RunDigest } from "../domain/handoff";
import {
  buildRunSettings,
  RUN_TOKEN_ENV,
  statusLineSetting,
  terminalHooks,
} from "../domain/permission-rules";
import { wantsHandoff } from "../domain/session-policy";
import { bracketedPaste, taskContextText } from "../domain/task-context";
import { badRequest, conflict, notFound } from "../errors";
import {
  buildMcpConfig,
  emptyMcpConfig,
  isReadableFile,
  ONYX_MCP_ALLOW_RULE,
} from "../infrastructure/mcp-config";
import type { RunTokenRegistry } from "../infrastructure/run-tokens";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import type { WorkTreeActivity } from "../infrastructure/work-tree-activity";
import { ptyOutputMessage, ptyStateMessage, type WsHub } from "../infrastructure/ws-hub";
import type { CompartmentService } from "./compartment-service";
import type { CredentialService } from "./credential-service";
import type { IndexService } from "./index-service";
import { storedMemory, type MemoryService } from "./memory-service";
import { toStringArray } from "./mappers";
import type { SlotReservation } from "./run-scheduler";
import type { SurgeonService } from "./surgeon-service";

export const ONYX_API_URL_ENV = "ONYX_API_URL";

export interface OpenTerminalInput {
  modelId?: string | undefined;
  cols: number;
  rows: number;
  fresh: boolean;
}

export interface ForeignChange {
  projectId: string;
  workspaceId: string;
  changedFiles: readonly string[];
}

export interface TerminalServiceDeps {
  prisma: PrismaClient;
  hub: WsHub;
  logger: Logger;
  binary: ClaudeBinary;
  config: Pick<
    AppConfig,
    | "runtimeDir"
    | "childEnvPassthrough"
    | "context"
    | "terminal"
    | "internalApiUrl"
    | "agentProtectedPaths"
    | "agentSandbox"
  >;
  surgeon: SurgeonService;
  activity?: WorkTreeActivity;
  indexes: IndexService;
  compartments: CompartmentService;
  runTokens: RunTokenRegistry;
  credentials: Pick<CredentialService, "childEnv">;
  reserve: (workspaceId: string) => SlotReservation;
  memory?: Pick<MemoryService, "compose">;
  sourceEnv?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  tracker?: ProcessTracker | null;
}

interface PendingInjection {
  action: TerminalInjectionAction;
  reason: SessionEndReason | null;
  handoff: boolean;
  at: Date;
}

interface AwaitedClear {
  reason: SessionEndReason;
  handoff: Handoff | null;
}

interface TerminalWorkspace {
  id: string;
  name: string;
  resetStrategy: ResetStrategy;
  maxSessionTokens: number;
}

interface TerminalRecord {
  id: string;
  activity: number | null;
  projectId: string;
  projectRoot: string;
  workspace: TerminalWorkspace;
  modelId: string;
  sessionId: string;
  sessionStartedAt: Date;
  claudeSessionId: string | null;
  resumed: boolean;
  confirmed: boolean;
  stopRequested: boolean;
  startupNote: string | null;
  terminal: ClaudeTerminal;
  state: "running" | "exited";
  exitCode: number | null;
  startedAt: Date;
  contextTokens: number;
  persistedTokens: number;
  pressureArmed: boolean;
  pending: PendingInjection | null;
  awaitingClear: AwaitedClear | null;
  injecting: boolean;
  lastInjection: TerminalInjection | null;
  output: TextTail;
  lastOutputAt: number;
  lastInputAt: number;
  inputDirty: boolean;
  changedFiles: Set<string>;
  prompts: string[];
  release: () => void;
  pump: NodeJS.Timeout | null;
}

const OUTPUT_TAIL_CHARS = 256 * 1024;
const LOST_SESSION_WINDOW_MS = 5_000;
const PUMP_INTERVAL_MS = 100;
const SUBMIT_DELAY_MS = 150;
const MAX_PROMPTS = 10;
const MAX_PROMPT_CHARS = 300;
const MAX_CHANGED_FILES = 200;
const MAX_EXITED_RECORDS = 20;
const ESCAPE = 27;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kilo(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripEscapes(data: string): string {
  let visible = "";
  for (let index = 0; index < data.length; index += 1) {
    if (data.charCodeAt(index) !== ESCAPE) {
      visible += data[index] ?? "";
      continue;
    }
    const next = data[index + 1];
    if (next === "[") {
      index += 2;
      while (index < data.length) {
        const code = data.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) break;
        index += 1;
      }
    } else {
      index += next === "O" ? 2 : 1;
    }
  }
  return visible;
}

export function inputLeavesDraft(previous: boolean, data: string): boolean {
  let draft = previous;
  for (const char of stripEscapes(data)) {
    const code = char.charCodeAt(0);
    if (code === 13 || code === 10 || code === 3) draft = false;
    else if (code >= 32 && code !== 127) draft = true;
  }
  return draft;
}

export function compactFocus(workspaceName: string): string {
  return `Keep what matters for the ${workspaceName} workspace: decisions, changed files, failing checks and open items.`;
}

export class TerminalService {
  private readonly records = new Map<string, TerminalRecord>();

  constructor(private readonly deps: TerminalServiceDeps) {
    deps.hub.registerSnapshot("pty:", (channel) => {
      const record = this.records.get(channel.slice("pty:".length));
      if (!record) return [];
      const output = record.output.toString();
      return [ptyStateMessage(this.toDto(record)), ptyOutputMessage(record.id, output, true)];
    });
  }

  has(terminalId: string): boolean {
    return this.records.has(terminalId);
  }

  list(filter: { workspaceId?: string; projectId?: string } = {}): TerminalDto[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          (filter.workspaceId === undefined || record.workspace.id === filter.workspaceId) &&
          (filter.projectId === undefined || record.projectId === filter.projectId),
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .map((record) => this.toDto(record));
  }

  get(terminalId: string): TerminalDto {
    return this.toDto(this.require(terminalId));
  }

  async open(workspaceId: string, input: OpenTerminalInput, actor: string): Promise<TerminalDto> {
    const running = this.runningIn(workspaceId);
    if (running) return this.toDto(running);
    const { prisma, config, compartments } = this.deps;
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        project: { include: { workspaces: { orderBy: { position: "asc" } } } },
        agentConfig: true,
        activeSession: true,
      },
    });
    if (!workspace) throw notFound("Workspace");
    const rootStats = await stat(workspace.project.rootPath).catch(() => null);
    if (!rootStats?.isDirectory())
      throw badRequest(`Project root ${workspace.project.rootPath} is not a directory`);
    const agentConfig =
      workspace.agentConfig ??
      (await prisma.agentConfig.findUnique({ where: { name: DEFAULT_AGENT_CONFIG_NAME } }));
    if (!agentConfig) throw badRequest("Agent configuration not found");
    const liveSession =
      workspace.activeSession &&
      workspace.activeSession.status !== "ROTATED" &&
      workspace.activeSession.status !== "CLOSED"
        ? workspace.activeSession
        : null;
    const modelId = input.modelId ?? liveSession?.modelId ?? agentConfig.modelId;
    const profile = await prisma.modelProfile.findUnique({ where: { id: modelId } });
    if (!profile?.enabled) throw badRequest(`Model ${modelId} is not enabled`);

    const reservation = this.deps.reserve(workspaceId);
    if (!reservation.ok) {
      throw conflict(
        reservation.reason === "busy"
          ? "Workspace has a running agent"
          : reservation.reason === "full"
            ? "Every agent slot is busy"
            : "Onyx is shutting down",
      );
    }

    const id = randomUUID();
    try {
      const plan = await compartments.prepare({
        projectId: workspace.projectId,
        workspace,
        modelId,
        forceNew: input.fresh,
      });
      const scope = await this.deps.surgeon.runScope(workspace.projectId, workspace.id);
      const indexed = await this.deps.indexes.context(workspace.projectId);
      const fence = new WriteFence(
        workspace.project.rootPath,
        { name: workspace.name, globs: toStringArray(workspace.writeFenceGlobs) },
        workspace.project.workspaces
          .filter((candidate) => candidate.id !== workspace.id)
          .map((candidate) => ({
            name: candidate.name,
            globs: toStringArray(candidate.pathGlobs),
          })),
        undefined,
        config.agentProtectedPaths,
      );
      const fenceRules = fence.compile(indexed ? [...indexed.index.files.keys()] : []);
      const token = this.deps.runTokens.issue(id, workspace.projectId, {
        workspaceId: workspace.id,
        policy: scope.policy,
        guard: scope.guard,
        fence,
      });
      const mcpEnabled =
        config.context.enabled &&
        config.context.mcpServerPath !== null &&
        isReadableFile(config.context.mcpServerPath);
      const statusLinePath = config.terminal.statusLinePath;
      const memory =
        plan.decision.action === "resume"
          ? (storedMemory(plan.session.memory)?.text ?? null)
          : await this.freshMemory(workspace.projectId, plan.session.id);
      const map =
        config.context.enabled && indexed
          ? indexed.projectMap(config.context.mapBudgetTokens, scope.policy)
          : null;
      const files = await writeRuntimeFiles({
        runtimeDir: config.runtimeDir,
        runId: `terminal-${id}`,
        settings: buildRunSettings({
          deny: [...scope.compiled.readDeny, ...scope.compiled.editDeny, ...fenceRules.editDeny],
          protectedPaths: config.agentProtectedPaths,
          hooks: terminalHooks(config.internalApiUrl),
          ...(statusLinePath !== null && isReadableFile(statusLinePath)
            ? { statusLine: statusLineSetting(process.execPath, statusLinePath) }
            : {}),
        }),
        primer: composePrimer({
          workspacePrimer: workspace.primer,
          agentPrompt: agentConfig.appendSystemPrompt,
          projectName: workspace.project.name,
          map,
          memory,
          mcpEnabled,
        }),
        mcpConfig:
          mcpEnabled && config.context.mcpServerPath !== null
            ? buildMcpConfig({
                serverPath: config.context.mcpServerPath,
                apiUrl: config.internalApiUrl,
                token,
              })
            : emptyMcpConfig(),
      });
      const allowedTools = toStringArray(agentConfig.allowedTools);
      const session = plan.session;
      const resume = plan.decision.action === "resume";
      const credentialVars = await this.deps.credentials.childEnv();
      let record: TerminalRecord | null = null;
      const terminal = new ClaudeTerminal(
        this.deps.binary,
        {
          terminalId: id,
          cwd: workspace.project.rootPath,
          model: modelId,
          permissionMode: PermissionModeSchema.parse(agentConfig.permissionMode),
          session: resume
            ? { mode: "resume", sessionId: session.claudeSessionId ?? session.id }
            : { mode: "new", sessionId: session.id },
          allowedTools:
            mcpEnabled && !allowedTools.includes(ONYX_MCP_ALLOW_RULE)
              ? [...allowedTools, ONYX_MCP_ALLOW_RULE]
              : allowedTools,
          disallowedTools: toStringArray(agentConfig.disallowedTools),
          settingsFile: files.settingsFile,
          mcpConfigFile: files.mcpConfigFile,
          appendSystemPromptFile: files.primerFile,
          env: {
            ...this.passthroughEnv(),
            ...credentialVars,
            [RUN_TOKEN_ENV]: token,
            [ONYX_API_URL_ENV]: config.internalApiUrl,
          },
          cols: input.cols,
          rows: input.rows,
        },
        {
          onData: (data) => {
            if (record) this.handleOutput(record, data);
          },
          onExit: (exit) => {
            if (!record) return;
            this.handleExit(record, exit).catch((error: unknown) =>
              this.deps.logger.error({ err: error, terminalId: id }, "Terminal cleanup failed"),
            );
          },
        },
        {
          ...(this.deps.killGraceMs === undefined ? {} : { killGraceMs: this.deps.killGraceMs }),
          ...(this.deps.sourceEnv ? { sourceEnv: this.deps.sourceEnv } : {}),
          sandbox: config.agentSandbox,
          tracker: this.deps.tracker ?? null,
          label: `terminal:${id}`,
        },
      );
      record = {
        id,
        activity: null,
        projectId: workspace.projectId,
        projectRoot: workspace.project.rootPath,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          resetStrategy: workspace.resetStrategy,
          maxSessionTokens: workspace.maxSessionTokens,
        },
        modelId,
        sessionId: session.id,
        sessionStartedAt: session.startedAt,
        claudeSessionId: resume ? (session.claudeSessionId ?? session.id) : null,
        resumed: resume,
        confirmed: false,
        stopRequested: false,
        startupNote: plan.item.handoff?.text ?? null,
        terminal,
        state: "running",
        exitCode: null,
        startedAt: new Date(),
        contextTokens: resume ? session.contextTokens : 0,
        persistedTokens: resume ? session.contextTokens : 0,
        pressureArmed: true,
        pending: null,
        awaitingClear: null,
        injecting: false,
        lastInjection: null,
        output: new TextTail(OUTPUT_TAIL_CHARS),
        lastOutputAt: Date.now(),
        lastInputAt: 0,
        inputDirty: false,
        changedFiles: new Set(),
        prompts: [],
        release: reservation.release,
        pump: null,
      };
      const created: TerminalRecord = record;
      this.forgetExited(workspace.id);
      this.records.set(id, created);
      try {
        terminal.start();
      } catch (error) {
        this.records.delete(id);
        throw error;
      }
      created.activity =
        this.deps.activity?.begin(workspace.project.rootPath, workspace.name) ?? null;
      await this.audit(actor, "terminal.opened", id, {
        workspaceId: workspace.id,
        sessionId: session.id,
        modelId,
        decision: plan.decision.action,
        reason: plan.item.reason,
      });
      this.publishState(created);
      return this.toDto(created);
    } catch (error) {
      if (!this.records.has(id)) {
        this.deps.runTokens.revoke(id);
        reservation.release();
      }
      throw error;
    }
  }

  input(terminalId: string, data: string): void {
    const record = this.requireRunning(terminalId);
    record.inputDirty = inputLeavesDraft(record.inputDirty, data);
    record.lastInputAt = Date.now();
    record.terminal.write(data);
  }

  async injectTaskContext(terminalId: string, taskId: string, actor: string): Promise<TerminalDto> {
    const record = this.requireRunning(terminalId);
    const task = await this.deps.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.projectId !== record.projectId)
      throw badRequest("Pick a task of the same project as the terminal");
    record.terminal.write(
      bracketedPaste(
        taskContextText({
          title: task.title,
          prompt: task.prompt,
          acceptance: toStringArray(task.acceptance),
          targetPaths: toStringArray(task.targetPaths),
        }),
      ),
    );
    record.inputDirty = true;
    record.lastInputAt = Date.now();
    await this.audit(actor, "terminal.task-context", terminalId, { taskId: task.id });
    return this.toDto(record);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.requireRunning(terminalId).terminal.resize(cols, rows);
  }

  inject(
    terminalId: string,
    action: TerminalInjectionAction,
    handoff: boolean,
    actor: string,
  ): TerminalDto {
    const record = this.requireRunning(terminalId);
    this.schedule(record, {
      action,
      reason: action === "clear" ? "MANUAL_RESET" : null,
      handoff: action === "clear" && handoff,
      at: new Date(),
    });
    void this.audit(actor, "terminal.inject.requested", terminalId, { action, handoff });
    return this.toDto(record);
  }

  async close(terminalId: string, actor: string): Promise<TerminalDto> {
    const record = this.require(terminalId);
    if (record.state === "running") {
      record.stopRequested = true;
      await record.terminal.stop();
      await this.audit(actor, "terminal.closed", terminalId, { workspaceId: record.workspace.id });
    }
    return this.toDto(record);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.records.values()]
        .filter((record) => record.state === "running")
        .map((record) => {
          record.stopRequested = true;
          return record.terminal.stop();
        }),
    );
  }

  foreignChange(change: ForeignChange): void {
    if (change.changedFiles.length === 0) return;
    for (const record of this.records.values()) {
      if (record.state !== "running") continue;
      if (record.projectId !== change.projectId || record.workspace.id === change.workspaceId)
        continue;
      this.schedule(record, {
        action: "clear",
        reason: "DOMAIN_SWITCH",
        handoff: wantsHandoff(record.workspace.resetStrategy, "DOMAIN_SWITCH"),
        at: new Date(),
      });
    }
  }

  async sessionStart(terminalId: string, input: SessionStartInput): Promise<string | null> {
    const record = this.records.get(terminalId);
    if (!record) return null;
    record.confirmed = true;
    const { prisma, compartments, logger } = this.deps;
    switch (input.source) {
      case "clear": {
        const awaited = record.awaitingClear ?? { reason: "MANUAL_RESET", handoff: null };
        record.awaitingClear = null;
        const session = await compartments.continueAfterClear({
          workspaceId: record.workspace.id,
          previousSessionId: record.sessionId,
          claudeSessionId: input.session_id,
          modelId: record.modelId,
          reason: awaited.reason,
          handoff: awaited.handoff,
        });
        record.sessionId = session.id;
        record.sessionStartedAt = session.startedAt;
        record.claudeSessionId = input.session_id;
        record.contextTokens = 0;
        record.persistedTokens = 0;
        record.pressureArmed = true;
        record.changedFiles.clear();
        record.prompts = [];
        this.publishState(record);
        return awaited.handoff?.text ?? null;
      }
      case "compact": {
        record.contextTokens = 0;
        record.pressureArmed = true;
        await this.persistTokens(record);
        this.publishState(record);
        return null;
      }
      default: {
        record.claudeSessionId = input.session_id;
        await prisma.session
          .update({
            where: { id: record.sessionId },
            data: {
              claudeSessionId: input.session_id,
              status: "ACTIVE",
              lastActivityAt: new Date(),
            },
          })
          .catch((error: unknown) =>
            logger.warn({ err: error, terminalId }, "Could not bind the terminal session"),
          );
        const note = record.startupNote;
        record.startupNote = null;
        this.publishState(record);
        return note;
      }
    }
  }

  async statusLine(terminalId: string, input: StatusLineInput): Promise<string> {
    const record = this.records.get(terminalId);
    if (!record) return "Onyx";
    const usage = input.context_window?.current_usage;
    const sameSession =
      input.session_id === undefined ||
      record.claudeSessionId === null ||
      input.session_id === record.claudeSessionId;
    if (usage && sameSession) {
      const tokens =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      await this.updateTokens(record, tokens);
    }
    const pending = record.pending ? ` · ${record.pending.action} pending` : "";
    return `Onyx · ${record.workspace.name} · ${kilo(record.contextTokens)}/${kilo(record.workspace.maxSessionTokens)}${pending}`;
  }

  recordPrompt(terminalId: string, prompt: unknown): void {
    const record = this.records.get(terminalId);
    if (!record || typeof prompt !== "string") return;
    const text = prompt.replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.startsWith("/")) return;
    record.prompts.push(
      text.length > MAX_PROMPT_CHARS ? `${text.slice(0, MAX_PROMPT_CHARS - 1)}…` : text,
    );
    if (record.prompts.length > MAX_PROMPTS) record.prompts.shift();
  }

  recordEdit(terminalId: string, toolName: string, toolInput: unknown): void {
    const record = this.records.get(terminalId);
    if (!record || !EDIT_TOOLS.has(toolName) || !isRecord(toolInput)) return;
    const target = toolInput["file_path"] ?? toolInput["notebook_path"];
    if (typeof target !== "string" || record.changedFiles.size >= MAX_CHANGED_FILES) return;
    const inside = isAbsolute(target) ? relative(record.projectRoot, target) : target;
    if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return;
    record.changedFiles.add(inside.split("\\").join("/"));
  }

  private schedule(record: TerminalRecord, injection: PendingInjection): void {
    const current = record.pending;
    if (current && current.action === "clear" && injection.action === "compact") return;
    record.pending =
      current && current.action === injection.action && current.reason === "DOMAIN_SWITCH"
        ? current
        : injection;
    if (!record.pump) {
      record.pump = setInterval(() => this.pump(record), PUMP_INTERVAL_MS);
      record.pump.unref();
    }
    this.publishState(record);
  }

  private pump(record: TerminalRecord): void {
    if (record.state !== "running" || !record.pending) {
      this.stopPump(record);
      return;
    }
    const quietFor = Date.now() - Math.max(record.lastOutputAt, record.lastInputAt);
    if (record.injecting || record.inputDirty || quietFor < this.deps.config.terminal.idleMs)
      return;
    const injection = record.pending;
    record.pending = null;
    this.stopPump(record);
    this.deliver(record, injection).catch((error: unknown) =>
      this.deps.logger.error({ err: error, terminalId: record.id }, "Terminal injection failed"),
    );
  }

  private stopPump(record: TerminalRecord): void {
    if (record.pump) clearInterval(record.pump);
    record.pump = null;
  }

  private async deliver(record: TerminalRecord, injection: PendingInjection): Promise<void> {
    record.injecting = true;
    try {
      if (injection.action === "clear") {
        const reason = injection.reason ?? "MANUAL_RESET";
        const handoff = injection.handoff ? await this.composeHandoff(record, reason) : null;
        record.awaitingClear = { reason, handoff };
        await this.type(record, "/clear");
      } else {
        await this.type(record, `/compact ${compactFocus(record.workspace.name)}`);
      }
      record.lastInjection = {
        action: injection.action,
        reason: injection.reason,
        handoff: injection.handoff,
        at: new Date().toISOString(),
      };
      await this.audit("system", `terminal.${injection.action}`, record.id, {
        workspaceId: record.workspace.id,
        sessionId: record.sessionId,
        reason: injection.reason,
        handoff: injection.handoff,
      });
    } finally {
      record.injecting = false;
      this.publishState(record);
    }
  }

  private async composeHandoff(
    record: TerminalRecord,
    reason: SessionEndReason,
  ): Promise<Handoff | null> {
    const activity: RunDigest[] =
      record.changedFiles.size > 0 || record.prompts.length > 0
        ? [
            {
              workspaceName: record.workspace.name,
              taskTitle: "Interactive terminal session",
              status: "COMPLETED",
              endedAt: new Date(),
              changedFiles: [...record.changedFiles].sort(),
              summary:
                record.prompts.length > 0
                  ? `Requests in the terminal: ${record.prompts.join(" | ")}`
                  : null,
            },
          ]
        : [];
    return this.deps.compartments.composeFor(
      record.projectId,
      record.workspace,
      { id: record.sessionId, startedAt: record.sessionStartedAt },
      reason,
      activity,
    );
  }

  private async type(record: TerminalRecord, command: string): Promise<void> {
    if (record.state !== "running") return;
    record.terminal.write(command);
    await sleep(SUBMIT_DELAY_MS);
    record.terminal.write("\r");
    record.lastInputAt = Date.now();
  }

  private async updateTokens(record: TerminalRecord, tokens: number): Promise<void> {
    if (tokens === record.contextTokens) return;
    record.contextTokens = tokens;
    const limit = record.workspace.maxSessionTokens;
    if (tokens < limit) {
      record.pressureArmed = true;
    } else if (record.pressureArmed && !record.awaitingClear && !record.pending) {
      record.pressureArmed = false;
      this.schedule(record, {
        action: "compact",
        reason: "CONTEXT_PRESSURE",
        handoff: false,
        at: new Date(),
      });
    }
    await this.persistTokens(record);
    this.publishState(record);
  }

  private async persistTokens(record: TerminalRecord): Promise<void> {
    if (record.persistedTokens === record.contextTokens) return;
    record.persistedTokens = record.contextTokens;
    await this.deps.prisma.session
      .update({
        where: { id: record.sessionId },
        data: { contextTokens: record.contextTokens, lastActivityAt: new Date() },
      })
      .catch((error: unknown) =>
        this.deps.logger.warn({ err: error, terminalId: record.id }, "Token update failed"),
      );
  }

  private handleOutput(record: TerminalRecord, data: string): void {
    record.output.append(data);
    record.lastOutputAt = Date.now();
    this.deps.hub.publishPtyOutput(record.id, data);
  }

  private async handleExit(record: TerminalRecord, exit: TerminalExit): Promise<void> {
    const { prisma, runTokens, logger } = this.deps;
    record.state = "exited";
    record.exitCode = exit.exitCode;
    if (record.activity !== null) this.deps.activity?.end(record.activity);
    record.activity = null;
    record.pending = null;
    this.stopPump(record);
    runTokens.revoke(record.id);
    record.release();
    const endedAt = new Date();
    const lost =
      record.resumed &&
      (!record.confirmed ||
        (!record.stopRequested &&
          exit.exitCode !== 0 &&
          record.prompts.length === 0 &&
          endedAt.getTime() - record.startedAt.getTime() < LOST_SESSION_WINDOW_MS));
    if (lost)
      logger.warn(
        { terminalId: record.id, sessionId: record.sessionId },
        "The resumed Claude Code session no longer exists: the next terminal starts a new one",
      );
    try {
      if (record.claudeSessionId !== null && !lost) {
        await prisma.session.update({
          where: { id: record.sessionId },
          data: { status: "IDLE", lastActivityAt: endedAt, contextTokens: record.contextTokens },
        });
      } else {
        await prisma.session.update({
          where: { id: record.sessionId },
          data: { status: "CLOSED", endReason: "ERROR", endedAt },
        });
        await prisma.workspace.updateMany({
          where: { id: record.workspace.id, activeSessionId: record.sessionId },
          data: { activeSessionId: null },
        });
      }
    } catch (error) {
      logger.warn({ err: error, terminalId: record.id }, "Could not settle the terminal session");
    }
    this.deps.indexes.scheduleRefresh(record.projectId);
    this.publishState(record);
    logger.info(
      { terminalId: record.id, exitCode: exit.exitCode, signal: exit.signal },
      "Terminal exited",
    );
  }

  private forgetExited(workspaceId: string): void {
    for (const [id, record] of this.records) {
      if (record.state === "exited" && record.workspace.id === workspaceId) this.records.delete(id);
    }
    const exited = [...this.records.values()].filter((record) => record.state === "exited");
    for (const record of exited.slice(0, Math.max(0, exited.length - MAX_EXITED_RECORDS)))
      this.records.delete(record.id);
  }

  private runningIn(workspaceId: string): TerminalRecord | null {
    for (const record of this.records.values()) {
      if (record.state === "running" && record.workspace.id === workspaceId) return record;
    }
    return null;
  }

  private require(terminalId: string): TerminalRecord {
    const record = this.records.get(terminalId);
    if (!record) throw notFound("Terminal");
    return record;
  }

  private requireRunning(terminalId: string): TerminalRecord {
    const record = this.require(terminalId);
    if (record.state !== "running") throw conflict("Terminal has exited");
    return record;
  }

  private publishState(record: TerminalRecord): void {
    if (this.deps.hub.hasListeners(channels.pty(record.id)))
      this.deps.hub.publishPtyState(this.toDto(record));
  }

  private toDto(record: TerminalRecord): TerminalDto {
    return {
      id: record.id,
      projectId: record.projectId,
      workspaceId: record.workspace.id,
      workspaceName: record.workspace.name,
      sessionId: record.sessionId,
      claudeSessionId: record.claudeSessionId,
      modelId: record.modelId,
      state: record.state,
      pid: record.state === "running" ? record.terminal.pid : null,
      exitCode: record.exitCode,
      startedAt: record.startedAt.toISOString(),
      contextTokens: record.contextTokens,
      maxSessionTokens: record.workspace.maxSessionTokens,
      pending: record.pending
        ? {
            action: record.pending.action,
            reason: record.pending.reason,
            handoff: record.pending.handoff,
            at: record.pending.at.toISOString(),
          }
        : null,
      lastInjection: record.lastInjection,
    };
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

  private async freshMemory(projectId: string, sessionId: string): Promise<string | null> {
    const composed = await this.deps.memory?.compose(projectId).catch(() => null);
    if (!composed) return null;
    await this.deps.prisma.session.update({
      where: { id: sessionId },
      data: { memory: { text: composed.text, tokens: composed.tokens, factIds: composed.factIds } },
    });
    return composed.text;
  }

  private async audit(
    actor: string,
    action: string,
    target: string,
    meta: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.deps.prisma.auditLog
      .create({ data: { actor, action, target, meta } })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Audit write failed"));
  }
}
