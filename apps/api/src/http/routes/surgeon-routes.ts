import {
  SaveProfileRequestSchema,
  SurgeonScopeQuerySchema,
  type CompiledPolicyDto,
  type ExportResponse,
  type MeasureResponse,
  type SuggestResponse,
  type SurgeonStateDto,
  type TokenCalibration,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

function scope(request: FastifyRequest): string | null {
  return SurgeonScopeQuerySchema.parse(request.query).workspaceId ?? null;
}

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerSurgeonRoutes(app: FastifyInstance, container: Container): void {
  const { surgeon } = container;

  app.get("/api/projects/:id/surgeon", async (request): Promise<SurgeonStateDto> =>
    surgeon.state(idParam(request.params), scope(request)),
  );

  app.put("/api/projects/:id/surgeon", async (request): Promise<SurgeonStateDto> =>
    surgeon.save(
      idParam(request.params),
      SaveProfileRequestSchema.parse(request.body),
      actorOf(request),
    ),
  );

  app.post("/api/projects/:id/surgeon/suggest", async (request): Promise<SuggestResponse> =>
    surgeon.suggest(idParam(request.params), scope(request)),
  );

  app.get("/api/projects/:id/surgeon/compiled", async (request): Promise<CompiledPolicyDto> =>
    surgeon.compile(idParam(request.params), scope(request)),
  );

  app.post("/api/projects/:id/surgeon/measure", async (request): Promise<MeasureResponse> =>
    surgeon.measure(idParam(request.params), scope(request)),
  );

  app.post("/api/projects/:id/surgeon/calibrate", async (request): Promise<TokenCalibration> =>
    surgeon.calibrate(idParam(request.params)),
  );

  app.post("/api/projects/:id/surgeon/export", async (request): Promise<ExportResponse> =>
    surgeon.export(idParam(request.params), actorOf(request)),
  );
}
