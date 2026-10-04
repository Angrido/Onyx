import type { ProjectDetailDto, SearchResponse, TaskDetailDto, TaskDto } from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSearchIndex, ftsQuery } from "../../src/infrastructure/search-index";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

async function search(q: string, projectId?: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, ...(projectId ? { projectId } : {}) });
  return (await api.get<SearchResponse>(`/api/search?${params.toString()}`)).body;
}

beforeAll(async () => {
  context = await createTestContext({
    projectFiles: { "apps/web/checkout-button.tsx": "export const CheckoutButton = 1;\n" },
  });
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("search query", () => {
  it("turns any text into safe prefix terms", () => {
    expect(ftsQuery("login form")).toBe('"login"* "form"*');
    expect(ftsQuery('apps/web/"x" OR NEAR(')).toBe('"apps"* "web"* "x"* "OR"* "NEAR"*');
    expect(ftsQuery("  ** ")).toBeNull();
  });
});

describe("global search", () => {
  it("finds tasks, runs and files of every project", async () => {
    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: project.workspaces[0]?.id,
        title: "Checkout coupons",
        prompt: "Let customers apply a coupon at the caffè counter",
      })
    ).body;
    await api.post(`/api/tasks/${task.id}/run`, {});
    await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
      (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
      20_000,
    );
    await context.container.scheduler.idle();

    const coupons = await search("coupon");
    const kinds = coupons.items.map((item) => item.kind);
    expect(kinds).toContain("TASK");
    expect(kinds).toContain("RUN");
    const hit = coupons.items.find((item) => item.kind === "TASK");
    expect(hit).toMatchObject({
      id: task.id,
      projectName: "shop",
      title: "Checkout coupons",
      href: `/tasks/${task.id}`,
    });
    expect(hit?.snippet).toContain("\u0001coupon\u0002");

    expect((await search("caffe")).items.map((item) => item.id)).toContain(task.id);

    const files = await search("checkout butt");
    const file = files.items.find((item) => item.kind === "FILE");
    expect(file).toMatchObject({
      title: "apps/web/checkout-button.tsx",
      href: `/projects/${project.id}/graph?focus=apps%2Fweb%2Fcheckout-button.tsx`,
    });

    expect((await search("coupon", "another-project")).items).toEqual([]);
    expect((await api.get("/api/search?q=")).status).toBe(400);
    expect((await search('" OR NEAR( *')).items).toEqual([]);

    await context.container.prisma.task.update({
      where: { id: task.id },
      data: { title: "Gift cards" },
    });
    expect((await search("gift")).items.map((item) => item.id)).toContain(task.id);
    await context.container.prisma.task.delete({ where: { id: task.id } });
    expect((await search("coupon")).items).toEqual([]);
  });

  it("is built once and rebuilt when its version changes", async () => {
    const { prisma } = context.container;
    expect(await ensureSearchIndex(prisma)).toBe(false);
    await prisma.appSetting.update({ where: { key: "search.version" }, data: { value: 0 } });
    expect(await ensureSearchIndex(prisma)).toBe(true);
    expect((await search("checkout")).items.some((item) => item.kind === "FILE")).toBe(true);
  });
});
