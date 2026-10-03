import type {
  CatalogResponse,
  HealthResponse,
  ReadyResponse,
  TelemetrySummary,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";

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
}
