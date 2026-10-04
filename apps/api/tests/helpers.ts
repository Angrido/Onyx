import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stubBinary } from "@onyx/agent-runtime/testing";
import { createTestDatabase, type TestDatabase } from "@onyx/db/testing";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createContainer, type Container } from "../src/container";
import type { HandoffSummarizer, TaskClassifier } from "../src/infrastructure/aux-model";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct-horse-battery";

export interface TestContext {
  app: FastifyInstance;
  container: Container;
  database: TestDatabase;
  dataDir: string;
  projectsDir: string;
  projectRoot: string;
  close(): Promise<void>;
}

export interface TestContextOptions {
  maxConcurrent?: number;
  stubDelayMs?: number;
  database?: TestDatabase;
  dataDir?: string;
  env?: Record<string, string>;
  projectFiles?: Record<string, string>;
  classifier?: TaskClassifier | null;
  summarizer?: HandoffSummarizer | null;
  sourceEnv?: Record<string, string>;
  checkCli?: boolean;
  armRandom?: () => number;
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const database = options.database ?? createTestDatabase();
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "onyx-api-"));
  const projectsDir = join(dataDir, "projects");
  const projectRoot = join(projectsDir, "demo");
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src", "math.ts"),
    "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
  );
  for (const [relPath, content] of Object.entries(options.projectFiles ?? {})) {
    mkdirSync(dirname(join(projectRoot, relPath)), { recursive: true });
    writeFileSync(join(projectRoot, relPath), content);
  }

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: database.url,
    ONYX_DATA_DIR: dataDir,
    ONYX_PROJECTS_DIR: projectsDir,
    ONYX_ALLOWED_ORIGINS: ORIGIN,
    MAX_CONCURRENT_AGENTS: String(options.maxConcurrent ?? 2),
    RUN_ESCALATION_GRACE_MS: "300",
    ONYX_CHILD_ENV_PASSTHROUGH: [
      "CLAUDE_STUB_DELAY_MS",
      ...Object.keys(options.sourceEnv ?? {}),
    ].join(","),
    ...options.env,
  });
  const container = await createContainer(config, pino({ level: "silent" }), {
    binary: stubBinary(),
    sourceEnv: { CLAUDE_STUB_DELAY_MS: String(options.stubDelayMs ?? 5), ...options.sourceEnv },
    closeGraceMs: 300,
    terminalKillGraceMs: 300,
    indexRefreshDelayMs: 50,
    classifier: options.classifier ?? null,
    summarizer: options.summarizer ?? null,
    checkCli: options.checkCli ?? false,
    ...(options.armRandom ? { armRandom: options.armRandom } : {}),
  });
  await container.start();
  const app = await buildApp(container);
  await app.ready();

  let closed = false;
  return {
    app,
    container,
    database,
    dataDir,
    projectsDir,
    projectRoot,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await container.stop();
    },
  };
}

export function destroyTestContext(context: TestContext): Promise<void> {
  return context.close().finally(() => {
    context.database.cleanup();
    rmSync(context.dataDir, { recursive: true, force: true });
  });
}

export async function authenticate(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: { origin: ORIGIN },
    payload: { username: "admin", password: PASSWORD },
  });
  if (response.statusCode !== 201) throw new Error(`Setup failed: ${response.body}`);
  const cookie = response.cookies.find((entry) => entry.name === "onyx_sid");
  if (!cookie) throw new Error("Session cookie missing");
  return `onyx_sid=${cookie.value}`;
}

export interface ApiClient {
  get<T>(url: string): Promise<{ status: number; body: T }>;
  post<T>(url: string, payload?: unknown): Promise<{ status: number; body: T }>;
  patch<T>(url: string, payload: unknown): Promise<{ status: number; body: T }>;
  put<T>(url: string, payload: unknown): Promise<{ status: number; body: T }>;
  delete(url: string): Promise<{ status: number; body: unknown }>;
}

export function apiClient(app: FastifyInstance, cookie: string): ApiClient {
  const request = async <T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ) => {
    const response = await app.inject({
      method,
      url,
      headers: { cookie, origin: ORIGIN },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return {
      status: response.statusCode,
      body: (response.body.length > 0 ? response.json() : null) as T,
    };
  };
  return {
    get: (url) => request("GET", url),
    post: (url, payload) => request("POST", url, payload ?? {}),
    patch: (url, payload) => request("PATCH", url, payload),
    put: (url, payload) => request("PUT", url, payload),
    delete: (url) => request("DELETE", url),
  };
}

export async function waitFor<T>(
  probe: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
