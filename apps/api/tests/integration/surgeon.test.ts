import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CompiledPolicyDto,
  ExportResponse,
  IndexStatusDto,
  MeasureResponse,
  ProjectDetailDto,
  RunDto,
  RunEventsResponse,
  RunItem,
  SuggestResponse,
  SurgeonStateDto,
  TaskDetailDto,
  TaskDto,
  TokenCalibration,
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

const bigJson = JSON.stringify(
  Array.from({ length: 6_000 }, (_, index) => ({
    id: index,
    name: `item-${index}`,
    tags: ["a", "b"],
  })),
);

const PROJECT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", type: "module" }),
  "src/app.ts": 'import { helper } from "./util";\nexport const app = helper(1);\n',
  "src/util.ts": "export function helper(value: number): number {\n  return value * 2;\n}\n",
  "dist/bundle.js": `console.log(${JSON.stringify("x".repeat(2_000))});\n`,
  "dist/keep.js": "export const keep = true;\n",
  "logs/app.log": "INFO started\nERROR boom\n".repeat(50),
  "fixtures/big.json": bigJson,
  ".env": "API_TOKEN=not-a-real-token\n",
};

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

function workspaceId(name: string): string {
  const workspace = project.workspaces.find((candidate) => candidate.name === name);
  if (!workspace) throw new Error(`Workspace ${name} missing`);
  return workspace.id;
}

async function waitIndexed(): Promise<IndexStatusDto> {
  return waitFor(
    async () => (await api.get<IndexStatusDto>(`/api/projects/${project.id}/index`)).body,
    (status) => status.state === "ready",
    30_000,
  );
}

async function runTask(
  prompt: string,
  extra: object = {},
): Promise<{ run: RunDto; items: RunItem[] }> {
  const created = await api.post<TaskDto>("/api/tasks", {
    projectId: project.id,
    workspaceId: workspaceId("Backend"),
    title: prompt.slice(0, 40),
    prompt,
    ...extra,
  });
  expect(created.status).toBe(201);
  await api.post(`/api/tasks/${created.body.id}/run`);
  const task = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${created.body.id}`)).body,
    (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
    30_000,
  );
  await context.container.scheduler.settledTask(task.id);
  const run = (await api.get<RunDto>(`/api/runs/${task.runs[0]?.id}`)).body;
  const events = (await api.get<RunEventsResponse>(`/api/runs/${run.id}/events`)).body;
  return { run, items: events.items.flatMap((event) => event.items) };
}

beforeAll(async () => {
  context = await createTestContext({ projectFiles: PROJECT_FILES });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
    })
  ).body;
  await waitIndexed();
}, 120_000);

afterAll(async () => {
  if (context) await destroyTestContext(context);
});

describe("context profile", () => {
  it("starts from the aggressive preset with locked security rules", async () => {
    const state = (await api.get<SurgeonStateDto>(`/api/projects/${project.id}/surgeon`)).body;
    expect(state.base.version).toBe(1);
    expect(state.base.rules.map((rule) => rule.pattern)).toContain("dist/");
    expect(state.securityRules.every((rule) => rule.locked && rule.source === "SECURITY")).toBe(
      true,
    );
    expect(state.files.map((file) => file.path)).toContain("fixtures/big.json");
    expect(state.pricing?.inputUsdPerMTok).toBeGreaterThan(0);
  });

  it("suggests heuristic rules from the index", async () => {
    const suggestions = (
      await api.post<SuggestResponse>(`/api/projects/${project.id}/surgeon/suggest`)
    ).body;
    const big = suggestions.items.find((item) => item.rule.pattern === "/fixtures/big.json");
    expect(big).toMatchObject({ files: 1 });
    expect(big?.tokens).toBeGreaterThan(10_000);
  });

  it("saves rules, versions the profile and materialises negations", async () => {
    const state = (await api.get<SurgeonStateDto>(`/api/projects/${project.id}/surgeon`)).body;
    const saved = await api.put<SurgeonStateDto>(`/api/projects/${project.id}/surgeon`, {
      rules: [
        ...state.base.rules.map((rule) =>
          rule.pattern === "dist/" ? { ...rule, pattern: "**/dist/**" } : rule,
        ),
        { pattern: "/fixtures/big.json", source: "HEURISTIC", reason: "Large data file" },
        { pattern: "dist/keep.js", action: "INCLUDE" },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.base.version).toBe(2);
    expect(saved.body.base.compiledHash).toMatch(/^[0-9a-f]{16}$/);

    const compiled = (
      await api.get<CompiledPolicyDto>(`/api/projects/${project.id}/surgeon/compiled`)
    ).body;
    expect(compiled.mode).toBe("materialized");
    const root = context.projectRoot.replace(/^\//, "");
    expect(compiled.readDeny).toContain(`Read(//${root}/dist/bundle.js)`);
    expect(compiled.readDeny.some((entry) => entry.includes("keep.js"))).toBe(false);
    expect(compiled.readDeny).toContain(`Read(//${root}/fixtures/**)`);
    expect(compiled.claudesignore).toContain("!dist/keep.js\n");
    expect(compiled.excludedFiles).toBe(3);

    const audits = await context.container.prisma.auditLog.findMany({
      where: { action: "surgeon.save" },
    });
    expect(audits).toHaveLength(1);
  });

  it("applies workspace overlays on top of the project profile", async () => {
    const frontend = workspaceId("Frontend");
    const saved = await api.put<SurgeonStateDto>(`/api/projects/${project.id}/surgeon`, {
      workspaceId: frontend,
      rules: [{ pattern: "src/util.ts" }],
    });
    expect(saved.body.overlay?.rules.map((rule) => rule.pattern)).toEqual(["src/util.ts"]);
    const scoped = (
      await api.get<CompiledPolicyDto>(
        `/api/projects/${project.id}/surgeon/compiled?workspaceId=${frontend}`,
      )
    ).body;
    const base = (await api.get<CompiledPolicyDto>(`/api/projects/${project.id}/surgeon/compiled`))
      .body;
    expect(scoped.readDeny.some((entry) => entry.includes("src/util.ts"))).toBe(true);
    expect(base.readDeny.some((entry) => entry.includes("src/util.ts"))).toBe(false);
  });

  it("measures the estimate against a reference tokenizer and calibrates it within 15%", async () => {
    const before = (await api.post<MeasureResponse>(`/api/projects/${project.id}/surgeon/measure`))
      .body;
    expect(before).toMatchObject({ reference: "o200k_base", calibrated: false });
    expect(before.measuredTokens).toBeGreaterThan(0);

    const calibration = await api.post<TokenCalibration>(
      `/api/projects/${project.id}/surgeon/calibrate`,
    );
    expect(calibration.status).toBe(200);
    expect(calibration.body.ratios["*"]).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitIndexed();

    const after = (await api.post<MeasureResponse>(`/api/projects/${project.id}/surgeon/measure`))
      .body;
    expect(after.calibrated).toBe(true);
    expect(Math.abs(after.error)).toBeLessThan(0.15);
  });

  it("exports the profile as .claudesignore", async () => {
    const exported = (await api.post<ExportResponse>(`/api/projects/${project.id}/surgeon/export`))
      .body;
    const text = readFileSync(exported.path, "utf8");
    expect(text).toContain("node_modules/\n");
    expect(text).toContain("!dist/keep.js\n");
  });
});

describe("runs under a context profile", () => {
  it("blocks reads of excluded files through the PreToolUse hook and records them", async () => {
    const { run, items } = await runTask(
      "[stub:guard] read:dist/bundle.js read:src/app.ts grep:dist grep:logs bash:{cat logs/app.log} bash:{head -n 1 .env} read:dist/keep.js",
    );
    expect(run.status).toBe("COMPLETED");
    const guards = items.flatMap((item) => (item.kind === "guard" ? [item] : []));
    const hooked = guards.filter((item) => item.source === "hook");
    expect(hooked.map((item) => item.target)).toEqual([
      "dist/bundle.js",
      "dist",
      "logs",
      "logs/app.log",
      ".env",
    ]);
    const reported = guards.filter((item) => item.source === "permission");
    expect(reported.map((item) => item.toolUseId)).toEqual(hooked.map((item) => item.toolUseId));
    expect(run.guardDenials).toBe(5);

    const results = items.filter((item) => item.kind === "tool_result");
    expect(results).toHaveLength(7);
    expect(results.filter((item) => item.kind === "tool_result" && item.isError)).toHaveLength(5);
    expect(
      results.some(
        (item) => item.kind === "tool_result" && item.content.includes("export const app"),
      ),
    ).toBe(true);
    expect(
      results.some((item) => item.kind === "tool_result" && item.content.includes("keep = true")),
    ).toBe(true);

    const stored = await context.container.prisma.agentRun.findUnique({ where: { id: run.id } });
    expect(stored?.ignoreHash).toMatch(/^[0-9a-f]{16}$/);
    const settings = JSON.parse(
      readFileSync(join(context.dataDir, "runtime", run.id, "settings.json"), "utf8"),
    ) as {
      permissions: { deny: string[] };
      hooks: {
        PreToolUse: {
          matcher: string;
          hooks: { headers: Record<string, string>; allowedEnvVars: string[] }[];
        }[];
      };
    };
    expect(settings.permissions.deny.some((rule) => rule.endsWith("/dist/bundle.js)"))).toBe(true);
    expect(settings.hooks.PreToolUse[0]?.matcher).toContain("Bash");
    expect(settings.hooks.PreToolUse[0]?.hooks[0]?.headers["Authorization"]).toBe(
      "Bearer $ONYX_RUN_TOKEN",
    );
    expect(settings.hooks.PreToolUse[0]?.hooks[0]?.allowedEnvVars).toEqual(["ONYX_RUN_TOKEN"]);

    const audits = await context.container.prisma.auditLog.count({
      where: { action: "guard.denied" },
    });
    expect(audits).toBe(5);
  }, 60_000);

  it("keeps excluded files out of the context pack", async () => {
    const { items } = await runTask("[stub:quick] Explain the bundle.", {
      targetPaths: ["dist/bundle.js", "src/app.ts"],
    });
    const contextItem = items.find((item) => item.kind === "context");
    expect(contextItem).toMatchObject({ note: "Excluded by the context profile: dist/bundle.js" });
    const paths =
      contextItem?.kind === "context" ? contextItem.entries.map((entry) => entry.relPath) : [];
    expect(paths).toContain("src/app.ts");
    expect(paths.some((path) => path.startsWith("dist/") && path !== "dist/keep.js")).toBe(false);
  }, 60_000);

  it("refuses MCP reads of excluded files", async () => {
    const scope = await context.container.surgeon.runScope(project.id, workspaceId("Backend"));
    const token = context.container.runTokens.issue("probe-run", project.id, {
      workspaceId: workspaceId("Backend"),
      policy: scope.policy,
      guard: scope.guard,
      fence: null,
    });
    const response = await context.app.inject({
      method: "POST",
      url: "/internal/mcp/file_skeleton",
      headers: { authorization: `Bearer ${token}` },
      payload: { path: "fixtures/big.json", level: 1 },
    });
    expect(response.json()).toMatchObject({ isError: true });
    const hook = await context.app.inject({
      method: "POST",
      url: "/internal/hooks/pre-tool-use",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "src/app.ts" },
        cwd: context.projectRoot,
      },
    });
    expect(hook.json()).toEqual({});
    context.container.runTokens.revoke("probe-run");
  });
});
