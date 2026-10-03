import { resolve } from "node:path";
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
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
});

export type ClaudeCredentials =
  { kind: "api-key"; value: string } | { kind: "oauth-token"; value: string } | { kind: "none" };

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
    runtimeDir: resolve(dataDir, "runtime"),
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
