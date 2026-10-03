import {
  CreateTaskRequestSchema,
  ListTasksQuerySchema,
  RunEventsQuerySchema,
  RunTaskRequestSchema,
  type RunDto,
  type RunEventsResponse,
  type RunTaskResponse,
  type TaskDetailDto,
  type TaskDto,
  type TaskListResponse,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

export function registerTaskRoutes(app: FastifyInstance, container: Container): void {
  const { tasks, runs } = container;

  app.get("/api/tasks", async (request): Promise<TaskListResponse> => ({
    items: await tasks.list(ListTasksQuerySchema.parse(request.query)),
  }));

  app.post("/api/tasks", async (request, reply): Promise<TaskDto> => {
    const task = await tasks.create(CreateTaskRequestSchema.parse(request.body));
    reply.status(201);
    return task;
  });

  app.get("/api/tasks/:id", async (request): Promise<TaskDetailDto> =>
    tasks.get(idParam(request.params)),
  );

  app.delete("/api/tasks/:id", async (request, reply) => {
    await tasks.remove(idParam(request.params));
    reply.status(204);
  });

  app.post("/api/tasks/:id/run", async (request, reply): Promise<RunTaskResponse> => {
    const response = await tasks.requestRun(
      idParam(request.params),
      RunTaskRequestSchema.parse(request.body ?? {}),
    );
    reply.status(202);
    return response;
  });

  app.post("/api/tasks/:id/cancel", async (request): Promise<TaskDto> =>
    tasks.cancel(
      idParam(request.params),
      request.user ? `user:${request.user.username}` : "user:unknown",
    ),
  );

  app.get("/api/runs/:id", async (request): Promise<RunDto> => runs.get(idParam(request.params)));

  app.get("/api/runs/:id/events", async (request): Promise<RunEventsResponse> => {
    const query = RunEventsQuerySchema.parse(request.query);
    return runs.events(idParam(request.params), query.after, query.limit);
  });

  app.post("/api/runs/:id/abort", async (request): Promise<RunDto> =>
    runs.abort(idParam(request.params)),
  );
}
