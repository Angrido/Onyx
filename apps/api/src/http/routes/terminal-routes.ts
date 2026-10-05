import {
  InjectTerminalRequestSchema,
  OpenTerminalRequestSchema,
  TerminalListQuerySchema,
  TerminalTaskContextRequestSchema,
  type TerminalDto,
  type TerminalListResponse,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerTerminalRoutes(app: FastifyInstance, container: Container): void {
  const { terminals } = container;

  app.get("/api/terminals", async (request): Promise<TerminalListResponse> => {
    const query = TerminalListQuerySchema.parse(request.query);
    return {
      items: terminals.list({
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
      }),
    };
  });

  app.post("/api/workspaces/:id/terminal", async (request, reply): Promise<TerminalDto> => {
    const input = OpenTerminalRequestSchema.parse(request.body ?? {});
    const terminal = await terminals.open(idParam(request.params), input, actorOf(request));
    reply.status(201);
    return terminal;
  });

  app.get("/api/terminals/:id", async (request): Promise<TerminalDto> =>
    terminals.get(idParam(request.params)),
  );

  app.post("/api/terminals/:id/inject", async (request): Promise<TerminalDto> => {
    const input = InjectTerminalRequestSchema.parse(request.body ?? {});
    return terminals.inject(idParam(request.params), input.action, input.handoff, actorOf(request));
  });

  app.post("/api/terminals/:id/task-context", async (request): Promise<TerminalDto> =>
    terminals.injectTaskContext(
      idParam(request.params),
      TerminalTaskContextRequestSchema.parse(request.body ?? {}).taskId,
      actorOf(request),
    ),
  );

  app.delete("/api/terminals/:id", async (request): Promise<TerminalDto> =>
    terminals.close(idParam(request.params), actorOf(request)),
  );
}
