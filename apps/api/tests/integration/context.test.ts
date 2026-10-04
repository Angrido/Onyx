import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContextExperimentSettings,
  FileContextDto,
  GraphResponse,
  IndexStatusDto,
  ProjectDetailDto,
  RunDto,
  RunEventsResponse,
  RunItem,
  SavingsReport,
  TaskDetailDto,
  TaskDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

const MCP_PACKAGE = fileURLToPath(new URL("../../../../packages/mcp-server", import.meta.url));
const MCP_BUNDLE = join(MCP_PACKAGE, "dist", "onyx-mcp.js");

const PROJECT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", type: "module" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
  "src/index.ts": 'export * from "./types";\nexport { total } from "./cart";\n',
  "src/types.ts": "export interface Item {\n  price: number;\n  quantity: number;\n}\n",
  "src/cart.ts": [
    'import type { Item } from "./types";',
    'import { add } from "./math";',
    "export function total(items: Item[]): number {",
    "  let sum = 0;",
    "  for (const item of items) sum = add(sum, item.price * item.quantity);",
    "  return sum;",
    "}",
    "",
  ].join("\n"),
  "src/checkout.ts": [
    'import { total, type Item } from "./index";',
    "export function checkout(items: Item[]): string {",
    "  return `Total: ${total(items)}`;",
    "}",
    "",
  ].join("\n"),
};

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;
let nextDraw = 0.9;

beforeAll(async () => {
  execFileSync("pnpm", ["exec", "tsup"], { cwd: MCP_PACKAGE, stdio: "ignore" });
  context = await createTestContext({
    projectFiles: PROJECT_FILES,
    env: { ONYX_MCP_SERVER: MCP_BUNDLE },
    armRandom: () => nextDraw,
  });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  api = apiClient(context.app, await authenticate(context.app));
  const created = await api.post<ProjectDetailDto>("/api/projects", {
    name: "demo",
    rootPath: context.projectRoot,
  });
  expect(created.status).toBe(201);
  project = created.body;
  await waitFor(
    async () => (await api.get<IndexStatusDto>(`/api/projects/${project.id}/index`)).body,
    (status) => status.state === "ready",
  );
}, 120_000);

afterAll(async () => {
  if (context) await destroyTestContext(context);
});

describe("project index", () => {
  it("indexes the project when it is registered", async () => {
    const status = (await api.get<IndexStatusDto>(`/api/projects/${project.id}/index`)).body;
    expect(status.stats).toMatchObject({ files: 7, symbols: expect.any(Number) });
    const detail = (await api.get<ProjectDetailDto>(`/api/projects/${project.id}`)).body;
    expect(detail.indexedFiles).toBe(7);
    expect(detail.indexedAt).not.toBeNull();
  });

  it("serves the dependency graph, optionally focused on a file", async () => {
    const full = (await api.get<GraphResponse>(`/api/projects/${project.id}/graph`)).body;
    expect(full.nodes.map((node) => node.id)).toContain("src/cart.ts");
    expect(full.edges).toContainEqual({
      from: "src/cart.ts",
      to: "src/math.ts",
      kind: "STATIC_IMPORT",
    });
    const focused = (
      await api.get<GraphResponse>(`/api/projects/${project.id}/graph?focus=src/math.ts&depth=1`)
    ).body;
    expect(focused.focus).toBe("src/math.ts");
    expect(focused.nodes.map((node) => [node.id, node.distance]).sort()).toEqual([
      ["src/cart.ts", 1],
      ["src/math.ts", 0],
    ]);
  });

  it("serves skeletons and symbols per file", async () => {
    const file = (
      await api.get<FileContextDto>(`/api/projects/${project.id}/context?path=src/cart.ts&level=1`)
    ).body;
    expect(file.content).toContain("export function total(items: Item[]): number { …#");
    expect(file.symbols.map((symbol) => symbol.qualifiedName)).toEqual(["total"]);
    expect(file.dependencies).toEqual(["src/math.ts", "src/types.ts"]);
    const missing = await api.get(`/api/projects/${project.id}/context?path=nope.ts`);
    expect(missing.status).toBe(404);
  });

  it("re-indexes on demand and reuses unchanged files", async () => {
    const started = await api.post<IndexStatusDto>(`/api/projects/${project.id}/index`);
    expect(started.status).toBe(202);
    const done = await waitFor(
      async () => (await api.get<IndexStatusDto>(`/api/projects/${project.id}/index`)).body,
      (status) => status.state === "ready",
    );
    expect(done.stats?.parsedFiles).toBe(0);
    expect(done.stats?.reusedFiles).toBe(7);
  });
});

describe("runs with Onyx context", () => {
  it("delivers the context pack and lets the agent expand symbols over MCP", async () => {
    const workspace = project.workspaces.find((candidate) => candidate.name === "Backend");
    const created = await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: workspace?.id,
      title: "Explain checkout",
      prompt: "[stub:mcp] Explain how the checkout total is computed.",
      targetPaths: ["src/checkout.ts"],
    });
    expect(created.status).toBe(201);
    expect(created.body.targetPaths).toEqual(["src/checkout.ts"]);
    await api.post(`/api/tasks/${created.body.id}/run`);
    const task = await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${created.body.id}`)).body,
      (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
      30_000,
    );
    await context.container.scheduler.settledTask(task.id);
    expect(task.status).toBe("COMPLETED");

    const run = (await api.get<RunDto>(`/api/runs/${task.runs[0]?.id}`)).body;
    const events = (await api.get<RunEventsResponse>(`/api/runs/${run.id}/events`)).body;
    const items: RunItem[] = events.items.flatMap((event) => event.items);

    const contextItem = items.find((item) => item.kind === "context");
    expect(contextItem).toMatchObject({
      targets: ["src/checkout.ts"],
      mcpEnabled: true,
      note: null,
    });
    const levels = Object.fromEntries(
      (contextItem?.kind === "context" ? contextItem.entries : []).map((entry) => [
        entry.relPath,
        entry.level,
      ]),
    );
    expect(levels).toMatchObject({ "src/checkout.ts": 3, "src/cart.ts": 1, "src/types.ts": 2 });

    const toolUse = items.find((item) => item.kind === "tool_use");
    expect(toolUse).toMatchObject({ name: "mcp__onyx__expand_symbol" });
    const toolResult = items.find((item) => item.kind === "tool_result");
    expect(toolResult).toMatchObject({ isError: false });
    expect(toolResult?.kind === "tool_result" ? toolResult.content : "").toContain(
      "src/cart.ts:3-7 · function total",
    );

    expect(run.context.expansions).toBe(1);
    expect(run.context.deliveredTokens ?? 0).toBeGreaterThan(
      contextItem?.kind === "context" ? contextItem.deliveredTokens : 0,
    );
    expect(run.context.baselineTokens).toBeGreaterThan(0);
    expect(items.find((item) => item.kind === "prompt")).toMatchObject({
      text: "[stub:mcp] Explain how the checkout total is computed.",
    });

    const runtimeDir = join(context.dataDir, "runtime", run.id);
    const mcpConfig = JSON.parse(readFileSync(join(runtimeDir, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
    };
    expect(mcpConfig.mcpServers["onyx"]?.args).toEqual([MCP_BUNDLE]);
    expect(readFileSync(join(runtimeDir, "primer.md"), "utf8")).toContain("## Onyx project map");
    expect(readFileSync(join(runtimeDir, "context-pack.md"), "utf8")).toContain(
      "### src/checkout.ts (full source)",
    );
  }, 60_000);

  it("rejects internal calls without a live run token or from other hosts", async () => {
    const anonymous = await context.app.inject({
      method: "POST",
      url: "/internal/mcp/search_symbols",
      payload: { query: "total" },
    });
    expect(anonymous.statusCode).toBe(401);
    const expired = await context.app.inject({
      method: "POST",
      url: "/internal/mcp/search_symbols",
      headers: { authorization: "Bearer not-a-token" },
      payload: { query: "total" },
    });
    expect(expired.statusCode).toBe(401);
    const remote = await context.app.inject({
      method: "POST",
      url: "/internal/mcp/search_symbols",
      remoteAddress: "192.168.1.20",
      headers: { authorization: "Bearer whatever" },
      payload: { query: "total" },
    });
    expect(remote.statusCode).toBe(403);
  });
});

async function runTask(input: {
  title: string;
  prompt: string;
  targetPaths: string[];
  newSession?: boolean;
}): Promise<{ run: RunDto; items: RunItem[] }> {
  const workspace = project.workspaces.find((candidate) => candidate.name === "Backend");
  const created = await api.post<TaskDto>("/api/tasks", {
    projectId: project.id,
    workspaceId: workspace?.id,
    title: input.title,
    prompt: input.prompt,
    targetPaths: input.targetPaths,
  });
  expect(created.status).toBe(201);
  await api.post(`/api/tasks/${created.body.id}/run`, { newSession: input.newSession ?? false });
  const task = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${created.body.id}`)).body,
    (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
    30_000,
  );
  await context.container.scheduler.settledTask(task.id);
  expect(task.status).toBe("COMPLETED");
  const run = (await api.get<RunDto>(`/api/runs/${task.runs[0]?.id}`)).body;
  const events = (await api.get<RunEventsResponse>(`/api/runs/${run.id}/events`)).body;
  return { run, items: events.items.flatMap((event) => event.items) };
}

async function rawTokens(relPath: string): Promise<number> {
  const file = (
    await api.get<FileContextDto>(`/api/projects/${project.id}/context?path=${relPath}&level=3`)
  ).body;
  return file.rawTokens;
}

describe("savings measurement", () => {
  it("counts the files the agent reads again after the pack delivered them", async () => {
    const { run } = await runTask({
      title: "Read around checkout",
      prompt:
        "[stub:guard] read:src/checkout.ts read:src/cart.ts read:src/math.ts read:tsconfig.json",
      targetPaths: ["src/checkout.ts"],
    });
    expect(run.context).toMatchObject({
      arm: null,
      readFiles: 4,
      rereadFiles: 2,
      missedFiles: 1,
      rereadPaths: ["src/cart.ts", "src/checkout.ts"],
    });
    expect(run.context.rereadTokens).toBe(
      (await rawTokens("src/checkout.ts")) + (await rawTokens("src/cart.ts")),
    );

    const report = (await api.get<SavingsReport>("/api/telemetry/savings")).body;
    expect(report.contextEnabled).toBe(true);
    expect(report.experiment.state).toBe("OFF");
    expect(report.verdict.state).toBe("ESTIMATE_ONLY");
    expect(report.pack).toMatchObject({ runsWithPack: 2, runsWithRereads: 1, rereadFiles: 2 });
    expect(report.pack.topRereads).toEqual([
      { relPath: "src/cart.ts", runs: 1 },
      { relPath: "src/checkout.ts", runs: 1 },
    ]);
    expect(report.pack.netSaving).toBeLessThan(report.pack.grossSaving ?? 0);
    expect(report.checks.map((check) => check.id)).toEqual([
      "context",
      "coverage",
      "rereads",
      "net",
      "experiment",
    ]);
  }, 60_000);

  it("validates the experiment settings", async () => {
    const initial = await api.get<ContextExperimentSettings>("/api/telemetry/savings/experiment");
    expect(initial.body).toEqual({ enabled: false, controlShare: 0.25 });
    const invalid = await api.put("/api/telemetry/savings/experiment", {
      enabled: true,
      controlShare: 0.9,
    });
    expect(invalid.status).toBe(400);
    const saved = await api.put<ContextExperimentSettings>("/api/telemetry/savings/experiment", {
      enabled: true,
      controlShare: 0.5,
    });
    expect(saved.body).toEqual({ enabled: true, controlShare: 0.5 });
  });

  it("withholds the Onyx context from control runs of the experiment", async () => {
    nextDraw = 0.1;
    const control = await runTask({
      title: "Control run",
      prompt: "Explain checkout.",
      targetPaths: ["src/checkout.ts"],
      newSession: true,
    });
    expect(control.run.context).toMatchObject({ arm: "CONTROL", baselineTokens: null });
    expect(control.items.find((item) => item.kind === "context")).toMatchObject({
      arm: "CONTROL",
      entries: [],
      mcpEnabled: false,
      note: "Control run of the savings experiment: the Onyx context is withheld",
    });
    const runtimeDir = join(context.dataDir, "runtime", control.run.id);
    expect(existsSync(join(runtimeDir, "primer.md"))).toBe(false);
    expect(existsSync(join(runtimeDir, "context-pack.md"))).toBe(false);
    expect(JSON.parse(readFileSync(join(runtimeDir, "mcp.json"), "utf8"))).toEqual({
      mcpServers: {},
    });

    nextDraw = 0.9;
    const packed = await runTask({
      title: "Pack run",
      prompt: "Explain checkout.",
      targetPaths: ["src/checkout.ts"],
      newSession: true,
    });
    expect(packed.run.context.arm).toBe("PACK");
    expect(packed.run.context.baselineTokens).toBeGreaterThan(0);

    const resumed = await runTask({
      title: "Resumed run",
      prompt: "Explain checkout again.",
      targetPaths: ["src/checkout.ts"],
    });
    expect(resumed.run.context.arm).toBeNull();

    const report = (await api.get<SavingsReport>("/api/telemetry/savings")).body;
    expect(report.experiment).toMatchObject({
      state: "COLLECTING",
      pack: { runs: 1, completed: 1 },
      control: { runs: 1, completed: 1 },
    });
    expect(report.experiment.since).not.toBeNull();
    expect(report.verdict.state).toBe("COLLECTING");
    expect(report.pack.controlRuns).toBe(1);
    await api.put("/api/telemetry/savings/experiment", { enabled: false, controlShare: 0.5 });
  }, 90_000);
});
