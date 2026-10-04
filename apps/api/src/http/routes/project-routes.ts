import {
  CreateProjectRequestSchema,
  CreateWorkspaceRequestSchema,
  ResetWorkspaceRequestSchema,
  UpdateAllowedToolsRequestSchema,
  UpdateWorkspaceRequestSchema,
  type AllowedToolsResponse,
  type ProjectDetailDto,
  type ProjectListResponse,
  type ResetWorkspaceResponse,
  type SessionListResponse,
  type WorkspaceDto,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

export function registerProjectRoutes(app: FastifyInstance, container: Container): void {
  const { projects, workspaces, compartments } = container;

  app.get("/api/projects", async (): Promise<ProjectListResponse> => ({
    items: await projects.list(),
  }));

  app.post("/api/projects", async (request, reply): Promise<ProjectDetailDto> => {
    const project = await projects.create(CreateProjectRequestSchema.parse(request.body));
    reply.status(201);
    return project;
  });

  app.get("/api/projects/:id", async (request): Promise<ProjectDetailDto> =>
    projects.get(idParam(request.params)),
  );

  app.delete("/api/projects/:id", async (request, reply) => {
    await projects.remove(idParam(request.params));
    reply.status(204);
  });

  app.put("/api/projects/:id/allowed-tools", async (request): Promise<AllowedToolsResponse> => ({
    allowedTools: await projects.setAllowedTools(
      idParam(request.params),
      UpdateAllowedToolsRequestSchema.parse(request.body).allowedTools,
      request.user ? `user:${request.user.username}` : "user:unknown",
    ),
  }));

  app.get("/api/projects/:id/workspaces", async (request): Promise<{ items: WorkspaceDto[] }> => ({
    items: await workspaces.list(idParam(request.params)),
  }));

  app.post("/api/projects/:id/workspaces", async (request, reply): Promise<WorkspaceDto> => {
    const workspace = await workspaces.create(
      idParam(request.params),
      CreateWorkspaceRequestSchema.parse(request.body),
    );
    reply.status(201);
    return workspace;
  });

  app.patch("/api/workspaces/:id", async (request): Promise<WorkspaceDto> =>
    workspaces.update(idParam(request.params), UpdateWorkspaceRequestSchema.parse(request.body)),
  );

  app.get("/api/workspaces/:id", async (request): Promise<WorkspaceDto> =>
    workspaces.get(idParam(request.params)),
  );

  app.post("/api/workspaces/:id/reset", async (request): Promise<ResetWorkspaceResponse> => {
    const id = idParam(request.params);
    const input = ResetWorkspaceRequestSchema.parse(request.body ?? {});
    const actor = request.user ? `user:${request.user.username}` : "user:unknown";
    const session = await compartments.reset(id, input.handoff, actor);
    return { workspace: await workspaces.get(id), session };
  });

  app.get("/api/workspaces/:id/sessions", async (request): Promise<SessionListResponse> => ({
    items: await compartments.sessions(idParam(request.params)),
  }));
}
