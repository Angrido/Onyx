import {
  ApprovalListQuerySchema,
  CreateBudgetRequestSchema,
  CreateOrchestrationRequestSchema,
  DecideApprovalRequestSchema,
  UpdateBudgetRequestSchema,
  type ApprovalDto,
  type ApprovalListResponse,
  type BudgetDto,
  type BudgetListResponse,
  type OrchestrationDto,
  type OrchestrationListResponse,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { idParam } from "../params";

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerOrchestrationRoutes(app: FastifyInstance, container: Container): void {
  const { orchestrator, approvals, budgets } = container;

  app.get(
    "/api/projects/:id/orchestrations",
    async (request): Promise<OrchestrationListResponse> => ({
      items: await orchestrator.list(idParam(request.params)),
    }),
  );

  app.post(
    "/api/projects/:id/orchestrations",
    async (request, reply): Promise<OrchestrationDto> => {
      const created = await orchestrator.create(
        idParam(request.params),
        CreateOrchestrationRequestSchema.parse(request.body ?? {}),
        actorOf(request),
      );
      reply.status(201);
      return created;
    },
  );

  app.get("/api/orchestrations/:id", async (request): Promise<OrchestrationDto> =>
    orchestrator.get(idParam(request.params)),
  );

  app.post("/api/orchestrations/:id/approve", async (request): Promise<OrchestrationDto> =>
    orchestrator.approve(idParam(request.params), actorOf(request)),
  );

  app.post("/api/orchestrations/:id/reject", async (request): Promise<OrchestrationDto> =>
    orchestrator.reject(idParam(request.params), actorOf(request)),
  );

  app.post("/api/orchestrations/:id/cancel", async (request): Promise<OrchestrationDto> =>
    orchestrator.cancel(idParam(request.params), actorOf(request)),
  );

  app.post("/api/orchestrations/:id/resume", async (request): Promise<OrchestrationDto> =>
    orchestrator.resume(idParam(request.params), actorOf(request)),
  );

  app.get("/api/approvals", async (request): Promise<ApprovalListResponse> =>
    approvals.list(ApprovalListQuerySchema.parse(request.query ?? {})),
  );

  app.get("/api/approvals/:id", async (request): Promise<ApprovalDto> =>
    approvals.get(idParam(request.params)),
  );

  app.post("/api/approvals/:id/approve", async (request): Promise<ApprovalDto> => {
    const input = DecideApprovalRequestSchema.parse(request.body ?? {});
    return approvals.decide(
      idParam(request.params),
      "approve",
      actorOf(request),
      input.note ?? null,
    );
  });

  app.post("/api/approvals/:id/reject", async (request): Promise<ApprovalDto> => {
    const input = DecideApprovalRequestSchema.parse(request.body ?? {});
    return approvals.decide(
      idParam(request.params),
      "reject",
      actorOf(request),
      input.note ?? null,
    );
  });

  app.get("/api/budgets", async (): Promise<BudgetListResponse> => ({
    items: await budgets.list(),
  }));

  app.post("/api/budgets", async (request, reply): Promise<BudgetDto> => {
    const created = await budgets.create(CreateBudgetRequestSchema.parse(request.body ?? {}));
    reply.status(201);
    return created;
  });

  app.patch("/api/budgets/:id", async (request): Promise<BudgetDto> =>
    budgets.update(idParam(request.params), UpdateBudgetRequestSchema.parse(request.body ?? {})),
  );

  app.delete("/api/budgets/:id", async (request, reply) => {
    await budgets.remove(idParam(request.params));
    reply.status(204);
  });
}
