import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AllowedToolsResponse,
  ProjectDetailDto,
  ProjectStackDto,
  WorkspaceDto,
  WorkspaceProposalResponse,
} from "@onyx/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  type ApiClient,
  type TestContext,
} from "../helpers";

let context: TestContext;
let api: ApiClient;

beforeEach(async () => {
  context = await createTestContext();
  api = apiClient(context.app, await authenticate(context.app));
});

afterEach(async () => {
  await destroyTestContext(context);
});

describe("projects", () => {
  it("creates a project with the default domain workspaces", async () => {
    const created = await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
    });
    expect(created.status).toBe(201);
    expect(created.body.workspaces.map((workspace) => workspace.domain)).toEqual([
      "FRONTEND",
      "BACKEND",
      "DATABASE",
      "INFRA",
    ]);
    expect(created.body.workspaces.every((workspace) => workspace.agentConfigId !== null)).toBe(
      true,
    );

    const list = await api.get<{ items: Array<{ name: string; workspaceCount: number }> }>(
      "/api/projects",
    );
    expect(list.body.items).toEqual([expect.objectContaining({ name: "demo", workspaceCount: 4 })]);
  });

  it("proposes workspaces from the folder layout and registers the chosen ones", async () => {
    const root = join(context.projectsDir, "layout");
    for (const directory of ["src/components", "src/server", "prisma", ".github/workflows"])
      mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, "Dockerfile"), "FROM node:22\n");
    const proposal = await api.post<WorkspaceProposalResponse>("/api/projects/workspace-proposal", {
      rootPath: root,
    });
    expect(proposal.status).toBe(200);
    expect(
      proposal.body.workspaces.map((workspace) => [workspace.name, workspace.pathGlobs]),
    ).toEqual([
      ["Frontend", ["src/components/**"]],
      ["Backend", ["src/server/**"]],
      ["Database", ["prisma/**"]],
      ["Infra", [".github/**", "Dockerfile"]],
    ]);
    const outside = await api.post("/api/projects/workspace-proposal", { rootPath: "/etc" });
    expect(outside.status).toBe(400);

    const chosen = proposal.body.workspaces
      .filter((workspace) => workspace.domain !== "INFRA")
      .map(({ name, domain, pathGlobs }) => ({ name, domain, pathGlobs }));
    const created = await api.post<ProjectDetailDto>("/api/projects", {
      name: "layout",
      rootPath: root,
      workspaces: chosen,
    });
    expect(created.status).toBe(201);
    expect(
      created.body.workspaces.map((workspace) => [workspace.name, workspace.pathGlobs]),
    ).toEqual([
      ["Frontend", ["src/components/**"]],
      ["Backend", ["src/server/**"]],
      ["Database", ["prisma/**"]],
    ]);
    expect(created.body.workspaces.every((workspace) => workspace.agentConfigId !== null)).toBe(
      true,
    );

    const proposed = await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
      proposeWorkspaces: true,
    });
    expect(
      proposed.body.workspaces.map((workspace) => [workspace.name, workspace.pathGlobs]),
    ).toEqual([["Core", ["src/**"]]]);
  });

  it("suggests the commands of the project's stack and marks the allowed ones", async () => {
    writeFileSync(
      join(context.projectRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: "tsc", lint: "eslint ." } }),
    );
    writeFileSync(join(context.projectRoot, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const project = (
      await api.post<ProjectDetailDto>("/api/projects", {
        name: "demo",
        rootPath: context.projectRoot,
      })
    ).body;
    await api.put<AllowedToolsResponse>(`/api/projects/${project.id}/allowed-tools`, {
      allowedTools: ["Bash(pnpm run build *)"],
    });
    const stack = await api.get<ProjectStackDto>(`/api/projects/${project.id}/stack`);
    expect(stack.status).toBe(200);
    expect(stack.body).toMatchObject({
      stacks: ["node"],
      packageManager: "pnpm",
      continuationRuns: 0,
      windowDays: 30,
    });
    expect(
      stack.body.commands.map((command) => [command.command, command.risky, command.allowed]),
    ).toEqual([
      ["pnpm install", true, false],
      ["pnpm run build", false, true],
      ["pnpm run lint", false, false],
    ]);
  });

  it("rejects duplicate, missing and out-of-root paths", async () => {
    await api.post("/api/projects", { name: "demo", rootPath: context.projectRoot });
    const duplicate = await api.post("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
    });
    expect(duplicate.status).toBe(409);

    const missing = await api.post("/api/projects", {
      name: "missing",
      rootPath: join(context.projectsDir, "nope"),
    });
    expect(missing.status).toBe(400);

    const outside = mkdtempSync(join(tmpdir(), "onyx-outside-"));
    try {
      const response = await api.post("/api/projects", { name: "outside", rootPath: outside });
      expect(response.status).toBe(400);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("manages custom workspaces", async () => {
    const project = await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
      createDefaultWorkspaces: false,
    });
    const workspace = await api.post<WorkspaceDto>(`/api/projects/${project.body.id}/workspaces`, {
      name: "Docs",
      domain: "CUSTOM",
      pathGlobs: ["docs/**"],
    });
    expect(workspace.status).toBe(201);
    expect(workspace.body).toMatchObject({
      name: "Docs",
      writeFenceGlobs: ["docs/**"],
      resetStrategy: "HANDOFF",
      position: 0,
    });

    const updated = await api.patch<WorkspaceDto>(`/api/workspaces/${workspace.body.id}`, {
      primer: "Write concise docs.",
      resetStrategy: "HARD",
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ primer: "Write concise docs.", resetStrategy: "HARD" });

    const invalid = await api.patch(`/api/workspaces/${workspace.body.id}`, { pathGlobs: [] });
    expect(invalid.status).toBe(400);
  });
});
