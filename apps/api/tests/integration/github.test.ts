import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  CloneJobDto,
  GitHubAccountDto,
  GitHubBranchListResponse,
  GitHubRepoListResponse,
  ProjectDetailDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  type ApiClient,
  type TestContext,
} from "../helpers";

const GOOD_TOKEN = "ghp_0123456789abcdefghijABCDEFGHIJ";
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Onyx Test",
  GIT_AUTHOR_EMAIL: "onyx@example.com",
  GIT_COMMITTER_NAME: "Onyx Test",
  GIT_COMMITTER_EMAIL: "onyx@example.com",
};

let fixtures: string;
let bareRepo: string;
let server: Server;
let apiUrl: string;
let context: TestContext;
let api: ApiClient;
const authorizations: Array<string | undefined> = [];

function repoJson(name: string, extra: Record<string, unknown> = {}) {
  return {
    full_name: `octo/${name}`,
    name,
    owner: { login: "octo" },
    description: `The ${name} repository`,
    private: name !== "shop",
    fork: false,
    archived: false,
    default_branch: "main",
    language: "TypeScript",
    size: 120,
    pushed_at: "2026-10-01T10:00:00Z",
    html_url: `https://github.com/octo/${name}`,
    clone_url: `file://${bareRepo}`,
    ...extra,
  };
}

function send(response: ServerResponse, status: number, body: unknown, link?: string): void {
  response.writeHead(status, {
    "content-type": "application/json",
    ...(link ? { link } : {}),
  });
  response.end(JSON.stringify(body));
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://fake");
  authorizations.push(request.headers.authorization);
  const authorized = request.headers.authorization === `Bearer ${GOOD_TOKEN}`;
  if (url.pathname === "/user") {
    if (!authorized) return send(response, 401, { message: "Bad credentials" });
    return send(response, 200, { login: "octo", name: "Octo Cat", avatar_url: null });
  }
  if (url.pathname === "/user/repos") {
    if (!authorized) return send(response, 401, { message: "Requires authentication" });
    return url.searchParams.get("page") === "1"
      ? send(
          response,
          200,
          [repoJson("shop"), repoJson("billing")],
          `<${apiUrl}/user/repos?page=2>; rel="next"`,
        )
      : send(response, 200, [repoJson("infra")]);
  }
  if (url.pathname === "/users/octo/repos") return send(response, 200, [repoJson("shop")]);
  if (url.pathname === "/repos/octo/shop") return send(response, 200, repoJson("shop"));
  if (url.pathname === "/repos/octo/shop/branches")
    return send(response, 200, [{ name: "release/9.9" }, { name: "main" }, { name: "dev" }]);
  return send(response, 404, { message: "Not Found" });
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-github-"));
  const work = join(fixtures, "work");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "shop", type: "module" }),
    "apps/web/src/button.tsx": "export function Button() {\n  return null;\n}\n",
    "apps/api/src/login.ts":
      "export function login(user: string): boolean {\n  return user.length > 0;\n}\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  }
  const git = (args: string[], cwd: string) =>
    execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });
  git(["init", "-q", "-b", "main"], work);
  git(["add", "."], work);
  git(["commit", "-q", "-m", "initial"], work);
  bareRepo = join(fixtures, "shop.git");
  git(["clone", "-q", "--bare", work, bareRepo], fixtures);

  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await createTestContext({ env: { ONYX_GITHUB_API_URL: apiUrl } });
  api = apiClient(context.app, await authenticate(context.app));
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  await new Promise((resolve) => server.close(resolve));
  rmSync(fixtures, { recursive: true, force: true });
});

async function finished(job: CloneJobDto): Promise<CloneJobDto> {
  await context.container.github.settled(job.id);
  return (await api.get<CloneJobDto>(`/api/github/imports/${job.id}`)).body;
}

describe("GitHub import", () => {
  it("needs a token or an owner to list repositories", async () => {
    const account = await api.get<GitHubAccountDto>("/api/github/account");
    expect(account.body).toMatchObject({ connected: false, login: null });
    expect((await api.get("/api/github/repos")).status).toBe(400);
  });

  it("validates and stores a token without ever returning it", async () => {
    const rejected = await api.put<{ error: { message: string } }>("/api/github/token", {
      token: "ghp_wrongwrongwrongwrongwrong",
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain("GitHub rejected the token");

    const connected = await api.put<GitHubAccountDto>("/api/github/token", { token: GOOD_TOKEN });
    expect(connected.status).toBe(200);
    expect(connected.body).toMatchObject({ connected: true, source: "settings", login: "octo" });
    expect(JSON.stringify(connected.body)).not.toContain(GOOD_TOKEN);
  });

  it("lists every page of the account repositories", async () => {
    const listing = await api.get<GitHubRepoListResponse>("/api/github/repos");
    expect(listing.status).toBe(200);
    expect(listing.body.items.map((repo) => repo.fullName)).toEqual([
      "octo/shop",
      "octo/billing",
      "octo/infra",
    ]);
    expect(listing.body.items[1]).toMatchObject({ private: true, importedProjectId: null });
    expect(authorizations).toContain(`Bearer ${GOOD_TOKEN}`);
  });

  it("clones a repository and registers it as a project", async () => {
    const started = await api.post<CloneJobDto>("/api/github/imports", { fullName: "octo/shop" });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ state: "cloning", name: "shop" });

    const job = await finished(started.body);
    expect(job).toMatchObject({ state: "done", error: null });
    const project = (await api.get<ProjectDetailDto>(`/api/projects/${job.projectId}`)).body;
    expect(project).toMatchObject({
      name: "shop",
      rootPath: join(context.projectsDir, "shop"),
      gitRemote: "https://github.com/octo/shop",
      defaultBranch: "main",
    });
    expect(project.workspaces.map((workspace) => workspace.name)).toContain("Frontend");
    expect(existsSync(join(project.rootPath, "apps/api/src/login.ts"))).toBe(true);
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: project.rootPath })
      .toString()
      .trim();
    expect(remote).toBe(`file://${bareRepo}`);

    const listing = await api.get<GitHubRepoListResponse>("/api/github/repos?refresh=true");
    expect(listing.body.items[0]).toMatchObject({
      fullName: "octo/shop",
      importedProjectId: project.id,
    });
  });

  it("refuses duplicates and reports clone failures", async () => {
    const duplicate = await api.post("/api/github/imports", { fullName: "octo/shop" });
    expect(duplicate.status).toBe(409);
    expect((await api.post("/api/github/imports", { fullName: "octo/missing" })).status).toBe(404);

    const started = await api.post<CloneJobDto>("/api/github/imports", {
      fullName: "octo/shop",
      name: "shop-release",
      branch: "release/9.9",
    });
    expect(started.status).toBe(202);
    const job = await finished(started.body);
    expect(job.state).toBe("failed");
    expect(job.error).toContain("release/9.9");
    expect(existsSync(join(context.projectsDir, "shop-release"))).toBe(false);
    expect(
      readdirSync(context.projectsDir).filter((entry) => entry.startsWith(".onyx-clone-")),
    ).toEqual([]);
    const jobs = await api.get<{ items: CloneJobDto[] }>("/api/github/imports");
    expect(jobs.body.items.map((item) => item.state)).toEqual(["failed", "done"]);
  });

  it("lists the branches of a repository and refuses one that does not exist", async () => {
    const listed = await api.get<GitHubBranchListResponse>("/api/github/repos/octo/shop/branches");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      fullName: "octo/shop",
      defaultBranch: "main",
      branches: ["main", "dev", "release/9.9"],
      truncated: false,
    });

    const refused = await api.post<{ error: { message: string } }>("/api/github/imports", {
      fullName: "octo/shop",
      name: "shop-automated",
      branch: "onyx/automated",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toBe(
      "The branch onyx/automated does not exist on octo/shop: leave the field empty to clone main, or pick one of main, release/9.9, dev",
    );
    expect(existsSync(join(context.projectsDir, "shop-automated"))).toBe(false);
  });

  it("browses public repositories of a user and disconnects", async () => {
    const listing = await api.get<GitHubRepoListResponse>("/api/github/repos?owner=octo");
    expect(listing.body).toMatchObject({ owner: "octo" });
    expect(listing.body.items.map((repo) => repo.fullName)).toEqual(["octo/shop"]);
    expect((await api.get("/api/github/repos?owner=bad%20name")).status).toBe(400);

    const disconnected = await api.delete("/api/github/token");
    expect(disconnected.body).toMatchObject({ connected: false });
  });
});
