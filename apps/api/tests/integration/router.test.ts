import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  IndexStatusDto,
  ProjectDetailDto,
  ResetWorkspaceResponse,
  RouterPreviewResponse,
  RouterSettingsDto,
  RoutingDecisionListResponse,
  RoutingRuleDto,
  RoutingTelemetry,
  RunDto,
  RunEventsResponse,
  RunItem,
  SessionListResponse,
  TaskDetailDto,
  TaskDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskClassifier } from "../../src/infrastructure/aux-model";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

const PROJECT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", type: "module" }),
  "apps/web/src/button.tsx": "export function Button() {\n  return null;\n}\n",
  "apps/web/src/form.tsx":
    'import { Button } from "./button";\nexport function Form() {\n  return Button();\n}\n',
  "apps/web/src/theme.css": ".button {\n  padding: 4px;\n}\n",
  "apps/api/src/login.ts":
    "export function login(user: string): boolean {\n  return user.length > 0;\n}\n",
  "packages/db/prisma/schema.prisma": "model User {\n  id String @id\n}\n",
  "README.md": "# Shop\n",
};

const classifierCalls: string[] = [];
const fakeClassifier: TaskClassifier = {
  modelId: "claude-haiku-4-5",
  classify: (input) => {
    classifierCalls.push(input.title);
    return Promise.resolve({
      tier: "ARCHITECT",
      rationale: "Touches two domains at once.",
      usage: {
        modelId: "claude-haiku-4-5",
        usage: { inputTokens: 300, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0 },
      },
    });
  },
};

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

function workspaceId(name: string): string {
  const workspace = project.workspaces.find((candidate) => candidate.name === name);
  if (!workspace) throw new Error(`Workspace ${name} missing`);
  return workspace.id;
}

interface RunOutcome {
  task: TaskDetailDto;
  run: RunDto;
  items: RunItem[];
}

async function runTask(
  workspace: string | null,
  prompt: string,
  extra: Record<string, unknown> = {},
): Promise<RunOutcome> {
  const created = await api.post<TaskDto>("/api/tasks", {
    projectId: project.id,
    workspaceId: workspace === null ? null : workspaceId(workspace),
    title: prompt.replace(/\[stub:[a-z-]+\]\s*/, "").slice(0, 60),
    prompt,
    ...extra,
  });
  expect(created.status).toBe(201);
  const started = await api.post(`/api/tasks/${created.body.id}/run`);
  expect(started.status).toBe(202);
  return settle(created.body.id);
}

async function settle(taskId: string): Promise<RunOutcome> {
  const task = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${taskId}`)).body,
    (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
    30_000,
  );
  await context.container.scheduler.idle();
  const detail = (await api.get<TaskDetailDto>(`/api/tasks/${taskId}`)).body;
  const latest = detail.runs[0];
  if (!latest) throw new Error("Task has no run");
  const run = (await api.get<RunDto>(`/api/runs/${latest.id}`)).body;
  const events = (await api.get<RunEventsResponse>(`/api/runs/${run.id}/events`)).body;
  return {
    task: { ...detail, status: task.status },
    run,
    items: events.items.flatMap((event) => event.items),
  };
}

function itemOf<K extends RunItem["kind"]>(
  items: RunItem[],
  kind: K,
): Extract<RunItem, { kind: K }> {
  const item = items.find((candidate) => candidate.kind === kind);
  if (!item) throw new Error(`No ${kind} item`);
  return item as Extract<RunItem, { kind: K }>;
}

async function sessionsOf(name: string) {
  return (await api.get<SessionListResponse>(`/api/workspaces/${workspaceId(name)}/sessions`)).body
    .items;
}

beforeAll(async () => {
  context = await createTestContext({ projectFiles: PROJECT_FILES, classifier: fakeClassifier });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await waitFor(
    async () => (await api.get<IndexStatusDto>(`/api/projects/${project.id}/index`)).body,
    (status) => status.state === "ready",
    30_000,
  );
}, 120_000);

afterAll(async () => {
  await destroyTestContext(context);
});

describe("model routing", () => {
  it("sends UI work to Sonnet and architecture to Opus with a recorded rationale", async () => {
    const ui = await runTask("Frontend", "[stub:quick] Tighten the button padding", {
      kind: "UI_STYLE",
      targetPaths: ["apps/web/src/theme.css"],
    });
    expect(ui.run.modelId).toBe("claude-sonnet-5-5");
    expect(ui.run.routing).toEqual({
      strategy: "RULE",
      tier: "BUILDER",
      rationale: "Rule ui-styling matched (kind UI_STYLE)",
    });
    expect(itemOf(ui.items, "routing")).toMatchObject({
      ruleName: "ui-styling",
      modelId: "claude-sonnet-5-5",
    });

    const architecture = await runTask(
      "Backend",
      "[stub:quick] Split authentication into a service",
      {
        kind: "ARCHITECTURE",
        targetPaths: ["apps/api/src/login.ts"],
      },
    );
    expect(architecture.run.modelId).toBe("claude-opus-5-5");
    expect(architecture.run.routing?.strategy).toBe("RULE");
    expect(architecture.run.routing?.rationale).toContain("architecture-work");

    const decisions = (
      await api.get<RoutingDecisionListResponse>(`/api/routing-decisions?projectId=${project.id}`)
    ).body.items;
    const recorded = decisions.find((decision) => decision.taskId === architecture.task.id);
    expect(recorded).toMatchObject({ tier: "ARCHITECT", ruleName: "architecture-work" });
    expect(recorded?.features).toMatchObject({
      kind: "ARCHITECTURE",
      workspaceDomain: "BACKEND",
      targets: ["apps/api/src/login.ts"],
    });
  }, 60_000);

  it("previews decisions, infers the workspace and asks the classifier near a boundary", async () => {
    const preview = await api.post<RouterPreviewResponse>("/api/router/preview", {
      projectId: project.id,
      prompt: "Rename the login helper",
      kind: "REFACTOR",
      targetPaths: ["apps/api/src/login.ts"],
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      workspaceName: "Backend",
      workspaceInferred: true,
      classifierUsed: false,
      decision: { strategy: "HEURISTIC", tier: "BUILDER", modelId: "claude-sonnet-5-5" },
    });

    const settings = await api.put<RouterSettingsDto>("/api/router/settings", {
      weights: {
        blastRadius: 0,
        crossDomain: 0.55,
        filesTouched: 0,
        archKeywords: 0,
        contextTokens: 0,
        priorFailures: 0,
      },
    });
    expect(settings.body).toMatchObject({
      classifierAvailable: true,
      tierModels: { ARCHITECT: "claude-opus-5-5" },
    });
    const borderline = await api.post<RouterPreviewResponse>("/api/router/preview", {
      projectId: project.id,
      workspaceId: workspaceId("Frontend"),
      title: "Login form",
      prompt: "Wire the form to the login endpoint",
      targetPaths: ["apps/web/src/form.tsx", "apps/api/src/login.ts"],
    });
    expect(borderline.body.classifierUsed).toBe(true);
    expect(borderline.body.decision).toMatchObject({ strategy: "CLASSIFIER", tier: "ARCHITECT" });
    expect(borderline.body.decision.rationale).toContain("Touches two domains at once.");
    expect(classifierCalls).toEqual(["Login form"]);
    const aux = await context.container.prisma.tokenLog.findFirst({ where: { scope: "AUX" } });
    expect(aux).toMatchObject({
      purpose: "router.preview",
      modelId: "claude-haiku-4-5",
      inputTokens: 300,
    });

    const invalid = await api.put("/api/router/settings", {
      thresholds: { architect: 0.3, builder: 0.4 },
    });
    expect(invalid.status).toBe(400);
    await api.put("/api/router/settings", {
      weights: {
        blastRadius: 0.3,
        crossDomain: 0.2,
        filesTouched: 0.15,
        archKeywords: 0.15,
        contextTokens: 0.1,
        priorFailures: 0.1,
      },
    });
  });

  it("applies project rules ahead of global ones", async () => {
    const created = await api.post<RoutingRuleDto>("/api/routing-rules", {
      projectId: project.id,
      name: "readme-is-cheap",
      priority: 5,
      matcher: { pathGlobs: ["README.md"] },
      targetTier: "SCOUT",
    });
    expect(created.status).toBe(201);
    const preview = await api.post<RouterPreviewResponse>("/api/router/preview", {
      projectId: project.id,
      workspaceId: workspaceId("Frontend"),
      prompt: "Fix the README title",
      kind: "DOCS",
      targetPaths: ["README.md"],
    });
    expect(preview.body.decision).toMatchObject({
      strategy: "RULE",
      ruleName: "readme-is-cheap",
      tier: "SCOUT",
    });
    const removed = await api.delete(`/api/routing-rules/${created.body.id}`);
    expect(removed.status).toBe(204);
  });

  it("escalates once after a turn-limit failure and stops at the architect tier", async () => {
    const outcome = await runTask(
      "Frontend",
      "[stub:error-max-turns] Add a tooltip to the button",
      {
        targetPaths: ["apps/web/src/button.tsx"],
      },
    );
    expect(outcome.task.status).toBe("FAILED");
    const runs = [...outcome.task.runs].reverse();
    expect(runs.map((run) => run.modelId)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(runs.map((run) => run.routing?.strategy)).toEqual(["HEURISTIC", "ESCALATION"]);
    expect(runs[1]?.routing?.rationale).toContain("Escalated from BUILDER to ARCHITECT");
  }, 60_000);
});

describe("session compartments", () => {
  it("gives Frontend → Backend → Frontend three sessions linked by handoff notes", async () => {
    await api.post(`/api/workspaces/${workspaceId("Frontend")}/reset`, { handoff: false });
    await api.post(`/api/workspaces/${workspaceId("Backend")}/reset`, { handoff: false });
    const frontendBefore = (await sessionsOf("Frontend")).length;

    const first = await runTask(
      "Frontend",
      "[stub:guard] edit:apps/web/src/button.tsx note:{TODO: call the login endpoint}",
    );
    const backend = await runTask("Backend", "[stub:guard] edit:apps/api/src/login.ts");
    const second = await runTask("Frontend", "[stub:guard] edit:apps/web/src/form.tsx");

    expect(first.run.changedFiles).toEqual(["apps/web/src/button.tsx"]);
    expect(backend.run.changedFiles).toEqual(["apps/api/src/login.ts"]);
    const ids = new Set([first.run.sessionId, backend.run.sessionId, second.run.sessionId]);
    expect(ids.size).toBe(3);

    const backendSession = itemOf(backend.items, "session");
    expect(backendSession).toMatchObject({ action: "started", workspaceName: "Backend" });
    expect(backendSession.handoff?.text).toContain("## Meanwhile in other workspaces");
    expect(backendSession.handoff?.text).toContain("apps/web/src/button.tsx");

    const frontendSession = itemOf(second.items, "session");
    expect(frontendSession).toMatchObject({
      action: "started",
      reason: "DOMAIN_SWITCH",
      previousSessionId: first.run.sessionId,
    });
    const note = frontendSession.handoff?.text ?? "";
    expect(note).toContain("after a domain switch");
    expect(note).toContain('## Earlier in Frontend\n- "edit:apps/web/src/button.tsx');
    expect(note).toContain("Backend · ");
    expect(note).toContain("changed apps/api/src/login.ts");
    expect(note).toContain("## Open items\n- call the login endpoint");
    expect(frontendSession.handoff?.tokens).toBeLessThanOrEqual(1_500);

    const frontendSessions = await sessionsOf("Frontend");
    expect(frontendSessions.length).toBe(frontendBefore + 2);
    const rotated = frontendSessions.find((session) => session.id === first.run.sessionId);
    expect(rotated).toMatchObject({ status: "ROTATED", endReason: "DOMAIN_SWITCH", runs: 1 });
    const current = frontendSessions.find((session) => session.id === second.run.sessionId);
    expect(current?.handoffNote).toBe(note);

    const again = await runTask("Frontend", "[stub:guard] edit:apps/web/src/form.tsx");
    expect(itemOf(again.items, "session")).toMatchObject({ action: "resumed", handoff: null });
    expect(again.run.sessionId).toBe(second.run.sessionId);
  }, 90_000);

  it("fences edits into another workspace's files", async () => {
    const outcome = await runTask(
      "Frontend",
      "[stub:guard] edit:apps/api/src/login.ts edit:apps/web/src/button.tsx write:packages/shared/util.ts bash:{echo x > apps/api/src/hack.ts}",
    );
    const guards = outcome.items.flatMap((item) =>
      item.kind === "guard" && item.source === "hook" ? [item] : [],
    );
    expect(guards.map((item) => [item.target, item.rule])).toEqual([
      ["apps/api/src/login.ts", "write fence (Frontend)"],
      ["apps/api/src/hack.ts", "write fence (Frontend)"],
    ]);
    expect(guards[0]?.reason).toContain("belongs to the Backend workspace");
    expect(outcome.run.changedFiles).toEqual([
      "apps/web/src/button.tsx",
      "packages/shared/util.ts",
    ]);
    const settings = JSON.parse(
      readFileSync(join(context.dataDir, "runtime", outcome.run.id, "settings.json"), "utf8"),
    ) as { permissions: { deny: string[] }; hooks: { PreToolUse: { matcher: string }[] } };
    const root = context.projectRoot.replace(/^\/+/, "");
    expect(settings.permissions.deny).toContain(`Edit(//${root}/apps/api/**)`);
    expect(settings.permissions.deny).toContain(`Edit(//${root}/packages/db/**)`);
    expect(settings.permissions.deny.some((rule) => rule.includes("apps/web"))).toBe(false);
    expect(settings.hooks.PreToolUse[0]?.matcher).toContain("Edit|Write");
    const audits = await context.container.prisma.auditLog.count({
      where: { action: "fence.denied" },
    });
    expect(audits).toBe(2);
  }, 60_000);

  it("prepares a session with a handoff note on a manual reset", async () => {
    const reset = await api.post<ResetWorkspaceResponse>(
      `/api/workspaces/${workspaceId("Frontend")}/reset`,
      { handoff: true },
    );
    expect(reset.status).toBe(200);
    const pending = reset.body.session;
    expect(pending).toMatchObject({ status: "IDLE", runs: 0 });
    expect(pending?.handoffNote).toContain("after a manual reset");
    expect(reset.body.workspace.activeSessionId).toBe(pending?.id);

    const next = await runTask("Frontend", "[stub:quick] Polish the form", { kind: "UI_STYLE" });
    expect(next.run.sessionId).toBe(pending?.id);
    expect(itemOf(next.items, "session")).toMatchObject({ action: "started" });
    expect(itemOf(next.items, "session").handoff?.text).toBe(pending?.handoffNote);
  }, 60_000);

  it("routes a task without a workspace to the one that owns its targets", async () => {
    const created = await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      title: "Validate the user name",
      prompt: "Reject blank user names",
      targetPaths: ["apps/api/src/login.ts"],
    });
    expect(created.status).toBe(201);
    expect(created.body.workspaceId).toBe(workspaceId("Backend"));
    const orphan = await api.post("/api/tasks", {
      projectId: project.id,
      title: "Somewhere",
      prompt: "Do something vague",
      targetPaths: ["nowhere/file.txt"],
    });
    expect(orphan.status).toBe(400);
  });
});

describe("routing telemetry", () => {
  it("compares the cost per completed task with an all-Opus counterfactual", async () => {
    const telemetry = (
      await api.get<RoutingTelemetry>(`/api/telemetry/routing?projectId=${project.id}`)
    ).body;
    expect(telemetry.referenceModelId).toBe("claude-opus-5-5");
    expect(telemetry.completedTasks).toBeGreaterThanOrEqual(6);
    expect(telemetry.costPerCompletedTask).not.toBeNull();
    expect(telemetry.counterfactualUsd).toBeGreaterThan(0);
    const tiers = telemetry.byTier.map((entry) => entry.tier);
    expect(tiers).toContain("BUILDER");
    expect(tiers).toContain("ARCHITECT");
    expect(telemetry.byStrategy.map((entry) => entry.strategy)).toEqual(
      expect.arrayContaining(["RULE", "HEURISTIC", "ESCALATION"]),
    );
    const logged = await context.container.prisma.tokenLog.findFirst({
      where: { scope: "RUN_TOTAL", counterfactualUsd: { not: null } },
    });
    expect(logged?.counterfactualUsd).toBeGreaterThan(0);
  });
});
