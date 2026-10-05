import {
  ContextExperimentSettingsSchema,
  MoveQueuedRequestSchema,
  ProjectRunLimitRequestSchema,
  QueueSettingsSchema,
  QuotaSettingsSchema,
  SearchQuerySchema,
  type SearchResponse,
  type MissionControlDto,
  type QueueDto,
  type QuotaDto,
  type CatalogResponse,
  type ContextExperimentSettings,
  type HealthResponse,
  type NetworkInfo,
  type ReadyResponse,
  type SavingsReport,
  type TelemetrySummary,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { describeNetwork } from "../../infrastructure/network";

export function registerSystemRoutes(app: FastifyInstance, container: Container): void {
  app.get("/api/health", { config: { public: true } }, async (): Promise<HealthResponse> => ({
    status: "ok",
    uptimeSec: Math.round(process.uptime()),
  }));

  app.get(
    "/api/ready",
    { config: { public: true } },
    async (_request, reply): Promise<ReadyResponse> => {
      const readiness = await container.readiness();
      if (!readiness.ready) reply.status(503);
      return readiness;
    },
  );

  app.get("/api/catalog", async (): Promise<CatalogResponse> => container.catalog.catalog());

  app.get("/api/telemetry/summary", async (): Promise<TelemetrySummary> =>
    container.telemetry.summary(),
  );

  app.get("/api/quota", async (): Promise<QuotaDto> => container.quota.dto());

  app.put("/api/quota/settings", async (request): Promise<QuotaDto> =>
    container.quota.updateSettings(QuotaSettingsSchema.parse(request.body ?? {})),
  );

  app.post("/api/quota/resume", async (): Promise<QuotaDto> => container.quota.resume());

  app.get("/api/mission-control", async (): Promise<MissionControlDto> =>
    container.mission.overview(),
  );

  app.get("/api/search", async (request): Promise<SearchResponse> => {
    const query = SearchQuerySchema.parse(request.query);
    return container.search.search(query.q, {
      limit: query.limit,
      ...(query.projectId ? { projectId: query.projectId } : {}),
    });
  });

  app.get("/api/queue", async (): Promise<QueueDto> => container.queue.dto());

  app.put("/api/queue/settings", async (request): Promise<QueueDto> =>
    container.queue.updateSettings(QueueSettingsSchema.parse(request.body ?? {})),
  );

  app.post("/api/queue/:taskId/move", async (request): Promise<QueueDto> => {
    const { taskId } = request.params as { taskId: string };
    return container.queue.move(taskId, MoveQueuedRequestSchema.parse(request.body ?? {}).to);
  });

  app.put("/api/queue/projects/:projectId", async (request): Promise<QueueDto> => {
    const { projectId } = request.params as { projectId: string };
    return container.queue.setProjectLimit(
      projectId,
      ProjectRunLimitRequestSchema.parse(request.body ?? {}).limit,
    );
  });

  app.get("/api/telemetry/savings", async (): Promise<SavingsReport> => container.savings.report());

  app.get("/api/telemetry/savings/experiment", async (): Promise<ContextExperimentSettings> =>
    container.savings.experimentSettings(),
  );

  app.put(
    "/api/telemetry/savings/experiment",
    async (request): Promise<ContextExperimentSettings> =>
      container.savings.updateExperiment(
        ContextExperimentSettingsSchema.parse(request.body),
        request.user ? `user:${request.user.username}` : "user:unknown",
      ),
  );

  app.get("/api/system/network", async (request): Promise<NetworkInfo> =>
    describeNetwork(request.protocol, request.host),
  );
}
