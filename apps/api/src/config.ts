import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === "true" || value === "1"));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().min(1),
  ONYX_DATA_DIR: z.string().default("./.onyx-data"),
  ONYX_PROJECTS_DIR: z.string().default("./.onyx-data/projects"),
  ONYX_ALLOWED_PROJECT_ROOTS: csv,
  ONYX_ALLOWED_ORIGINS: csv,
  ONYX_PUBLIC_ORIGIN: z.string().optional(),
  ONYX_CHILD_ENV_PASSTHROUGH: csv,
  COOKIE_SECURE: booleanFlag(false),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(168),
  MAX_CONCURRENT_AGENTS: z.coerce.number().int().min(1).max(16).default(2),
  RUN_ESCALATION_GRACE_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  AUTO_RESUME_QUEUED: booleanFlag(true),
  CLAUDE_BIN: z.string().min(1).default("claude"),
  ONYX_CONTEXT_ENABLED: booleanFlag(true),
  ONYX_CONTEXT_BUDGET_TOKENS: z.coerce.number().int().min(1_000).max(200_000).default(24_000),
  ONYX_MAP_BUDGET_TOKENS: z.coerce.number().int().min(200).max(50_000).default(4_000),
  ONYX_INDEX_WAIT_MS: z.coerce.number().int().min(0).max(600_000).default(30_000),
  ONYX_MCP_SERVER: z.string().optional(),
  ONYX_STATUSLINE: z.string().optional(),
  ONYX_TERMINAL_IDLE_MS: z.coerce.number().int().min(100).max(60_000).default(1_500),
  ONYX_INTERNAL_API_URL: z.string().url().optional(),
  ONYX_GITHUB_TOKEN: z.string().optional(),
  ONYX_GITHUB_API_URL: z.string().url().optional(),
  ONYX_SECRET_KEY_FILE: z.string().optional(),
  ONYX_SECRET_KEY: z.string().optional(),
  ONYX_BACKUP_DIR: z.string().optional(),
  ONYX_BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  ONYX_BACKUP_INTERVAL_HOURS: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .default(24),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
});

export type ClaudeCredentials =
  { kind: "api-key"; value: string } | { kind: "oauth-token"; value: string } | { kind: "none" };

export interface ContextConfig {
  enabled: boolean;
  packBudgetTokens: number;
  mapBudgetTokens: number;
  indexWaitMs: number;
  mcpServerPath: string | null;
}

export interface GitHubConfig {
  token: string | null;
  apiUrl: string;
}

export interface TerminalConfig {
  statusLinePath: string | null;
  idleMs: number;
}

export interface AppConfig {
  env: "development" | "production" | "test";
  logLevel: string;
  host: string;
  port: number;
  databaseUrl: string;
  dataDir: string;
  runtimeDir: string;
  projectsDir: string;
  allowedProjectRoots: string[];
  allowedOrigins: string[];
  childEnvPassthrough: string[];
  cookieSecure: boolean;
  sessionTtlMs: number;
  maxConcurrentAgents: number;
  escalationGraceMs: number;
  autoResumeQueued: boolean;
  claudeBin: string;
  credentials: ClaudeCredentials;
  context: ContextConfig;
  terminal: TerminalConfig;
  github: GitHubConfig;
  internalApiUrl: string;
  secrets: SecretsConfig;
  backup: BackupConfig;
  agentProtectedPaths: string[];
}

export interface SecretsConfig {
  keyFile: string;
  key: string | null;
}

export interface BackupConfig {
  dir: string;
  keep: number;
  intervalHours: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function resolveCredentials(apiKey?: string, oauthToken?: string): ClaudeCredentials {
  const key = apiKey?.trim() ?? "";
  const token = oauthToken?.trim() ?? "";
  if (key.length > 0 && token.length > 0) {
    throw new ConfigError(
      "Set only one of ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (see ADR-008)",
    );
  }
  if (key.length > 0) return { kind: "api-key", value: key };
  if (token.length > 0) return { kind: "oauth-token", value: token };
  return { kind: "none" };
}

const SERVICE_CONFIG_DIR = "/etc/onyx";

function databaseFiles(databaseUrl: string): string[] {
  if (!databaseUrl.startsWith("file:")) return [];
  const file = resolve(databaseUrl.slice("file:".length).split("?")[0] ?? "");
  return [file, `${file}-wal`, `${file}-shm`, `${file}-journal`];
}

function loopbackHost(apiHost: string): string {
  if (apiHost === "0.0.0.0" || apiHost === "127.0.0.1" || apiHost === "localhost")
    return "127.0.0.1";
  if (apiHost === "::" || apiHost === "::1") return "[::1]";
  return apiHost.includes(":") ? `[${apiHost}]` : apiHost;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  const dataDir = resolve(env.ONYX_DATA_DIR);
  const projectsDir = resolve(env.ONYX_PROJECTS_DIR);
  const mcpServerPath =
    env.ONYX_MCP_SERVER && env.ONYX_MCP_SERVER.trim().length > 0
      ? resolve(env.ONYX_MCP_SERVER)
      : null;
  const statusLinePath =
    env.ONYX_STATUSLINE && env.ONYX_STATUSLINE.trim().length > 0
      ? resolve(env.ONYX_STATUSLINE)
      : mcpServerPath
        ? join(dirname(mcpServerPath), "onyx-statusline.js")
        : null;
  const keyFile = resolve(env.ONYX_SECRET_KEY_FILE ?? join(dataDir, "secret.key"));
  const backupDir = resolve(env.ONYX_BACKUP_DIR ?? join(dataDir, "backups"));
  const runtimeDir = resolve(dataDir, "runtime");
  const allowedOrigins = [
    ...env.ONYX_ALLOWED_ORIGINS,
    ...(env.ONYX_PUBLIC_ORIGIN ? [env.ONYX_PUBLIC_ORIGIN] : []),
  ];

  return {
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.API_HOST,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    dataDir,
    runtimeDir,
    projectsDir,
    allowedProjectRoots:
      env.ONYX_ALLOWED_PROJECT_ROOTS.length > 0
        ? env.ONYX_ALLOWED_PROJECT_ROOTS.map((root) => resolve(root))
        : [projectsDir],
    allowedOrigins,
    childEnvPassthrough: env.ONYX_CHILD_ENV_PASSTHROUGH,
    cookieSecure: env.COOKIE_SECURE,
    sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
    maxConcurrentAgents: env.MAX_CONCURRENT_AGENTS,
    escalationGraceMs: env.RUN_ESCALATION_GRACE_MS,
    autoResumeQueued: env.AUTO_RESUME_QUEUED,
    claudeBin: env.CLAUDE_BIN,
    credentials: resolveCredentials(env.ANTHROPIC_API_KEY, env.CLAUDE_CODE_OAUTH_TOKEN),
    context: {
      enabled: env.ONYX_CONTEXT_ENABLED,
      packBudgetTokens: env.ONYX_CONTEXT_BUDGET_TOKENS,
      mapBudgetTokens: env.ONYX_MAP_BUDGET_TOKENS,
      indexWaitMs: env.ONYX_INDEX_WAIT_MS,
      mcpServerPath,
    },
    terminal: { statusLinePath, idleMs: env.ONYX_TERMINAL_IDLE_MS },
    github: {
      token:
        env.ONYX_GITHUB_TOKEN && env.ONYX_GITHUB_TOKEN.trim().length > 0
          ? env.ONYX_GITHUB_TOKEN.trim()
          : null,
      apiUrl: env.ONYX_GITHUB_API_URL ?? "https://api.github.com",
    },
    internalApiUrl: (
      env.ONYX_INTERNAL_API_URL ?? `http://${loopbackHost(env.API_HOST)}:${env.API_PORT}`
    ).replace(/\/+$/, ""),
    secrets: {
      keyFile,
      key:
        env.ONYX_SECRET_KEY && env.ONYX_SECRET_KEY.trim().length > 0
          ? env.ONYX_SECRET_KEY.trim()
          : null,
    },
    backup: {
      dir: backupDir,
      keep: env.ONYX_BACKUP_KEEP,
      intervalHours: env.ONYX_BACKUP_INTERVAL_HOURS,
    },
    agentProtectedPaths: [
      keyFile,
      ...databaseFiles(env.DATABASE_URL),
      backupDir,
      runtimeDir,
      join(dataDir, "logs"),
      SERVICE_CONFIG_DIR,
    ],
  };
}

export function credentialEnv(credentials: ClaudeCredentials): Record<string, string> {
  switch (credentials.kind) {
    case "api-key":
      return { ANTHROPIC_API_KEY: credentials.value };
    case "oauth-token":
      return { CLAUDE_CODE_OAUTH_TOKEN: credentials.value };
    case "none":
      return {};
  }
}
