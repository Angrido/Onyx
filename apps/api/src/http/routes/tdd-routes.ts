import {
  StartTddLoopRequestSchema,
  type TddDefaultsDto,
  type TddLoopDto,
  type TddLoopListResponse,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerTddRoutes(app: FastifyInstance, container: Container): void {
  const { tdd } = container;

  app.get("/api/tasks/:id/tdd/defaults", async (request): Promise<TddDefaultsDto> =>
    tdd.defaults(idParam(request.params)),
  );

  app.get("/api/tasks/:id/tdd", async (request): Promise<TddLoopListResponse> => ({
    items: await tdd.list(idParam(request.params)),
  }));

  app.post("/api/tasks/:id/tdd", async (request, reply): Promise<TddLoopDto> => {
    const loop = await tdd.start(
      idParam(request.params),
      StartTddLoopRequestSchema.parse(request.body ?? {}),
      actorOf(request),
    );
    reply.status(201);
    return loop;
  });

  app.get("/api/tdd-loops/:id", async (request): Promise<TddLoopDto> =>
    tdd.get(idParam(request.params)),
  );

  app.post("/api/tdd-loops/:id/abort", async (request): Promise<TddLoopDto> =>
    tdd.abort(idParam(request.params), actorOf(request)),
  );
}
