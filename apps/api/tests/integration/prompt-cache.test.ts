import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ContextItem,
  ProjectDetailDto,
  RunDto,
  SavingsReport,
  RunEventsResponse,
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

const SOURCE = Array.from({ length: 60 }, (_, line) => `export const value${line} = ${line};`).join(
  "\n",
);

const PROJECT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "cache-demo", type: "module" }),
  "src/cart.ts": `import { price } from "./price";\n\nexport function total(items: number[]): number {\n  return items.reduce((sum, item) => sum + price(item), 0);\n}\n${SOURCE}\n`,
  "src/price.ts": `export function price(amount: number): number {\n  return Math.round(amount * 100) / 100;\n}\n${SOURCE}\n`,
  "src/checkout.ts": `import { total } from "./cart";\n\nexport function checkout(items: number[]): string {\n  return \`Total \${total(items)}\`;\n}\n`,
};

let stubState: string;
let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;
let task: TaskDto;

async function run(prompt: string | null): Promise<{ run: RunDto; item: ContextItem }> {
  const before = (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body.runs.length;
  await api.post(`/api/tasks/${task.id}/run`, prompt === null ? {} : { prompt });
  const detail = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
    (entry) => entry.runs.length > before && entry.status === "COMPLETED",
    30_000,
  );
  await context.container.scheduler.settledTask(task.id);
  const latest = (await api.get<RunDto>(`/api/runs/${detail.runs[0]?.id}`)).body;
  const events = (await api.get<RunEventsResponse>(`/api/runs/${latest.id}/events`)).body;
  const item = events.items
    .flatMap((event) => event.items)
    .find((entry): entry is ContextItem => entry.kind === "context");
  if (!item) throw new Error("context item missing");
  return { run: latest, item };
}

async function echoedMessage(runId: string): Promise<string> {
  const events = (await api.get<RunEventsResponse>(`/api/runs/${runId}/events`)).body;
  return events.items
    .flatMap((event) => event.items)
    .flatMap((entry) => (entry.kind === "text" ? [entry.text] : []))
    .join("\n");
}

beforeAll(async () => {
  stubState = mkdtempSync(join(tmpdir(), "onyx-stub-state-"));
  context = await createTestContext({
    projectFiles: PROJECT_FILES,
    sourceEnv: { CLAUDE_STUB_USAGE: "model", CLAUDE_STUB_STATE_DIR: stubState },
  });
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "cache-demo",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
  task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title: "Round the cart total",
      prompt: "Round the total in src/cart.ts [stub:quick]",
      targetPaths: ["src/cart.ts"],
    })
  ).body;
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(stubState, { recursive: true, force: true });
});

describe("prompt cache and context reuse across a session", () => {
  it("records a new session as such and sends the whole pack", async () => {
    const { run: first, item } = await run(null);
    expect(first.cache.loss).toBe("NEW_SESSION");
    expect(first.cache.writeTokens).toBeGreaterThan(14_000);
    expect(item.mapFrozen).toBe(false);
    expect(item.reusedTokens).toBe(0);
    expect(item.entries.some((entry) => entry.relPath === "src/cart.ts")).toBe(true);
    expect(await echoedMessage(first.id)).toContain("export const value59 = 59;");
    const session = await context.container.prisma.session.findUniqueOrThrow({
      where: { id: first.sessionId },
    });
    expect(session.contextMap).not.toBeNull();
    expect(Object.keys(session.deliveredPack as object)).toContain("src/cart.ts");
  });

  it("resumes from the cache and does not send the pack again", async () => {
    const { run: resumed, item } = await run("Also handle empty carts [stub:quick]");
    expect(resumed.cache.loss).toBe("NONE");
    expect(resumed.cache.lostTokens).toBe(0);
    expect(resumed.cache.readTokens).toBeGreaterThan(14_000);
    expect(item.mapFrozen).toBe(true);
    expect(item.entries.find((entry) => entry.relPath === "src/cart.ts")?.reused).toBe(true);
    expect(item.reusedTokens).toBeGreaterThan(0);
    expect(resumed.context.reusedTokens).toBe(item.reusedTokens);
    const echoed = await echoedMessage(resumed.id);
    expect(echoed).toContain("Already sent earlier in this conversation, unchanged");
    expect(echoed).not.toContain("export const value59 = 59;");
  });

  it("keeps the prefix stable when files change and resends only what changed", async () => {
    await context.container.indexes.idle(project.id);
    const before = (await context.container.indexes.context(project.id))?.fileFacts(
      "src/cart.ts",
    )?.rawTokens;
    writeFileSync(
      join(context.projectRoot, "src/cart.ts"),
      `${PROJECT_FILES["src/cart.ts"] ?? ""}\nexport const added = true;\n${SOURCE.replaceAll("value", "extra")}\n`,
    );
    await waitFor(
      async () => {
        await api.post(`/api/projects/${project.id}/index`);
        await context.container.indexes.idle(project.id);
        return (await context.container.indexes.context(project.id))?.fileFacts("src/cart.ts")
          ?.rawTokens;
      },
      (tokens) => tokens !== undefined && tokens !== before,
      20_000,
    );
    const { run: resumed, item } = await run("Check the new export [stub:quick]");
    expect(resumed.cache.loss).toBe("NONE");
    expect(item.mapFrozen).toBe(true);
    expect(item.entries.find((entry) => entry.relPath === "src/cart.ts")?.reused).toBe(false);
    expect(item.entries.find((entry) => entry.relPath === "src/price.ts")?.reused).toBe(true);
    const row = await context.container.prisma.agentRun.findUniqueOrThrow({
      where: { id: resumed.id },
    });
    expect(row.ctxMapDrift).toBe(true);
  });

  it("starts over with the pack after Claude Code compacts the conversation", async () => {
    const { run: compacted } = await run("Long session [stub:compact]");
    const session = await context.container.prisma.session.findUniqueOrThrow({
      where: { id: compacted.sessionId },
    });
    expect(session.deliveredPack).toEqual({});
    const { item } = await run("After compaction [stub:quick]");
    expect(item.reusedTokens).toBe(0);
    expect(item.entries.every((entry) => !entry.reused)).toBe(true);
  });

  it("reports the measured cache and the estimated savings in Savings", async () => {
    const report = (await api.get<SavingsReport>("/api/telemetry/savings")).body;
    expect(report.cache.resumedRuns).toBeGreaterThanOrEqual(3);
    expect(report.cache.readTokens).toBeGreaterThan(0);
    const row = (source: string) => report.ledger.find((entry) => entry.source === source);
    expect(row("stable-prefix")?.evidence).toBe("ESTIMATED");
    expect(row("stable-prefix")?.runs ?? 0).toBeGreaterThanOrEqual(1);
    expect(row("stable-prefix")?.tokens ?? 0).toBeGreaterThan(10_000);
    expect(row("pack-reuse")?.runs ?? 0).toBeGreaterThanOrEqual(2);
    expect(row("pack-reuse")?.tokens ?? 0).toBeGreaterThan(0);
    expect(row("prompt-cache")).toMatchObject({ evidence: "MEASURED" });
    expect(row("context-pack")?.evidence).toBe("ESTIMATED");
  });
});
