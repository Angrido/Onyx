import {
  ConnectGitHubRequestSchema,
  GitHubRepoListQuerySchema,
  ImportRepoRequestSchema,
  type CloneJobDto,
  type CloneJobListResponse,
  type GitHubAccountDto,
  type GitHubRepoListResponse,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

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
}
