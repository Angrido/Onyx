import {
  AllowAndContinueRequestSchema,
  CreateTaskRequestSchema,
  ListTasksQuerySchema,
  RunEventsQuerySchema,
  RunTaskRequestSchema,
  UpdateTaskRequestSchema,
  type BlockedCommandsResponse,
  type RunDto,
  type RunEventsResponse,
  type RunTaskResponse,
  type TaskDetailDto,
  type TaskDto,
  type TaskListResponse,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { continuePrompt } from "../../domain/command-rules";
import { badRequest } from "../../errors";
import { idParam } from "../params";

export function registerTaskRoutes(app: FastifyInstance, container: Container): void {
  const { tasks, runs, projects } = container;

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

  app.patch("/api/tasks/:id", async (request): Promise<TaskDto> =>
    tasks.update(idParam(request.params), UpdateTaskRequestSchema.parse(request.body ?? {})),
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

  app.get("/api/runs/:id/blocked", async (request): Promise<BlockedCommandsResponse> =>
    runs.blockedCommands(idParam(request.params)),
  );

  app.post("/api/runs/:id/allow", async (request, reply): Promise<RunTaskResponse> => {
    const body = AllowAndContinueRequestSchema.parse(request.body ?? {});
    const runId = idParam(request.params);
    const blocked = await runs.blockedCommands(runId);
    const proposed = new Map(blocked.suggestions.map((entry) => [entry.rule, entry]));
    const unknown = body.rules.filter((rule) => !proposed.has(rule));
    if (unknown.length > 0)
      throw badRequest(
        `Only the rules proposed for the refused commands can be allowed here: ${unknown.join(", ")}`,
      );
    await projects.grant({
      projectId: blocked.projectId,
      rules: body.rules
        .filter((rule) => !proposed.get(rule)?.allowed)
        .map((rule) => ({ rule, command: proposed.get(rule)?.command ?? null })),
      scope: body.scope,
      taskId: blocked.taskId,
      agentConfigId: blocked.agentConfigId,
      expiresAt:
        body.expiresInHours === null
          ? null
          : new Date(Date.now() + body.expiresInHours * 3_600_000),
      actor: request.user ? `user:${request.user.username}` : "user:unknown",
    });
    const response = await tasks.requestRun(blocked.taskId, {
      prompt: continuePrompt(body.rules, body.reply),
      newSession: false,
    });
    reply.status(202);
    return response;
  });

  app.delete("/api/projects/:id/command-grants/:grantId", async (request, reply) => {
    const params = request.params as { grantId?: unknown };
    if (typeof params.grantId !== "string" || params.grantId.length === 0)
      throw badRequest("Missing grant id");
    await projects.revokeGrant(
      idParam(request.params),
      params.grantId,
      request.user ? `user:${request.user.username}` : "user:unknown",
    );
    reply.status(204);
  });
}
