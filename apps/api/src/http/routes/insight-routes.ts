import {
  AskInsightRequestSchema,
  FindingTaskRequestSchema,
  type IdeationDto,
  type InsightDto,
  type InsightListResponse,
  type TaskDto,
} from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

export function registerInsightRoutes(app: FastifyInstance, container: Container): void {
  const { insights, ideation } = container;

  app.get("/api/projects/:id/insights", async (request): Promise<InsightListResponse> =>
    insights.list(idParam(request.params)),
  );

  app.post("/api/projects/:id/insights", async (request, reply): Promise<InsightDto> => {
    const answer = await insights.ask(
      idParam(request.params),
      AskInsightRequestSchema.parse(request.body),
    );
    reply.status(201);
    return answer;
  });

  app.get("/api/projects/:id/ideation", async (request): Promise<IdeationDto> =>
    ideation.latest(idParam(request.params)),
  );

  app.post("/api/projects/:id/ideation", async (request, reply): Promise<IdeationDto> => {
    const started = await ideation.start(idParam(request.params));
    reply.status(202);
    return started;
  });

  app.post("/api/projects/:id/ideation/review", async (request): Promise<IdeationDto> =>
    ideation.review(idParam(request.params)),
  );

  app.post("/api/ideation/findings/:id/dismiss", async (request): Promise<IdeationDto> =>
    ideation.dismiss(idParam(request.params)),
  );

  app.post("/api/ideation/findings/:id/task", async (request, reply): Promise<TaskDto> => {
    const task = await ideation.task(
      idParam(request.params),
      FindingTaskRequestSchema.parse(request.body ?? {}),
    );
    reply.status(201);
    return task;
  });
}
