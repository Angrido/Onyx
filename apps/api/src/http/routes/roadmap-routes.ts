import {
  AcceptRoadmapItemRequestSchema,
  GenerateRoadmapRequestSchema,
  type ProjectBoard,
  type RoadmapGenerationDto,
  type RoadmapItemDto,
  type TaskDto,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerRoadmapRoutes(app: FastifyInstance, container: Container): void {
  const { roadmap } = container;

  app.get("/api/projects/:id/board", async (request): Promise<ProjectBoard> =>
    roadmap.board(idParam(request.params)),
  );

  app.post("/api/projects/:id/roadmap", async (request, reply): Promise<RoadmapGenerationDto> => {
    const generation = await roadmap.generate(
      idParam(request.params),
      GenerateRoadmapRequestSchema.parse(request.body ?? {}),
      actorOf(request),
    );
    reply.status(202);
    return generation;
  });

  app.post("/api/roadmap-items/:id/accept", async (request, reply): Promise<TaskDto> => {
    const task = await roadmap.accept(
      idParam(request.params),
      AcceptRoadmapItemRequestSchema.parse(request.body ?? {}).workspaceId,
      actorOf(request),
    );
    reply.status(201);
    return task;
  });

  app.post("/api/roadmap-items/:id/dismiss", async (request): Promise<RoadmapItemDto> =>
    roadmap.dismiss(idParam(request.params)),
  );
}
