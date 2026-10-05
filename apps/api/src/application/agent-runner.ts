import type { AgentPool, ProcessExit } from "@onyx/agent-runtime";
import { normalizeClaudeEvent, type RunItemOf } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import { costOfModel, usageByModel, type ModelUsageRow } from "../domain/exploration";
import { buildRunSettings, guardHooks, RUN_TOKEN_ENV } from "../domain/permission-rules";
import {
  buildMcpConfig,
  emptyMcpConfig,
  isReadableFile,
  ONYX_MCP_ALLOW_RULE,
} from "../infrastructure/mcp-config";
import type { RunTokenRegistry } from "../infrastructure/run-tokens";
import { writeRuntimeFiles } from "../infrastructure/runtime-files";
import type { CredentialService } from "./credential-service";
import { priceUsage } from "./router-service";
import type { SurgeonService } from "./surgeon-service";

const AGENT_TIMEOUTS = { wallClockMs: 15 * 60_000, idleMs: 5 * 60_000, initMs: 120_000 };

export interface AgentRunnerDeps {
  prisma: PrismaClient;
  logger: Logger;
  pool: AgentPool;
  surgeon: Pick<SurgeonService, "runScope">;
  runTokens: RunTokenRegistry;
  credentials: Pick<CredentialService, "childEnv">;
  config: Pick<
    AppConfig,
    "runtimeDir" | "childEnvPassthrough" | "internalApiUrl" | "agentProtectedPaths" | "context"
  >;
  sourceEnv?: NodeJS.ProcessEnv;
  timeouts?: { wallClockMs: number; idleMs: number; initMs: number };
}

export interface AgentRequest {
  runId: string;
  owner: string;
  projectId: string;
  cwd: string;
  prompt: string;
  modelId: string;
  maxTurns: number;
  permissionMode: "plan" | "acceptEdits";
  allowedTools: string[];
  disallowedTools: string[];
  jsonSchema: string | null;
  purpose: string;
  mcp?: boolean;
}

export interface AgentResult {
  result: RunItemOf<"result"> | null;
  exit: ProcessExit;
  modelId: string;
  costUsd: number | null;
  tokens: number | null;
}

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "LS"];
export const WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"];

export function structuredOf(result: RunItemOf<"result">): unknown {
  if (result.structuredOutput !== null && result.structuredOutput !== undefined)
    return result.structuredOutput;
  const text = result.resultText ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export class AgentRunner {
  private readonly active = new Map<string, string>();

  constructor(private readonly deps: AgentRunnerDeps) {}

  async abortOwner(owner: string): Promise<void> {
    for (const [runId, current] of this.active)
      if (current === owner) await this.deps.pool.abort(runId).catch(() => undefined);
  }

  async abortAll(): Promise<void> {
    for (const runId of this.active.keys())
      await this.deps.pool.abort(runId).catch(() => undefined);
  }

  async run(input: AgentRequest): Promise<AgentResult> {
    const { config, pool } = this.deps;
    const scope = await this.deps.surgeon.runScope(input.projectId, null);
    const token = this.deps.runTokens.issue(input.runId, input.projectId, {
      workspaceId: null,
      policy: scope.policy,
      guard: scope.guard,
      fence: null,
    });
    const mcp =
      input.mcp === true &&
      config.context.enabled &&
      config.context.mcpServerPath !== null &&
      isReadableFile(config.context.mcpServerPath);
    const files = await writeRuntimeFiles({
      runtimeDir: config.runtimeDir,
      runId: input.runId,
      agents: null,
      settings: buildRunSettings({
        deny: [...scope.compiled.readDeny, ...scope.compiled.editDeny],
        protectedPaths: config.agentProtectedPaths,
        hooks: guardHooks(config.internalApiUrl),
      }),
      primer: null,
      mcpConfig:
        mcp && config.context.mcpServerPath !== null
          ? buildMcpConfig({
              serverPath: config.context.mcpServerPath,
              apiUrl: config.internalApiUrl,
              token,
            })
          : emptyMcpConfig(),
    });
    let result: RunItemOf<"result"> | null = null;
    let exit: ProcessExit;
    this.active.set(input.runId, input.owner);
    try {
      exit = await pool.run(
        {
          runId: input.runId,
          cwd: input.cwd,
          prompt: input.prompt,
          model: input.modelId,
          fallbackModels: [],
          permissionMode: input.permissionMode,
          maxTurns: input.maxTurns,
          agentsFile: files.agentsFile,
          session: { mode: "ephemeral" },
          allowedTools: [...input.allowedTools, ...(mcp ? [ONYX_MCP_ALLOW_RULE] : [])],
          disallowedTools: input.disallowedTools,
          settingsFile: files.settingsFile,
          mcpConfigFile: files.mcpConfigFile,
          appendSystemPromptFile: null,
          includePartialMessages: false,
          env: {
            ...this.passthroughEnv(),
            ...(await this.deps.credentials.childEnv()),
            [RUN_TOKEN_ENV]: token,
          },
          timeouts: this.deps.timeouts ?? AGENT_TIMEOUTS,
          ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}),
        },
        {
          onSpawn: () => undefined,
          onEvent: (event) => {
            for (const item of normalizeClaudeEvent(event))
              if (item.kind === "result") result = item;
          },
          onInvalidLine: () => undefined,
          onStderr: () => undefined,
          onHandlerError: (error) =>
            this.deps.logger.warn({ err: error, runId: input.runId }, "Agent handler failed"),
        },
      );
    } finally {
      this.active.delete(input.runId);
      this.deps.runTokens.revoke(input.runId);
    }
    const final = result as RunItemOf<"result"> | null;
    const costUsd = final ? await this.recordUsage(input.modelId, final, input.purpose) : null;
    return {
      result: final,
      exit,
      modelId: input.modelId,
      costUsd,
      tokens: final
        ? final.usage.inputTokens +
          final.usage.cacheCreationTokens +
          final.usage.cacheReadTokens +
          final.usage.outputTokens
        : null,
    };
  }

  private async recordUsage(
    modelId: string,
    result: RunItemOf<"result">,
    purpose: string,
  ): Promise<number | null> {
    const rows: ModelUsageRow[] = usageByModel(result, modelId);
    const profile = await this.deps.prisma.modelProfile.findUnique({ where: { id: modelId } });
    const costUsd = result.costUsd ?? (profile ? priceUsage(result.usage, profile) : null);
    await this.deps.prisma.tokenLog
      .createMany({
        data: rows.map((row) => ({
          modelId: row.modelId,
          scope: "AUX" as const,
          purpose,
          ...row.usage,
          costUsd: rows.length === 1 ? costUsd : row.costUsd,
        })),
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Agent token log failed"));
    return costUsd ?? costOfModel(rows, modelId);
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
}
