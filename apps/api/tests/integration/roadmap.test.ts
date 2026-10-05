import type {
  IndexStatusDto,
  ProjectBoard,
  ProjectDetailDto,
  RoadmapGenerationDto,
  RoadmapItemDto,
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

const PROJECT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", type: "module", scripts: { test: "vitest" } }),
  "README.md": "# Shop\n\nA tiny shop.\n",
  "apps/web/src/button.tsx": "export function Button() {\n  return null;\n}\n",
  "apps/web/src/theme.css": ".button {\n  padding: 4px;\n}\n",
  "apps/api/src/login.ts":
    "export function login(user: string): boolean {\n  return user.length > 0;\n}\nexport const note = 'TODO: hash passwords';\n",
};

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

async function board(): Promise<ProjectBoard> {
  return (await api.get<ProjectBoard>(`/api/projects/${project.id}/board`)).body;
}

async function generate(language: "en" | "it"): Promise<RoadmapGenerationDto> {
  const started = await api.post<RoadmapGenerationDto>(`/api/projects/${project.id}/roadmap`, {
    language,
  });
  expect(started.status).toBe(202);
  expect(started.body.status).toBe("RUNNING");
  await context.container.roadmap.settled(started.body.id);
  const current = (await board()).generation;
  if (!current) throw new Error("generation missing");
  return current;
}

beforeAll(async () => {
  context = await createTestContext({ projectFiles: PROJECT_FILES });
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
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
});

describe("roadmap", () => {
  it("starts with an empty board", async () => {
    expect(await board()).toMatchObject({
      generation: null,
      suggestions: [],
      accepted: [],
      tasks: [],
    });
  });

  it("studies the project and suggests tasks in the chosen language", async () => {
    const generation = await generate("it");
    expect(generation).toMatchObject({
      status: "COMPLETED",
      modelId: "claude-sonnet-5-5",
      language: "it",
      itemCount: 4,
      error: null,
    });
    expect(generation.summary).toContain("mancano test");
    const { suggestions } = await board();
    expect(suggestions.map((item) => [item.kind, item.priority, item.effort])).toEqual([
      ["TEST_FIX", "HIGH", "M"],
      ["BUGFIX", "MEDIUM", "S"],
      ["UI_STYLE", "MEDIUM", "S"],
      ["DOCS", "LOW", "S"],
    ]);
    expect(suggestions[1]?.title).toBe("Risolvere: hash passwords';");
    expect(suggestions[0]?.workspaceName).toBe("Frontend");
    const logs = await context.container.prisma.tokenLog.findMany({
      where: { purpose: "roadmap" },
    });
    expect(logs).toHaveLength(1);
  });

  it("turns accepted suggestions into tasks and hides dismissed ones", async () => {
    const { suggestions } = await board();
    const [tests, todo, styles, docs] = suggestions as [
      RoadmapItemDto,
      RoadmapItemDto,
      RoadmapItemDto,
      RoadmapItemDto,
    ];
    const accepted = await api.post<TaskDto>(`/api/roadmap-items/${tests.id}/accept`, {});
    expect(accepted.status).toBe(201);
    const frontend = project.workspaces.find((workspace) => workspace.name === "Frontend");
    expect(accepted.body).toMatchObject({
      title: tests.title,
      kind: "TEST_FIX",
      status: "DRAFT",
      priority: 10,
      workspaceId: frontend?.id,
    });
    expect(accepted.body.prompt).toContain("Aggiungere test unitari");

    const fallback = await api.post<TaskDto>(`/api/roadmap-items/${docs.id}/accept`, {});
    expect(fallback.body.workspaceId).toBe(project.workspaces[0]?.id);
    expect((await api.post(`/api/roadmap-items/${docs.id}/accept`, {})).status).toBe(409);
    expect((await api.post(`/api/roadmap-items/${styles.id}/dismiss`)).status).toBe(200);

    const current = await board();
    expect(current.suggestions.map((item) => item.id)).toEqual([todo.id]);
    expect(current.accepted.map((item) => item.taskId).sort()).toEqual(
      [accepted.body.id, fallback.body.id].sort(),
    );
    expect(current.tasks.map((task) => task.id).sort()).toEqual(
      [accepted.body.id, fallback.body.id].sort(),
    );
  });

  it("regenerates without repeating accepted or dismissed work", async () => {
    const generation = await generate("en");
    expect(generation.status).toBe("COMPLETED");
    const titles = (await board()).suggestions.map((item) => item.title);
    expect(titles).toContain("Resolve: hash passwords';");
    expect(titles).not.toContain("Risolvere: hash passwords';");
    expect(titles.length).toBe(generation.itemCount);
  });
});
