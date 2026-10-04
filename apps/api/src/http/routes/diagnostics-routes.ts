import {
  LogQuerySchema,
  type DiagnosticsBundle,
  type LogListResponse,
  type ProjectHealthReport,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import { diagnosticsFileName } from "../../application/diagnostics-service";
import type { Container } from "../../container";
import { idParam } from "../params";

export function registerDiagnosticsRoutes(app: FastifyInstance, container: Container): void {
  app.get("/api/projects/:id/health", async (request): Promise<ProjectHealthReport> =>
    container.health.report(idParam(request.params)),
  );

  app.get("/api/logs", async (request): Promise<LogListResponse> => {
    const query = LogQuerySchema.parse(request.query ?? {});
    return container.logs.query({
      level: query.level,
      runId: query.runId,
      q: query.q,
      limit: query.limit,
    });
  });

  app.get("/api/diagnostics", async (): Promise<DiagnosticsBundle> =>
    container.diagnostics.bundle(),
  );

  app.get("/api/diagnostics/download", async (_request, reply) => {
    const bundle = await container.diagnostics.bundle();
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="${diagnosticsFileName(new Date(bundle.generatedAt))}"`,
    );
    reply.header("cache-control", "no-store");
    return reply.send(`${JSON.stringify(bundle, null, 2)}\n`);
  });
}
