import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChangelogPreviewDto,
  GitHubIssueListResponse,
  ImportIssuesResponse,
  ProjectDetailDto,
  PullRequestDraftDto,
  PullRequestDto,
  PullRequestListResponse,
  SaveChangelogResponse,
  TaskDetailDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  type ApiClient,
  type TestContext,
} from "../helpers";

const TOKEN = "ghp_0123456789abcdefghijABCDEFGHIJ";
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Onyx Test",
  GIT_AUTHOR_EMAIL: "onyx@example.com",
  GIT_COMMITTER_NAME: "Onyx Test",
  GIT_COMMITTER_EMAIL: "onyx@example.com",
};

let fixtures: string;
let bare: string;
let server: Server;
let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;
const created: Array<Record<string, unknown>> = [];
const conditional: Array<{ path: string; etag: string | undefined; status: number }> = [];
const github = {
  pullState: "open",
  merged: false,
  headSha: "abc123",
  pullVersion: 1,
  runs: [] as Array<Record<string, unknown>>,
  runsVersion: 1,
  statuses: [] as Array<Record<string, unknown>>,
  statusVersion: 1,
};

function issue(number: number, title: string, labels: string[], body: string, extra = {}) {
  return {
    number,
    title,
    body,
    html_url: `https://github.com/octo/shop/issues/${number}`,
    state: "open",
    labels: labels.map((name) => ({ name })),
    user: { login: "mallory" },
    comments: 2,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    ...extra,
  };
}

const ISSUES = [
  issue(3, "Sum is wrong", ["bug"], "The `add` result is wrong in src/math.ts\n<!-- hidden -->"),
  issue(4, "Add a multiply helper", ["enhancement"], "We need multiply."),
  issue(5, "Bump deps", [], "PR", { pull_request: { url: "x" } }),
];

function pullJson() {
  return {
    number: 21,
    title: "Fix the sum",
    html_url: "https://github.com/octo/shop/pull/21",
    state: github.pullState,
    draft: false,
    merged_at: github.merged ? "2026-10-04T12:00:00Z" : null,
    head: { ref: "onyx/fix-sum", sha: github.headSha },
    base: { ref: "main" },
  };
}

function send(response: ServerResponse, status: number, body: unknown, headers = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(status === 304 ? undefined : JSON.stringify(body));
}

function withEtag(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  etag: string,
  body: () => unknown,
): void {
  const sent = request.headers["if-none-match"];
  const status = sent === etag ? 304 : 200;
  conditional.push({ path, etag: typeof sent === "string" ? sent : undefined, status });
  send(response, status, status === 304 ? null : body(), { etag });
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://fake");
  const authorized = request.headers.authorization === `Bearer ${TOKEN}`;
  const path = url.pathname;
  if (path === "/user")
    return authorized
      ? send(response, 200, { login: "octo", name: "Octo", avatar_url: null })
      : send(response, 401, { message: "Bad credentials" });
  if (path === "/repos/octo/shop/issues")
    return send(response, 200, ISSUES, {
      ...(url.searchParams.get("page") === "1"
        ? { link: '<http://fake/repos/octo/shop/issues?page=2>; rel="next"' }
        : {}),
    });
  const single = /^\/repos\/octo\/shop\/issues\/(\d+)$/.exec(path);
  if (single) {
    const found = ISSUES.find((entry) => entry.number === Number(single[1]));
    return found ? send(response, 200, found) : send(response, 404, { message: "Not Found" });
  }
  if (path === "/repos/octo/shop/pulls" && request.method === "POST") {
    if (!authorized) return send(response, 401, { message: "Requires authentication" });
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    request.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      created.push(body);
      if (created.length > 1)
        return send(response, 422, {
          message: "Validation Failed",
          errors: [{ message: "A pull request already exists for octo:onyx/fix-sum." }],
        });
      send(response, 201, pullJson());
    });
    return;
  }
  if (path === "/repos/octo/shop/pulls")
    return send(
      response,
      200,
      url.searchParams.get("head") === "octo:onyx/fix-sum" ? [pullJson()] : [],
    );
  if (path === "/repos/octo/shop/pulls/21")
    return withEtag(request, response, path, `"pull-${github.pullVersion}"`, pullJson);
  if (path === `/repos/octo/shop/commits/${github.headSha}/check-runs`)
    return withEtag(request, response, "runs", `"runs-${github.runsVersion}"`, () => ({
      total_count: github.runs.length,
      check_runs: github.runs,
    }));
  if (path === `/repos/octo/shop/commits/${github.headSha}/status`)
    return withEtag(request, response, "status", `"status-${github.statusVersion}"`, () => ({
      state: "pending",
      statuses: github.statuses,
    }));
  return send(response, 404, { message: "Not Found" });
}

function git(args: string[], cwd = context.projectRoot): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-github-work-"));
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await createTestContext({ env: { ONYX_GITHUB_API_URL: apiUrl } });
  api = apiClient(context.app, await authenticate(context.app));

  git(["init", "-q", "-b", "main"]);
  git(["add", "."]);
  git(["commit", "-q", "-m", "feat: first math helper"]);
  git(["tag", "v0.1.0"]);
  writeFileSync(
    join(context.projectRoot, "src", "math.ts"),
    "export const add = (a: number, b: number) => a + b;\n",
  );
  git(["commit", "-qam", "fix(math): correct the sum"]);
  git(["commit", "-q", "--allow-empty", "-m", "chore: tidy"]);
  git(["commit", "-q", "--allow-empty", "-m", "Explain the helpers"]);
  bare = join(fixtures, "shop.git");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(["remote", "add", "origin", "https://github.com/octo/shop.git"]);
  git(["remote", "set-url", "--push", "origin", bare]);

  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  await new Promise((resolve) => server.close(resolve));
  rmSync(fixtures, { recursive: true, force: true });
});

describe("GitHub issues as tasks", () => {
  it("lists open issues without pull requests, even without a token", async () => {
    const listing = await api.get<GitHubIssueListResponse>(
      `/api/projects/${project.id}/github/issues`,
    );
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({ repo: "octo/shop", page: 1, hasNext: true });
    expect(listing.body.items.map((entry) => entry.number)).toEqual([3, 4]);
    expect(listing.body.items[0]).toMatchObject({
      labels: ["bug"],
      author: "mallory",
      comments: 2,
      importedTaskId: null,
      excerpt: "The add result is wrong in src/math.ts",
    });
  });

  it("imports issues as draft tasks with link, labels, kind and inferred targets", async () => {
    const imported = await api.post<ImportIssuesResponse>(
      `/api/projects/${project.id}/github/issues/import`,
      { numbers: [3, 4, 5, 3] },
    );
    expect(imported.status).toBe(201);
    expect(imported.body.skipped).toEqual([
      { number: 5, reason: "This is a pull request, not an issue" },
    ]);
    const [bug, feature] = imported.body.items;
    expect(bug).toMatchObject({
      title: "Sum is wrong",
      kind: "BUGFIX",
      status: "DRAFT",
      targetPaths: ["src/math.ts"],
      issue: {
        repo: "octo/shop",
        number: 3,
        url: "https://github.com/octo/shop/issues/3",
        labels: ["bug"],
      },
    });
    expect(bug?.prompt).toContain("not from the operator");
    expect(bug?.prompt).not.toContain("hidden");
    expect(feature).toMatchObject({ kind: "FEATURE", targetPaths: [] });

    const again = await api.post<ImportIssuesResponse>(
      `/api/projects/${project.id}/github/issues/import`,
      { numbers: [3, 99] },
    );
    expect(again.status).toBe(200);
    expect(again.body.skipped).toEqual([
      { number: 3, reason: "Already imported" },
      { number: 99, reason: "Not found on GitHub, or the token cannot see it" },
    ]);
    const listing = await api.get<GitHubIssueListResponse>(
      `/api/projects/${project.id}/github/issues`,
    );
    expect(listing.body.items[0]?.importedTaskId).toBe(bug?.id);
  });
});

describe("pull requests and checks", () => {
  let taskId = "";

  it("drafts a description from the tasks published on the branch", async () => {
    git(["switch", "-q", "-c", "onyx/fix-sum"]);
    writeFileSync(
      join(context.projectRoot, "src", "math.ts"),
      "export const add = (a: number, b: number) => b + a;\n",
    );
    git(["commit", "-qam", "fix: sum in the other order"]);
    git(["switch", "-q", "main"]);
    const task = await context.container.prisma.task.findFirstOrThrow({
      where: { projectId: project.id, issueNumber: 3 },
    });
    taskId = task.id;
    await context.container.prisma.task.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        branchName: "onyx/fix-sum",
        resultSummary: "Swapped the operands.",
        acceptance: ["add(1, 2) is 3"],
      },
    });
    const draft = await api.get<PullRequestDraftDto>(
      `/api/projects/${project.id}/github/pulls/draft?branch=onyx/fix-sum`,
    );
    expect(draft.body).toMatchObject({
      repo: "octo/shop",
      baseBranch: "main",
      title: "Sum is wrong",
      canCreate: false,
      reason: "Connect a GitHub token with Pull requests read and write",
      existing: null,
    });
    expect(draft.body.body).toContain("- **Sum is wrong**: Swapped the operands.");
    expect(draft.body.body).toContain("- `src/math.ts` (+1 −1)");
    expect(draft.body.body).toContain("- [ ] add(1, 2) is 3");
    expect(draft.body.body).toContain("Closes #3");
    const missing = await api.get<PullRequestDraftDto>(
      `/api/projects/${project.id}/github/pulls/draft?branch=nope`,
    );
    expect(missing.body.reason).toBe("The branch nope does not exist in the project");
  });

  it("pushes the branch and opens the pull request with the token", async () => {
    expect(
      (
        await api.post(`/api/projects/${project.id}/github/pulls`, {
          branch: "onyx/fix-sum",
          title: "x",
        })
      ).status,
    ).toBe(400);
    await api.put("/api/github/token", { token: TOKEN });
    github.runs = [
      { name: "test", status: "in_progress", conclusion: null, html_url: "https://ci/1" },
    ];
    const opened = await api.post<PullRequestDto>(`/api/projects/${project.id}/github/pulls`, {
      branch: "onyx/fix-sum",
      title: "Fix the sum",
      body: "Body",
    });
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({
      repo: "octo/shop",
      number: 21,
      state: "OPEN",
      branch: "onyx/fix-sum",
      checksState: "PENDING",
      pending: 1,
      checks: [{ name: "test", result: "PENDING", url: "https://ci/1" }],
    });
    expect(created[0]).toEqual({
      title: "Fix the sum",
      head: "onyx/fix-sum",
      base: "main",
      body: "Body",
      draft: false,
    });
    expect(git(["rev-parse", "onyx/fix-sum"], bare)).toBe(git(["rev-parse", "onyx/fix-sum"]));

    const again = await api.post<PullRequestDto>(`/api/projects/${project.id}/github/pulls`, {
      branch: "onyx/fix-sum",
      title: "Fix the sum",
    });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(opened.body.id);
    const listing = await api.get<PullRequestListResponse>(
      `/api/projects/${project.id}/github/pulls`,
    );
    expect(listing.body.items).toHaveLength(1);
    const task = await api.get<TaskDetailDto>(`/api/tasks/${taskId}`);
    expect(task.body.pullRequest).toMatchObject({ number: 21, checksState: "PENDING" });
  });

  it("refreshes checks with ETags, backs off and announces failures", async () => {
    const notify = vi.spyOn(context.container.notifications, "notify");
    const id = (await context.container.prisma.pullRequest.findFirstOrThrow()).id;
    conditional.length = 0;
    let pull = (await api.post<PullRequestDto>(`/api/pull-requests/${id}/refresh`)).body;
    expect(pull.checksState).toBe("PENDING");
    expect(conditional.map((entry) => entry.status)).toEqual([304, 304, 304]);
    expect(notify).not.toHaveBeenCalled();

    github.runs = [
      { name: "test", status: "completed", conclusion: "failure", html_url: "https://ci/1" },
    ];
    github.runsVersion += 1;
    github.statuses = [{ context: "deploy", state: "success", target_url: null }];
    github.statusVersion += 1;
    pull = (await api.post<PullRequestDto>(`/api/pull-requests/${id}/refresh`)).body;
    expect(pull).toMatchObject({ checksState: "FAILURE", failed: 1, passed: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      event: "CHECKS",
      urgent: true,
      body: "shop #21: test failed.",
    });

    const before = await context.container.prisma.pullRequest.findUniqueOrThrow({ where: { id } });
    await context.container.pulls.refresh(id);
    const after = await context.container.prisma.pullRequest.findUniqueOrThrow({ where: { id } });
    expect(after.intervalSec).toBe(before.intervalSec * 2);

    github.runs = [{ name: "test", status: "completed", conclusion: "success", html_url: null }];
    github.runsVersion += 1;
    pull = await context.container.pulls.refresh(id);
    expect(pull.checksState).toBe("SUCCESS");
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]?.[0]).toMatchObject({ urgent: false });

    github.merged = true;
    github.pullState = "closed";
    github.pullVersion += 1;
    pull = await context.container.pulls.refresh(id);
    expect(pull.state).toBe("MERGED");
    const merged = await context.container.prisma.pullRequest.findUniqueOrThrow({ where: { id } });
    expect(merged.nextCheckAt).toBeNull();
    notify.mockRestore();
  });

  it("polls only open pull requests that are due", async () => {
    const id = (await context.container.prisma.pullRequest.findFirstOrThrow()).id;
    await context.container.prisma.pullRequest.update({
      where: { id },
      data: { state: "OPEN", nextCheckAt: new Date(Date.now() - 1000) },
    });
    conditional.length = 0;
    await context.container.pulls.tick();
    expect(conditional.length).toBeGreaterThan(0);
    conditional.length = 0;
    await context.container.pulls.tick();
    expect(conditional).toHaveLength(0);
  });
});

describe("changelog", () => {
  it("previews the changes since the last tag from commits and tasks", async () => {
    const preview = await api.get<ChangelogPreviewDto>(`/api/projects/${project.id}/changelog`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      fromLabel: "v0.1.0",
      version: "v0.1.1",
      commits: 3,
      tasks: 1,
      file: "CHANGELOG.md",
      fileExists: false,
      releases: [],
    });
    expect(preview.body.entries.map((entry) => [entry.section, entry.text])).toEqual([
      ["FIXES", "Sum is wrong"],
      ["FIXES", "Correct the sum"],
      ["OTHER", "Explain the helpers"],
    ]);
    expect(preview.body.markdown).toContain(
      "### Fixes\n\n- Sum is wrong\n- **math:** Correct the sum",
    );
    expect((await api.get(`/api/projects/${project.id}/changelog?from=--output=x`)).status).toBe(
      400,
    );
    expect((await api.get(`/api/projects/${project.id}/changelog?from=nope`)).status).toBe(400);
  });

  it("writes the edited release on top of CHANGELOG.md and starts the next one after it", async () => {
    writeFileSync(
      join(context.projectRoot, "CHANGELOG.md"),
      "# Changelog\n\n## v0.1.0\n\n- First\n",
    );
    const saved = await api.post<SaveChangelogResponse>(`/api/projects/${project.id}/changelog`, {
      version: "v0.1.1",
      markdown: "## v0.1.1 — 2026-10-04\n\n### Fixes\n\n- Correct the sum",
    });
    expect(saved.status).toBe(201);
    expect(saved.body.release).toMatchObject({
      version: "v0.1.1",
      toRef: git(["rev-parse", "HEAD"]),
    });
    expect(readFileSync(join(context.projectRoot, "CHANGELOG.md"), "utf8")).toBe(
      "# Changelog\n\n## v0.1.1 — 2026-10-04\n\n### Fixes\n\n- Correct the sum\n\n## v0.1.0\n\n- First\n",
    );
    const next = await api.get<ChangelogPreviewDto>(`/api/projects/${project.id}/changelog`);
    expect(next.body).toMatchObject({
      fromLabel: "v0.1.1",
      commits: 0,
      tasks: 0,
      version: "v0.1.2",
      fileExists: true,
    });
    expect(next.body.releases).toHaveLength(1);
    expect(
      (
        await api.post(`/api/projects/${project.id}/changelog`, {
          version: "bad version",
          markdown: "x",
        })
      ).status,
    ).toBe(400);
  });
});
