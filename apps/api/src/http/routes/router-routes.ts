import {
  CreateRoutingRuleRequestSchema,
  RouterPreviewRequestSchema,
  RoutingDecisionListQuerySchema,
  UpdateRouterSettingsRequestSchema,
  UpdateRoutingRuleRequestSchema,
  type RouterPreviewResponse,
  type RouterSettingsDto,
  type RoutingDecisionListResponse,
  type RoutingRuleDto,
  type RoutingRuleListResponse,
  type RoutingTelemetry,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { localizeRationale } from "../../domain/routing/rationale";
import { idParam } from "../params";

const ProjectScopeSchema = z.object({ projectId: z.string().min(1).max(64).optional() });

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerRouterRoutes(app: FastifyInstance, container: Container): void {
  const { router } = container;

  app.get("/api/router/settings", async (): Promise<RouterSettingsDto> => router.settings());

  app.put("/api/router/settings", async (request): Promise<RouterSettingsDto> =>
    router.updateSettings(UpdateRouterSettingsRequestSchema.parse(request.body), actorOf(request)),
  );

  app.get("/api/routing-rules", async (request): Promise<RoutingRuleListResponse> => ({
    items: await router.listRules(ProjectScopeSchema.parse(request.query).projectId ?? null),
  }));

  app.post("/api/routing-rules", async (request, reply): Promise<RoutingRuleDto> => {
    const rule = await router.createRule(
      CreateRoutingRuleRequestSchema.parse(request.body),
      actorOf(request),
    );
    reply.status(201);
    return rule;
  });

  app.patch("/api/routing-rules/:id", async (request): Promise<RoutingRuleDto> =>
    router.updateRule(
      idParam(request.params),
      UpdateRoutingRuleRequestSchema.parse(request.body),
      actorOf(request),
    ),
  );

  app.delete("/api/routing-rules/:id", async (request, reply): Promise<void> => {
    await router.deleteRule(idParam(request.params), actorOf(request));
    reply.status(204);
  });

  app.post("/api/router/preview", async (request): Promise<RouterPreviewResponse> => {
    const { evaluation, workspace, inferred, source } = await router.preview(
      RouterPreviewRequestSchema.parse(request.body),
    );
    return {
      decision: {
        id: null,
        taskId: null,
        taskTitle: null,
        strategy: evaluation.plan.strategy,
        tier: evaluation.tier,
        modelId: evaluation.modelId,
        rationale: localizeRationale(evaluation.rationale),
        score: evaluation.plan.score?.value ?? null,
        confidence: evaluation.plan.confidence,
        ruleId: evaluation.plan.rule?.id ?? null,
        ruleName: evaluation.plan.rule?.name ?? null,
        features: evaluation.features,
        components: evaluation.components,
        createdAt: null,
      },
      workspaceId: workspace?.id ?? null,
      workspaceName: workspace?.name ?? null,
      workspaceInferred: inferred,
      workspaceSource: source,
      classifierUsed: evaluation.classifierUsed,
    };
  });

  app.get("/api/routing-decisions", async (request): Promise<RoutingDecisionListResponse> => {
    const query = RoutingDecisionListQuerySchema.parse(request.query);
    return { items: await router.decisions(query.projectId ?? null, query.limit) };
  });

  app.get("/api/telemetry/routing", async (request): Promise<RoutingTelemetry> =>
    router.telemetry(ProjectScopeSchema.parse(request.query).projectId ?? null),
  );
}
