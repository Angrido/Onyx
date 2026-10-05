import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ApprovalDto,
  ApprovalListResponse,
  OrchestrationDto,
  ProjectDetailDto,
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

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Seed",
  GIT_AUTHOR_EMAIL: "seed@example.com",
  GIT_COMMITTER_NAME: "Seed",
  GIT_COMMITTER_EMAIL: "seed@example.com",
};

let context: TestContext;
let api: ApiClient;
let fixtures: string;
let planPath: string;
let editsPath: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

async function project(name: string): Promise<{ root: string; project: ProjectDetailDto }> {
  const root = join(context.projectsDir, name);
  const files = { "src/app/shared.ts": "export const label = 'base';\n", "README.md": "# App\n" };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(["init", "-q", "-b", "main"], root);
  git(["add", "."], root);
  git(["commit", "-q", "-m", "initial"], root);
  const response = await api.post<ProjectDetailDto>("/api/projects", { name, rootPath: root });
  expect(response.status).toBe(201);
  return { root, project: response.body };
}

async function waitForPlan(
  id: string,
  accept: (plan: OrchestrationDto) => boolean,
): Promise<OrchestrationDto> {
  return waitFor(
    async () => (await api.get<OrchestrationDto>(`/api/orchestrations/${id}`)).body,
    accept,
    60_000,
  );
}

async function start(
  target: ProjectDetailDto,
  body: object,
  edits: object,
  options: { qa?: boolean; resolveConflicts?: boolean },
): Promise<OrchestrationDto> {
  writeFileSync(planPath, JSON.stringify(body));
  writeFileSync(editsPath, JSON.stringify(edits));
  const created = await api.post<OrchestrationDto>(`/api/projects/${target.id}/orchestrations`, {
    goal: "Change the shared label of the app",
    parallelism: 2,
    verify: false,
    ...options,
  });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    qa: options.qa ?? false,
    resolveConflicts: options.resolveConflicts ?? false,
  });
  const planned = await waitForPlan(created.body.id, (entry) => entry.status !== "PLANNING");
  expect(planned.status).toBe("AWAITING_APPROVAL");
  expect((await api.post(`/api/orchestrations/${planned.id}/approve`)).status).toBe(200);
  return planned;
}

async function pending(kind: ApprovalDto["kind"], planId: string): Promise<ApprovalDto> {
  return waitFor(
    async () =>
      (await api.get<ApprovalListResponse>("/api/approvals?status=PENDING")).body.items.find(
        (entry) => entry.kind === kind && entry.orchestrationId === planId,
      ),
    (entry): entry is ApprovalDto => entry !== undefined,
    60_000,
  ) as Promise<ApprovalDto>;
}

function single(description: string) {
  return {
    summary: "One task.",
    tasks: [
      {
        key: "label",
        title: "Set the label",
        description,
        workspace: "Frontend",
        dependsOn: [],
        acceptance: ["The label is 'first'"],
      },
    ],
  };
}

const LABEL_EDIT = {
  "Write the first label": {
    edits: [
      { tool: "Write", file: "src/app/shared.ts", content: "export const label = 'first';\n" },
    ],
  },
};

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-plan-review-"));
  planPath = join(fixtures, "plan.json");
  editsPath = join(fixtures, "edits.json");
  writeFileSync(planPath, "{}");
  writeFileSync(editsPath, "{}");
  context = await createTestContext({
    maxConcurrent: 3,
    sourceEnv: { CLAUDE_STUB_PLAN: planPath, CLAUDE_STUB_EDITS: editsPath },
  });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  api = apiClient(context.app, await authenticate(context.app));
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(fixtures, { recursive: true, force: true });
});

describe("QA before merging a plan node", () => {
  it("merges a node the reviewer passes with evidence from the diff", async () => {
    const { root, project: target } = await project("qa-pass");
    const planned = await start(
      target,
      single("Write the first label in src/app/shared.ts."),
      LABEL_EDIT,
      {
        qa: true,
      },
    );
    const done = await waitForPlan(
      planned.id,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    );
    expect(done.status).toBe("COMPLETED");
    const node = done.nodes[0];
    expect(node?.reviews).toBe(1);
    expect(node?.review).toMatchObject({
      attempt: 1,
      verdict: "PASS",
      criteria: [
        {
          index: 1,
          text: "The label is 'first'",
          met: true,
          evidence: "src/app/shared.ts:1 the change is in the diff",
        },
      ],
      issues: [],
      diffTruncated: false,
    });
    expect(node?.review?.diffTokens).toBeGreaterThan(0);
    expect(done.qaCostUsd).toBeGreaterThan(0);
    expect(git(["show", `${done.workBranch}:src/app/shared.ts`], root)).toBe(
      "export const label = 'first';",
    );
    const logs = await context.container.prisma.tokenLog.count({ where: { purpose: "qa-review" } });
    expect(logs).toBeGreaterThan(0);
  }, 90_000);

  it("sends the problems back once and merges when the second review passes", async () => {
    const { project: target } = await project("qa-rework");
    const planned = await start(
      target,
      single("Write the first label in src/app/shared.ts. [stub:qa-fail-once]"),
      LABEL_EDIT,
      { qa: true },
    );
    const done = await waitForPlan(
      planned.id,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    );
    expect(done.status).toBe("COMPLETED");
    expect(done.nodes[0]).toMatchObject({
      reviews: 2,
      runs: 2,
      review: { attempt: 2, verdict: "PASS" },
    });
    const reviews = await context.container.prisma.qaReview.findMany({
      where: { orchestrationId: planned.id },
      orderBy: { attempt: "asc" },
    });
    expect(reviews.map((review) => review.verdict)).toEqual(["FAIL", "PASS"]);
    const runs = await context.container.prisma.agentRun.findMany({
      where: { taskId: done.nodes[0]?.taskId ?? "" },
      orderBy: { startedAt: "asc" },
      select: { sessionId: true, prompt: true },
    });
    expect(runs[1]?.sessionId).toBe(runs[0]?.sessionId);
    expect(runs[1]?.prompt).toContain("A reviewer checked your change before the merge");
    expect(runs[1]?.prompt).toContain("The empty case is not handled");
  }, 90_000);

  it("asks the operator after a second failed review and merges when told to", async () => {
    const { project: target } = await project("qa-ask");
    const planned = await start(
      target,
      single("Write the first label in src/app/shared.ts. [stub:qa-fail]"),
      LABEL_EDIT,
      { qa: true },
    );
    const approval = await pending("QA", planned.id);
    expect(approval).toMatchObject({
      title: "Review: Set the label",
      approveLabel: "Merge anyway",
      rejectLabel: "Drop this task",
      files: ["src/app/shared.ts"],
    });
    expect(approval.detail).toContain("QA found problems after 2 reviews: criterion 1 not met");
    const waiting = await waitForPlan(planned.id, (entry) => entry.message !== null);
    expect(waiting.nodes[0]?.state).toBe("review");
    expect(waiting.message).toBe("Waiting for a merge decision in Approvals");
    expect((await api.post(`/api/approvals/${approval.id}/approve`)).status).toBe(200);
    const done = await waitForPlan(
      planned.id,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    );
    expect(done.status).toBe("COMPLETED");
    expect(done.nodes[0]?.state).toBe("merged");
  }, 90_000);

  it("does not accept a criterion without evidence from the diff, and drops the node when told to", async () => {
    const { project: target } = await project("qa-evidence");
    const planned = await start(
      target,
      single("Write the first label in src/app/shared.ts. [stub:qa-no-evidence]"),
      LABEL_EDIT,
      { qa: true },
    );
    const approval = await pending("QA", planned.id);
    const review = (await api.get<OrchestrationDto>(`/api/orchestrations/${planned.id}`)).body
      .nodes[0]?.review;
    expect(review).toMatchObject({
      verdict: "FAIL",
      criteria: [{ met: false, evidence: "No evidence from the diff: Looks right to me" }],
    });
    expect((await api.post(`/api/approvals/${approval.id}/reject`)).status).toBe(200);
    const done = await waitForPlan(planned.id, (entry) => entry.status === "FAILED");
    expect(done.nodes[0]?.state).toBe("failed");
  }, 90_000);
});

describe("merge conflicts resolved with Claude", () => {
  const body = {
    summary: "Two tasks that touch the same file.",
    tasks: [
      {
        key: "first",
        title: "First label",
        description: "Set the first label in src/app/shared.ts.",
        workspace: "Frontend",
        dependsOn: [],
        acceptance: [],
      },
      {
        key: "second",
        title: "Second label",
        description: "Set the second label in src/app/shared.ts.",
        workspace: "Frontend",
        dependsOn: [],
        acceptance: [],
      },
    ],
  };
  const edits = (secondMarker = "") => ({
    "Set the first label": {
      edits: [
        { tool: "Write", file: "src/app/shared.ts", content: "export const label = 'first';\n" },
      ],
    },
    [`Set the second label${secondMarker}`]: {
      delayMs: 800,
      edits: [
        { tool: "Write", file: "src/app/shared.ts", content: "export const second = 'second';\n" },
      ],
    },
  });

  it("proposes a resolution with its diff and applies it after approval", async () => {
    const { root, project: target } = await project("resolve-apply");
    const planned = await start(target, body, edits(), { resolveConflicts: true });
    const approval = await pending("MERGE", planned.id);
    expect(approval).toMatchObject({
      title: "Resolved conflict: Second label",
      approveLabel: "Apply the resolution",
      rejectLabel: "Resolve it myself",
      files: ["src/app/shared.ts"],
    });
    expect(approval.detail).toContain(
      "Claude resolved the conflict in 1 file(s). Tests not run: the plan does not verify.",
    );
    const waiting = (await api.get<OrchestrationDto>(`/api/orchestrations/${planned.id}`)).body;
    const node = waiting.nodes.find((entry) => entry.key === "second");
    expect(node?.state).toBe("conflict");
    expect(node?.resolution).toMatchObject({
      state: "PROPOSED",
      files: ["src/app/shared.ts"],
      checksPassed: null,
    });
    expect(node?.resolution?.diff).toContain("export const second = 'second';");
    expect(waiting.qaCostUsd).toBeGreaterThan(0);

    expect((await api.post(`/api/approvals/${approval.id}/approve`)).status).toBe(200);
    const done = await waitForPlan(
      planned.id,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    );
    expect(done.status).toBe("COMPLETED");
    expect(done.nodes.find((entry) => entry.key === "second")?.resolution?.state).toBe("APPLIED");
    expect(git(["show", `${done.workBranch}:src/app/shared.ts`], root)).toBe(
      "export const label = 'first';\nexport const second = 'second';",
    );
    expect(git(["for-each-ref", "refs/onyx/resolutions"], root)).toBe("");
  }, 90_000);

  it("falls back to the manual choice when the proposal is not usable or is refused", async () => {
    const { project: target } = await project("resolve-fallback");
    const unusable = {
      ...body,
      tasks: body.tasks.map((task) =>
        task.key === "second"
          ? { ...task, description: `${task.description} [stub:resolve-leave]` }
          : task,
      ),
    };
    const planned = await start(target, unusable, edits(), { resolveConflicts: true });
    const manual = await pending("MERGE", planned.id);
    expect(manual).toMatchObject({
      title: "Merge conflict: Second label",
      approveLabel: "Retry the merge",
    });
    expect(manual.detail).toContain(
      "Claude's proposal was not usable: Conflict markers are still in src/app/shared.ts",
    );
    const failed = (
      await api.get<OrchestrationDto>(`/api/orchestrations/${planned.id}`)
    ).body.nodes.find((entry) => entry.key === "second");
    expect(failed?.resolution).toMatchObject({ state: "FAILED" });
    expect((await api.post(`/api/orchestrations/${planned.id}/cancel`)).status).toBe(200);

    const { project: other } = await project("resolve-refuse");
    const second = await start(other, body, edits(), { resolveConflicts: true });
    const proposal = await pending("MERGE", second.id);
    expect(proposal.approveLabel).toBe("Apply the resolution");
    expect((await api.post(`/api/approvals/${proposal.id}/reject`)).status).toBe(200);
    const fallback = await pending("MERGE", second.id);
    expect(fallback).toMatchObject({
      approveLabel: "Retry the merge",
      rejectLabel: "Drop this task",
    });
    const node = (
      await api.get<OrchestrationDto>(`/api/orchestrations/${second.id}`)
    ).body.nodes.find((entry) => entry.key === "second");
    expect(node?.resolution?.state).toBe("DISCARDED");
    expect((await api.post(`/api/orchestrations/${second.id}/cancel`)).status).toBe(200);
  }, 120_000);
});
