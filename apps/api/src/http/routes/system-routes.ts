import {
  ContextExperimentSettingsSchema,
  QuotaSettingsSchema,
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
