import { HookInputSchema, type GuardItem } from "@onyx/contracts";
import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { requireGrant } from "../internal-auth";

interface PreToolUseOutput {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
  };
}

export function registerHookRoutes(app: FastifyInstance, container: Container): void {
  const { runTokens, executor, indexes, prisma } = container;

  app.post(
    "/internal/hooks/pre-tool-use",
    { config: { public: true } },
    async (request): Promise<PreToolUseOutput> => {
      const { grant } = requireGrant(request, runTokens);
      const parsed = HookInputSchema.safeParse(request.body);
      if (!parsed.success) return {};
      const input = parsed.data;
      const decision = grant.guard.evaluate({
        toolName: input.tool_name,
        toolInput: input.tool_input,
        cwd: input.cwd ?? null,
      });
      if (decision.allowed) return {};

      const rule = decision.rule
        ? `${decision.rule.action === "INCLUDE" ? "!" : ""}${decision.rule.pattern}`
        : null;
      const item: GuardItem = {
        kind: "guard",
        source: "hook",
        tool: input.tool_name,
        toolUseId: input.tool_use_id ?? null,
        target: decision.target,
        rule,
        reason: decision.reason,
      };
      executor.recordGuard(grant.runId, item);
      await prisma.auditLog
        .create({
          data: {
            actor: `run:${grant.runId}`,
            action: "guard.denied",
            target: decision.target,
            meta: { tool: input.tool_name, rule, projectId: grant.projectId },
          },
        })
        .catch((error: unknown) => request.log.warn({ err: error }, "Audit write failed"));
      request.log.info(
        { runId: grant.runId, tool: input.tool_name, target: decision.target, rule },
        "Tool call blocked by the context guard",
      );
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason ?? "Blocked by the Onyx context profile.",
        },
      };
    },
  );

  app.post(
    "/internal/hooks/post-tool-use",
    { config: { public: true } },
    async (request): Promise<Record<string, never>> => {
      const { grant } = requireGrant(request, runTokens);
      indexes.scheduleRefresh(grant.projectId);
      return {};
    },
  );
}
