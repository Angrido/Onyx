import {
  ConnectGitHubRequestSchema,
  CreatePullRequestRequestSchema,
  GitHubIssueListQuerySchema,
  GitHubRepoListQuerySchema,
  ImportIssuesRequestSchema,
  ImportRepoRequestSchema,
  PullRequestDraftQuerySchema,
  SaveChangelogRequestSchema,
  type ChangelogPreviewDto,
  type CloneJobDto,
  type CloneJobListResponse,
  type GitHubAccountDto,
  type GitHubIssueListResponse,
  type GitHubBranchListResponse,
  type GitHubRepoListResponse,
  type ImportIssuesResponse,
  type PullRequestDraftDto,
  type PullRequestDto,
  type PullRequestListResponse,
  type SaveChangelogResponse,
} from "@onyx/contracts";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

const RepoParamsSchema = z.object({ owner: z.string().min(1), repo: z.string().min(1) });

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerGitHubRoutes(app: FastifyInstance, container: Container): void {
  const { github } = container;

  app.get("/api/github/account", async (): Promise<GitHubAccountDto> => github.accountInfo());

  app.put("/api/github/token", async (request): Promise<GitHubAccountDto> =>
    github.connect(ConnectGitHubRequestSchema.parse(request.body).token, actorOf(request)),
  );

  app.delete("/api/github/token", async (request): Promise<GitHubAccountDto> =>
    github.disconnect(actorOf(request)),
  );

  app.get("/api/github/repos", async (request): Promise<GitHubRepoListResponse> => {
    const query = GitHubRepoListQuerySchema.parse(request.query);
    return github.repos(query.owner, query.refresh);
  });

  app.get(
    "/api/github/repos/:owner/:repo/branches",
    async (request): Promise<GitHubBranchListResponse> => {
      const { owner, repo } = RepoParamsSchema.parse(request.params);
      const fullName = ImportRepoRequestSchema.shape.fullName.parse(`${owner}/${repo}`);
      return github.branches(fullName);
    },
  );

  app.post("/api/github/imports", async (request, reply): Promise<CloneJobDto> => {
    const job = await github.startImport(
      ImportRepoRequestSchema.parse(request.body),
      actorOf(request),
    );
    reply.status(202);
    return job;
  });

  app.get("/api/github/imports", async (): Promise<CloneJobListResponse> => ({
    items: github.jobList(),
  }));

  app.get("/api/github/imports/:id", async (request): Promise<CloneJobDto> =>
    github.job(idParam(request.params)),
  );

  const { issues, pulls, changelog } = container;

  app.get("/api/projects/:id/github/issues", async (request): Promise<GitHubIssueListResponse> => {
    const query = GitHubIssueListQuerySchema.parse(request.query);
    return issues.list(idParam(request.params), query.page, query.label);
  });

  app.post(
    "/api/projects/:id/github/issues/import",
    async (request, reply): Promise<ImportIssuesResponse> => {
      const result = await issues.import(
        idParam(request.params),
        ImportIssuesRequestSchema.parse(request.body),
      );
      reply.status(result.items.length > 0 ? 201 : 200);
      return result;
    },
  );

  app.get("/api/projects/:id/github/pulls", async (request): Promise<PullRequestListResponse> =>
    pulls.list(idParam(request.params)),
  );

  app.get("/api/projects/:id/github/pulls/draft", async (request): Promise<PullRequestDraftDto> =>
    pulls.draft(idParam(request.params), PullRequestDraftQuerySchema.parse(request.query).branch),
  );

  app.post("/api/projects/:id/github/pulls", async (request, reply): Promise<PullRequestDto> => {
    const pull = await pulls.create(
      idParam(request.params),
      CreatePullRequestRequestSchema.parse(request.body),
      actorOf(request),
    );
    reply.status(201);
    return pull;
  });

  app.post("/api/pull-requests/:id/refresh", async (request): Promise<PullRequestDto> =>
    pulls.refresh(idParam(request.params)),
  );

  app.get("/api/projects/:id/changelog", async (request): Promise<ChangelogPreviewDto> => {
    const query = z
      .object({ from: z.string().trim().min(1).max(200).optional() })
      .parse(request.query);
    return changelog.preview(idParam(request.params), query.from);
  });

  app.post(
    "/api/projects/:id/changelog",
    async (request, reply): Promise<SaveChangelogResponse> => {
      const saved = await changelog.save(
        idParam(request.params),
        SaveChangelogRequestSchema.parse(request.body),
        actorOf(request),
      );
      reply.status(201);
      return saved;
    },
  );
}
