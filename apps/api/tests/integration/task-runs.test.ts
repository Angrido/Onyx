import type {
  AllowedToolsResponse,
  BlockedCommandsResponse,
  ProjectDetailDto,
  RunDto,
  RunEventsResponse,
  RunItem,
  RunTaskResponse,
  SessionDto,
  TaskDetailDto,
  TaskDto,
  TelemetrySummary,
} from "@onyx/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function workspaceId(name: string): string {
  const workspace = project.workspaces.find((candidate) => candidate.name === name);
  if (!workspace) throw new Error(`Workspace ${name} missing`);
  return workspace.id;
}

async function createTask(
  prompt: string,
  workspace = "Frontend",
  extra: object = {},
): Promise<TaskDto> {
  const response = await api.post<TaskDto>("/api/tasks", {
    projectId: project.id,
    workspaceId: workspaceId(workspace),
    title: prompt.slice(0, 40),
    prompt,
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function runTask(taskId: string, body: object = {}): Promise<RunTaskResponse> {
  const response = await api.post<RunTaskResponse>(`/api/tasks/${taskId}/run`, body);
  expect(response.status).toBe(202);
  return response.body;
}

async function waitForTask(taskId: string, statuses: string[]): Promise<TaskDetailDto> {
  await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${taskId}`)).body,
    (task) => statuses.includes(task.status),
    25_000,
  );
  await context.container.scheduler.settledTask(taskId);
  return (await api.get<TaskDetailDto>(`/api/tasks/${taskId}`)).body;
}

async function eventItems(runId: string): Promise<RunItem[]> {
  const events = await api.get<RunEventsResponse>(`/api/runs/${runId}/events`);
  return events.body.items.flatMap((event) => event.items);
}

beforeEach(async () => {
  context = await createTestContext();
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterEach(async () => {
  await destroyTestContext(context);
});

describe("task execution", () => {
  it("runs a task end to end and records events, usage and cost", async () => {
    const task = await createTask("Fix the add function");
    const queued = await runTask(task.id);
    expect(queued.task.status).toBe("QUEUED");

    const done = await waitForTask(task.id, ["COMPLETED", "FAILED"]);
    expect(done.status).toBe("COMPLETED");
    expect(done.runs).toHaveLength(1);
    const run = done.runs[0] as RunDto;
    expect(run).toMatchObject({
      status: "COMPLETED",
      modelId: "claude-sonnet-5-5",
      resultSubtype: "success",
      numTurns: 6,
      costUsd: 0.0418,
      cliVersion: "0.0.0-stub",
      usage: {
        inputTokens: 37,
        outputTokens: 567,
        cacheCreationTokens: 6792,
        cacheReadTokens: 89734,
      },
    });

    const items = await eventItems(run.id);
    const kinds = items.map((item) => item.kind);
    expect(kinds[0]).toBe("prompt");
    expect(kinds).toContain("init");
    expect(kinds).toContain("tool_use");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("result");
    const statuses = items.flatMap((item) => (item.kind === "status" ? [item.status] : []));
    expect(statuses).toEqual(["SPAWNING", "RUNNING", "COMPLETED"]);

    const logs = await context.container.prisma.tokenLog.findMany({ where: { runId: run.id } });
    expect(logs.filter((log) => log.scope === "TURN")).toHaveLength(5);
    expect(logs.filter((log) => log.scope === "RUN_TOTAL")).toHaveLength(1);

    const stored = await context.container.prisma.agentRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const args = stored.args as string[];
    expect(args).toContain("--session-id");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(args).toContain("--settings");

    const telemetry = await api.get<TelemetrySummary>("/api/telemetry/summary");
    expect(telemetry.body.today).toMatchObject({ runs: 1, costUsd: 0.0418 });
    expect(telemetry.body.byModel[0]).toMatchObject({ modelId: "claude-sonnet-5-5", runs: 1 });
  });

  it("resumes the workspace session and rotates it when the model changes", async () => {
    const task = await createTask("First pass [stub:quick]");
    await runTask(task.id);
    const first = await waitForTask(task.id, ["COMPLETED"]);

    await runTask(task.id, { prompt: "Follow-up [stub:quick]" });
    const second = await waitForTask(task.id, ["COMPLETED"]);
    const [resumed, original] = second.runs as [RunDto, RunDto];
    expect(original.id).toBe(first.runs[0]?.id);
    expect(resumed.sessionId).toBe(original.sessionId);
    expect(resumed.prompt).toBe("Follow-up [stub:quick]");
    const resumedArgs = (
      await context.container.prisma.agentRun.findUniqueOrThrow({ where: { id: resumed.id } })
    ).args as string[];
    expect(resumedArgs[resumedArgs.indexOf("--resume") + 1]).toBe(original.sessionId);

    await runTask(task.id, { modelId: "claude-opus-5-5", prompt: "Escalate [stub:quick]" });
    const third = await waitForTask(task.id, ["COMPLETED"]);
    const escalated = third.runs[0] as RunDto;
    expect(escalated.modelId).toBe("claude-opus-5-5");
    expect(escalated.sessionId).not.toBe(original.sessionId);

    const sessions = await api.get<{ items: SessionDto[] }>(
      `/api/workspaces/${workspaceId("Frontend")}/sessions`,
    );
    const rotated = sessions.body.items.find((session) => session.id === original.sessionId);
    expect(rotated).toMatchObject({ status: "ROTATED", endReason: "MODEL_CHANGE" });
    expect(sessions.body.items[0]).toMatchObject({
      previousId: original.sessionId,
      status: "IDLE",
    });
  });

  it("starts a new session when Claude Code no longer has the one it resumes", async () => {
    const task = await createTask("First pass [stub:quick]");
    await runTask(task.id);
    const first = await waitForTask(task.id, ["COMPLETED"]);
    const original = first.runs[0] as RunDto;

    await runTask(task.id, { prompt: "Again [stub:lost-session]" });
    const done = await waitForTask(task.id, ["COMPLETED", "FAILED"]);
    expect(done.status).toBe("COMPLETED");
    const [retried, lost] = done.runs as [RunDto, RunDto];
    expect(lost).toMatchObject({
      status: "FAILED",
      resultSubtype: "error_during_execution",
      numTurns: 0,
      sessionId: original.sessionId,
    });
    expect(lost.errorMessage).toBe(
      `Claude Code finished with error_during_execution: No conversation found with session ID: ${original.sessionId}`,
    );
    const lostItems = await eventItems(lost.id);
    expect(
      lostItems.some(
        (item) =>
          item.kind === "status" &&
          item.status === "FAILED" &&
          (item.message ?? "").endsWith("re-queued in a new one."),
      ),
    ).toBe(true);

    expect(retried).toMatchObject({ status: "COMPLETED", prompt: "Again [stub:lost-session]" });
    expect(retried.sessionId).not.toBe(original.sessionId);
    const retriedArgs = (
      await context.container.prisma.agentRun.findUniqueOrThrow({ where: { id: retried.id } })
    ).args as string[];
    expect(retriedArgs).not.toContain("--resume");
    expect(retriedArgs).toContain("--session-id");

    const sessions = await api.get<{ items: SessionDto[] }>(
      `/api/workspaces/${workspaceId("Frontend")}/sessions`,
    );
    expect(sessions.body.items.find((session) => session.id === original.sessionId)).toMatchObject({
      status: "CLOSED",
      endReason: "ERROR",
    });
  });

  it("lets the operator allow blocked commands and continue the task", async () => {
    const task = await createTask(
      "Screenshots [stub:allowlist] bash:{python3 -c 1} bash:{git status}",
    );
    await runTask(task.id);
    const first = await waitForTask(task.id, ["COMPLETED"]);
    const blockedRun = first.runs[0] as RunDto;
    expect(blockedRun.guardDenials).toBe(1);

    const blocked = await api.get<BlockedCommandsResponse>(`/api/runs/${blockedRun.id}/blocked`);
    expect(blocked.body).toMatchObject({
      taskId: task.id,
      projectId: project.id,
      commands: ["python3 -c 1"],
      suggestions: [
        {
          rule: "Bash(python3 *)",
          program: "python3",
          safety: "REVIEW",
          command: "python3 -c 1",
          allowed: false,
        },
      ],
      refused: [],
    });

    const invalid = await api.post(`/api/runs/${blockedRun.id}/allow`, { rules: ["rm -rf /"] });
    expect(invalid.status).toBe(400);
    const unproposed = await api.post(`/api/runs/${blockedRun.id}/allow`, {
      rules: ["Bash(rm *)"],
    });
    expect(unproposed.status).toBe(400);

    const continued = await api.post<RunTaskResponse>(`/api/runs/${blockedRun.id}/allow`, {
      rules: ["Bash(python3 *)"],
      reply: "[stub:allowlist] bash:{python3 -c 1}",
    });
    expect(continued.status).toBe(202);
    const second = await waitForTask(task.id, ["COMPLETED"]);
    const next = second.runs[0] as RunDto;
    expect(next.id).not.toBe(blockedRun.id);
    expect(next.sessionId).toBe(blockedRun.sessionId);
    expect(next.guardDenials).toBe(0);
    expect(next.prompt).toBe(
      "The commands you could not run before are now allowed: python3 *.\n\n[stub:allowlist] bash:{python3 -c 1}",
    );
    const args = (
      await context.container.prisma.agentRun.findUniqueOrThrow({ where: { id: next.id } })
    ).args as string[];
    expect(args).toContain("Bash(python3 *)");

    const detail = await api.get<ProjectDetailDto>(`/api/projects/${project.id}`);
    expect(detail.body.allowedTools).toEqual([]);
    expect(detail.body.commandGrants).toMatchObject([
      {
        rule: "Bash(python3 *)",
        scope: "TASK",
        taskId: task.id,
        command: "python3 -c 1",
        expiresAt: null,
      },
    ]);
    const again = await api.get<BlockedCommandsResponse>(`/api/runs/${blockedRun.id}/blocked`);
    expect(again.body.suggestions[0]?.allowed).toBe(true);
    const other = await createTask("Other [stub:allowlist] bash:{python3 -c 1}");
    await runTask(other.id);
    const otherRun = (await waitForTask(other.id, ["COMPLETED"])).runs[0] as RunDto;
    expect(otherRun.guardDenials).toBe(1);

    const grantId = detail.body.commandGrants[0]?.id ?? "";
    const revoked = await api.delete(`/api/projects/${project.id}/command-grants/${grantId}`);
    expect(revoked.status).toBe(204);
    const projectWide = await api.post(`/api/runs/${otherRun.id}/allow`, {
      rules: ["Bash(python3 *)"],
      scope: "PROJECT",
    });
    expect(projectWide.status).toBe(202);
    await waitForTask(other.id, ["COMPLETED"]);
    await context.container.scheduler.settledTask(other.id);
    const projectDetail = await api.get<ProjectDetailDto>(`/api/projects/${project.id}`);
    expect(projectDetail.body.allowedTools).toEqual(["Bash(python3 *)"]);
    expect(projectDetail.body.commandGrants).toEqual([]);

    const rejected = await api.put(`/api/projects/${project.id}/allowed-tools`, {
      allowedTools: ["python3"],
    });
    expect(rejected.status).toBe(400);
    const cleared = await api.put<AllowedToolsResponse>(
      `/api/projects/${project.id}/allowed-tools`,
      { allowedTools: [] },
    );
    expect(cleared.body).toEqual({ allowedTools: [] });
  });

  it("aborts a running task and kills the agent", async () => {
    const task = await createTask("Long job [stub:hang]");
    await runTask(task.id);
    const running = await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
      (detail) => detail.runs[0]?.status === "RUNNING",
    );
    const runId = running.runs[0]?.id as string;
    const aborted = await api.post<RunDto>(`/api/runs/${runId}/abort`);
    expect(aborted.status).toBe(200);
    expect(aborted.body).toMatchObject({ status: "ABORTED", errorMessage: "Aborted by operator" });
    const detail = await waitForTask(task.id, ["CANCELLED"]);
    expect(detail.status).toBe("CANCELLED");

    const again = await api.post(`/api/runs/${runId}/abort`);
    expect(again.status).toBe(409);
  });

  it("cancels a queued task before it starts", async () => {
    const blocker = await createTask("Blocker [stub:hang]");
    const waiting = await createTask("Waiting [stub:quick]");
    await runTask(blocker.id);
    const queued = await runTask(waiting.id);
    expect(queued.queuePosition).toBe(1);

    const cancelled = await api.post<TaskDto>(`/api/tasks/${waiting.id}/cancel`);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.lastRun).toBeNull();

    const stopped = await api.post<TaskDetailDto>(`/api/tasks/${blocker.id}/cancel`);
    expect(stopped.body.status).toBe("CANCELLED");
  });

  it("serialises runs within a workspace and parallelises across workspaces", async () => {
    const first = await createTask("One [stub:hang]");
    const second = await createTask("Two [stub:quick]");
    const other = await createTask("Other [stub:quick]", "Backend");
    await runTask(first.id);
    await runTask(second.id);
    await runTask(other.id);

    await waitForTask(other.id, ["COMPLETED"]);
    const secondState = (await api.get<TaskDetailDto>(`/api/tasks/${second.id}`)).body;
    expect(secondState.status).toBe("QUEUED");

    await api.post(`/api/tasks/${first.id}/cancel`);
    const secondDone = await waitForTask(second.id, ["COMPLETED"]);
    expect(secondDone.status).toBe("COMPLETED");
  });

  it("reports failures from Claude Code and from crashes", async () => {
    const maxTurns = await createTask("Big refactor [stub:error-max-turns]");
    await runTask(maxTurns.id);
    const failed = await waitForTask(maxTurns.id, ["FAILED"]);
    expect(failed.runs[0]).toMatchObject({
      status: "FAILED",
      resultSubtype: "error_max_turns",
      costUsd: 0.0123,
    });

    const crash = await createTask("Crash [stub:crash]", "Backend");
    await runTask(crash.id);
    const crashed = await waitForTask(crash.id, ["FAILED"]);
    expect(crashed.runs[0]?.errorMessage).toContain("simulated crash");
    const items = await eventItems(crashed.runs[0]?.id as string);
    expect(
      items.some((item) => item.kind === "stderr" && item.text.includes("simulated crash")),
    ).toBe(true);
  });

  it("rejects invalid run requests", async () => {
    const task = await createTask("Anything [stub:hang]");
    const disabled = await api.post(`/api/tasks/${task.id}/run`, { modelId: "claude-fable-5-1" });
    expect(disabled.status).toBe(400);

    await runTask(task.id);
    const duplicate = await api.post(`/api/tasks/${task.id}/run`);
    expect(duplicate.status).toBe(409);
    await api.post(`/api/tasks/${task.id}/cancel`);

    const foreign = await api.post("/api/tasks", {
      projectId: "nope",
      workspaceId: workspaceId("Frontend"),
      title: "x",
      prompt: "y",
    });
    expect(foreign.status).toBe(400);
  });
});
