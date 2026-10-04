import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { createTestDatabase } from "@onyx/db/testing";
import { apiClient, authenticate, createTestContext, destroyTestContext } from "../tests/helpers";

const PROJECTS = Number(process.env.BENCH_PROJECTS ?? 20);
const RUNS = Number(process.env.BENCH_RUNS ?? 20_000);
const TOKEN_LOGS = Number(process.env.BENCH_TOKEN_LOGS ?? 2_000_000);
const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"];
const TIERS = ["BUILDER", "ARCHITECT", "SCOUT"];
const DAY_MS = 86_400_000;

function seed(path: string): void {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");
  const now = Date.now();
  const iso = (offset: number) => new Date(now - offset).toISOString().replace("Z", "+00:00");
  const project = db.prepare(
    "INSERT INTO Project (id, name, rootPath, defaultBranch, createdAt, updatedAt) VALUES (?, ?, ?, 'main', ?, ?)",
  );
  const workspace = db.prepare(
    "INSERT INTO Workspace (id, projectId, name, domain, pathGlobs, writeFenceGlobs, position, createdAt, updatedAt) VALUES (?, ?, 'Core', 'CUSTOM', '[\"**\"]', '[\"**\"]', 0, ?, ?)",
  );
  const session = db.prepare(
    "INSERT INTO Session (id, workspaceId, modelId, status, startedAt, lastActivityAt) VALUES (?, ?, ?, 'IDLE', ?, ?)",
  );
  const task = db.prepare(
    "INSERT INTO Task (id, projectId, workspaceId, title, prompt, kind, status, priority, createdAt, updatedAt, completedAt) VALUES (?, ?, ?, ?, ?, 'FEATURE', ?, 0, ?, ?, ?)",
  );
  const decision = db.prepare(
    "INSERT INTO RoutingDecision (id, taskId, strategy, features, tier, modelId, rationale, createdAt) VALUES (?, ?, 'HEURISTIC', '{}', ?, ?, 'bench', ?)",
  );
  const run = db.prepare(
    "INSERT INTO AgentRun (id, taskId, sessionId, routingDecisionId, modelId, prompt, args, status, costUsd, ctxReadFiles, ctxBaselineTokens, ctxDeliveredTokens, ctxRereadTokens, ctxRereadFiles, startedAt, endedAt) VALUES (?, ?, ?, ?, ?, 'bench', '[]', ?, ?, 3, 9000, 3000, 500, ?, ?, ?)",
  );
  const log = db.prepare(
    "INSERT INTO TokenLog (id, runId, sessionId, modelId, scope, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUsd, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const sessions: { id: string; projectId: string; workspaceId: string }[] = [];
  db.transaction(() => {
    for (let index = 0; index < PROJECTS; index += 1) {
      const projectId = randomUUID();
      const workspaceId = randomUUID();
      project.run(projectId, `bench-${index}`, `/srv/bench/${index}`, iso(0), iso(0));
      workspace.run(workspaceId, projectId, iso(0), iso(0));
      const sessionId = randomUUID();
      session.run(sessionId, workspaceId, MODELS[0], iso(0), iso(0));
      sessions.push({ id: sessionId, projectId, workspaceId });
    }
  })();
  const runIds: { id: string; session: string; model: string; at: string }[] = [];
  db.transaction(() => {
    for (let index = 0; index < RUNS; index += 1) {
      const owner = sessions[index % sessions.length];
      if (!owner) continue;
      const offset = Math.floor((index / RUNS) * 120 * DAY_MS);
      const at = iso(offset);
      const taskId = randomUUID();
      const decisionId = randomUUID();
      const runId = randomUUID();
      const model = MODELS[index % MODELS.length] ?? MODELS[0];
      const status = index % 7 === 0 ? "FAILED" : "COMPLETED";
      task.run(
        taskId,
        owner.projectId,
        owner.workspaceId,
        `Task ${index}`,
        "bench",
        status,
        at,
        at,
        at,
      );
      decision.run(decisionId, taskId, TIERS[index % TIERS.length], model, at);
      run.run(runId, taskId, owner.id, decisionId, model, status, 0.02, index % 5, at, at);
      runIds.push({ id: runId, session: owner.id, model: model ?? "", at });
    }
  })();
  const perRun = Math.max(1, Math.floor(TOKEN_LOGS / Math.max(1, runIds.length)));
  const batch = 50_000;
  let written = 0;
  while (written < TOKEN_LOGS) {
    db.transaction(() => {
      for (let step = 0; step < batch && written < TOKEN_LOGS; step += 1, written += 1) {
        const owner = runIds[Math.floor(written / perRun) % runIds.length];
        if (!owner) continue;
        const total = written % perRun === 0;
        log.run(
          randomUUID(),
          owner.id,
          owner.session,
          owner.model,
          total ? "RUN_TOTAL" : "TURN",
          1200,
          300,
          800,
          9000,
          total ? 0.02 : null,
          owner.at,
        );
      }
    })();
  }
  db.close();
}

async function time(label: string, action: () => Promise<{ status: number }>): Promise<void> {
  const first = await action();
  if (first.status !== 200) throw new Error(`${label} answered ${first.status}`);
  const samples: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    await action();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  process.stdout.write(`${label.padEnd(34)} ${samples[1]?.toFixed(0)} ms\n`);
}

async function main(): Promise<void> {
  const database = createTestDatabase();
  const seeded = performance.now();
  seed(database.path);
  process.stdout.write(
    `Seeded ${PROJECTS} projects, ${RUNS} runs, ${TOKEN_LOGS} token logs in ${((performance.now() - seeded) / 1000).toFixed(1)} s\n`,
  );
  const context = await createTestContext({ database });
  const api = apiClient(context.app, await authenticate(context.app));
  const uncached = async (path: string) => {
    context.container.router.forgetTelemetry();
    context.container.savings.forget();
    return api.get(path);
  };
  await time("GET /api/telemetry/summary", () => uncached("/api/telemetry/summary"));
  await time("GET /api/telemetry/routing", () => uncached("/api/telemetry/routing"));
  await time("GET /api/telemetry/savings", () => uncached("/api/telemetry/savings"));
  await time("GET /api/telemetry/savings (cached)", () => api.get("/api/telemetry/savings"));
  await time("GET /api/tasks?limit=200", () => api.get("/api/tasks?limit=200"));
  await time("GET /api/projects", () => api.get("/api/projects"));
  await destroyTestContext(context);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
