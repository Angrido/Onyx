import {
  PublishChangesRequestSchema,
  UpdateGitIdentityRequestSchema,
  type GitIdentityDto,
  type GitStatusDto,
  type PublishResultDto,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerGitRoutes(app: FastifyInstance, container: Container): void {
  const { git } = container;

  app.get("/api/projects/:id/git", async (request): Promise<GitStatusDto> =>
    git.status(idParam(request.params)),
  );

  app.post("/api/projects/:id/git/publish", async (request): Promise<PublishResultDto> => {
    const id = idParam(request.params);
    return git
      .publish(id, PublishChangesRequestSchema.parse(request.body), actorOf(request))
      .finally(() => container.mission.forget(id));
  });

  app.post("/api/projects/:id/git/switch-default", async (request): Promise<GitStatusDto> => {
    const id = idParam(request.params);
    return git.switchToDefault(id, actorOf(request)).finally(() => container.mission.forget(id));
  });

  app.get("/api/settings/git", async (): Promise<GitIdentityDto> => git.identity());

  app.put("/api/settings/git", async (request): Promise<GitIdentityDto> =>
    git.updateIdentity(UpdateGitIdentityRequestSchema.parse(request.body), actorOf(request)),
  );
}
