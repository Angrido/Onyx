import type { ProjectDetailDto, TaskDetailDto, TaskDto } from "@onyx/contracts";
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

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

async function createTask(title: string): Promise<TaskDto> {
  return (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title,
      prompt: `${title} [stub:quick]`,
      kind: "CHORE",
    })
  ).body;
}

async function agentId(name: string): Promise<string> {
  const config = await context.container.prisma.agentConfig.findFirstOrThrow({ where: { name } });
  return config.id;
}

beforeAll(async () => {
  context = await createTestContext();
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "grants",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("commands allowed for a task, an agent or a while", () => {
  it("applies each grant only where it belongs and until it expires", async () => {
    const projects = context.container.projects;
    const task = await createTask("First");
    const other = await createTask("Second");
    const builder = await agentId("builder");
    const scout = await agentId("scout");
    const base = { projectId: project.id, taskId: task.id, actor: "user:test" };
    await projects.grant({
      ...base,
      rules: [{ rule: "Bash(make test *)", command: "make test" }],
      scope: "TASK",
      agentConfigId: builder,
      expiresAt: null,
    });
    await projects.grant({
      ...base,
      rules: [{ rule: "Bash(cargo test *)", command: "cargo test" }],
      scope: "AGENT",
      agentConfigId: builder,
      expiresAt: null,
    });
    await projects.grant({
      ...base,
      rules: [{ rule: "Bash(go test *)", command: "go test ./..." }],
      scope: "PROJECT",
      agentConfigId: builder,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await projects.grant({
      ...base,
      rules: [{ rule: "Bash(ruff check *)", command: "ruff check" }],
      scope: "PROJECT",
      agentConfigId: builder,
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(
      (await projects.grantedRules(project.id, { taskId: task.id, agentConfigId: builder })).sort(),
    ).toEqual(["Bash(cargo test *)", "Bash(go test *)", "Bash(make test *)"]);
    expect(
      await projects.grantedRules(project.id, { taskId: other.id, agentConfigId: scout }),
    ).toEqual(["Bash(go test *)"]);
    const detail = (await api.get<ProjectDetailDto>(`/api/projects/${project.id}`)).body;
    expect(detail.commandGrants.map((grant) => [grant.rule, grant.scope]).sort()).toEqual([
      ["Bash(cargo test *)", "AGENT"],
      ["Bash(go test *)", "PROJECT"],
      ["Bash(make test *)", "TASK"],
    ]);
    expect(detail.commandGrants.find((grant) => grant.scope === "AGENT")?.agentName).toBe(
      "builder",
    );
  });

  it("keeps project rules away from read-only agents", async () => {
    await api.put(`/api/projects/${project.id}/allowed-tools`, {
      allowedTools: ["Bash(python3 *)"],
    });
    const task = await createTask("Plan only");
    await api.post(`/api/tasks/${task.id}/run`, { agentConfigId: await agentId("planner") });
    const detail = await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
      20_000,
    );
    const run = await context.container.prisma.agentRun.findUniqueOrThrow({
      where: { id: detail.runs[0]?.id ?? "" },
    });
    expect(run.args as string[]).not.toContain("Bash(python3 *)");
    expect(run.args as string[]).not.toContain("Bash(go test *)");
  });

  it("refuses destructive commands in the hook whatever the rules say", async () => {
    const scope = await context.container.surgeon.runScope(
      project.id,
      project.workspaces[0]?.id ?? null,
    );
    const token = context.container.runTokens.issue("grant-probe", project.id, {
      workspaceId: project.workspaces[0]?.id ?? null,
      policy: scope.policy,
      guard: scope.guard,
      fence: null,
    });
    const hook = (command: string) =>
      context.app.inject({
        method: "POST",
        url: "/internal/hooks/pre-tool-use",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
          cwd: context.projectRoot,
        },
      });
    expect((await hook("rm -fr build")).json()).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "Onyx never lets agents run this: rm -rf deletes whole folders.",
      },
    });
    expect((await hook("git -C . push")).json()).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect((await hook("ls src")).json()).toEqual({});
    context.container.runTokens.revoke("grant-probe");
  });
});
