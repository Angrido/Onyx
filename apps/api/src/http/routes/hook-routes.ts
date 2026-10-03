import {
  HookInputSchema,
  SessionStartInputSchema,
  StatusLineInputSchema,
  type GuardItem,
} from "@onyx/contracts";
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

interface SessionStartOutput {
  hookSpecificOutput?: {
    hookEventName: "SessionStart";
    additionalContext: string;
  };
}

export function registerHookRoutes(app: FastifyInstance, container: Container): void {
  const { runTokens, executor, indexes, prisma, terminals } = container;

  app.post(
    "/internal/hooks/pre-tool-use",
    { config: { public: true } },
    async (request): Promise<PreToolUseOutput> => {
      const { grant } = requireGrant(request, runTokens);
      const parsed = HookInputSchema.safeParse(request.body);
      if (!parsed.success) return {};
      const input = parsed.data;
      const call = {
        toolName: input.tool_name,
        toolInput: input.tool_input,
        cwd: input.cwd ?? null,
      };
      const readDecision = grant.guard.evaluate(call);
      const testDecision = readDecision.allowed && grant.tests ? grant.tests.evaluate(call) : null;
      const testDenial = testDecision && !testDecision.allowed ? testDecision : null;
      const fenceDecision =
        readDecision.allowed && !testDenial && grant.fence ? grant.fence.evaluate(call) : null;
      const decision = testDenial ?? fenceDecision ?? readDecision;
      if (decision.allowed) return {};

      const rule = testDenial
        ? testDenial.violation === "test-command"
          ? "TDD loop: test commands"
          : "TDD loop: protected tests"
        : fenceDecision
          ? `write fence (${grant.fence?.name ?? "workspace"})`
          : decision.rule
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
            actor: `${terminals.has(grant.runId) ? "terminal" : "run"}:${grant.runId}`,
            action: testDenial ? "tdd.denied" : fenceDecision ? "fence.denied" : "guard.denied",
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
      const parsed = HookInputSchema.safeParse(request.body);
      if (parsed.success)
        terminals.recordEdit(grant.runId, parsed.data.tool_name, parsed.data.tool_input);
      return {};
    },
  );

  app.post(
    "/internal/hooks/session-start",
    { config: { public: true } },
    async (request): Promise<SessionStartOutput> => {
      const { grant } = requireGrant(request, runTokens);
      const parsed = SessionStartInputSchema.safeParse(request.body);
      if (!parsed.success) return {};
      const context = await terminals.sessionStart(grant.runId, parsed.data);
      return context
        ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }
        : {};
    },
  );

  app.post(
    "/internal/hooks/user-prompt-submit",
    { config: { public: true } },
    async (request): Promise<Record<string, never>> => {
      const { grant } = requireGrant(request, runTokens);
      const body: unknown = request.body;
      if (typeof body === "object" && body !== null && "prompt" in body)
        terminals.recordPrompt(grant.runId, body.prompt);
      return {};
    },
  );

  app.post(
    "/internal/hooks/statusline",
    { config: { public: true } },
    async (request): Promise<{ text: string }> => {
      const { grant } = requireGrant(request, runTokens);
      const parsed = StatusLineInputSchema.safeParse(request.body ?? {});
      return { text: await terminals.statusLine(grant.runId, parsed.success ? parsed.data : {}) };
    },
  );
}
