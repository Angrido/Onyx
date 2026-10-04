import {
  MemorySettingsSchema,
  PushSubscriptionRequestSchema,
  SavingsOptionsSchema,
  type SavingsOptionsDto,
  type MemorySettings,
  PushUnsubscribeRequestSchema,
  SaveClaudeTokenRequestSchema,
  TestNotificationRequestSchema,
  UpdateNotificationSettingsRequestSchema,
  type NotificationSettingsDto,
  type PushKeyResponse,
  type TestNotificationResponse,
  SubmitLoginCodeRequestSchema,
  type ClaudeAccountDto,
  type ClaudeLoginDto,
  type ClaudeTestResult,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";

function actorOf(request: FastifyRequest): string {
  return request.user ? `user:${request.user.username}` : "user:unknown";
}

export function registerSettingsRoutes(app: FastifyInstance, container: Container): void {
  const { credentials } = container;

  app.get("/api/settings/claude", async (): Promise<ClaudeAccountDto> => credentials.account());

  app.put("/api/settings/claude/token", async (request): Promise<ClaudeAccountDto> =>
    credentials.save(SaveClaudeTokenRequestSchema.parse(request.body).token, actorOf(request)),
  );

  app.delete("/api/settings/claude/token", async (request): Promise<ClaudeAccountDto> =>
    credentials.remove(actorOf(request)),
  );

  app.post("/api/settings/claude/test", async (request): Promise<ClaudeTestResult> =>
    credentials.test(actorOf(request)),
  );

  app.post("/api/settings/claude/check", async (): Promise<ClaudeAccountDto> => {
    await container.checkCli();
    return credentials.account();
  });

  app.post("/api/settings/claude/login", async (request, reply): Promise<ClaudeLoginDto> => {
    const login = credentials.startLogin(actorOf(request));
    reply.status(201);
    return login;
  });

  app.post("/api/settings/claude/login/code", async (request): Promise<ClaudeAccountDto> =>
    credentials.submitLoginCode(SubmitLoginCodeRequestSchema.parse(request.body).code),
  );

  app.post("/api/settings/claude/login/retry", async (): Promise<ClaudeAccountDto> =>
    credentials.retryLogin(),
  );

  app.delete("/api/settings/claude/login", async (): Promise<ClaudeAccountDto> =>
    credentials.cancelLogin(),
  );

  const { notifications, memory, options } = container;

  app.get("/api/settings/savings-options", async (): Promise<SavingsOptionsDto> => options.get());

  app.put("/api/settings/savings-options", async (request): Promise<SavingsOptionsDto> => {
    const saved = await options.update(SavingsOptionsSchema.parse(request.body ?? {}));
    container.scheduler.poke();
    container.savings.forget();
    return saved;
  });

  app.get("/api/settings/memory", async (): Promise<MemorySettings> => memory.settings());

  app.put("/api/settings/memory", async (request): Promise<MemorySettings> =>
    memory.updateSettings(MemorySettingsSchema.parse(request.body ?? {})),
  );

  app.get("/api/settings/notifications", async (): Promise<NotificationSettingsDto> =>
    notifications.settings(),
  );

  app.put("/api/settings/notifications", async (request): Promise<NotificationSettingsDto> =>
    notifications.update(UpdateNotificationSettingsRequestSchema.parse(request.body ?? {})),
  );

  app.post("/api/notifications/test", async (request): Promise<TestNotificationResponse> =>
    notifications.test(TestNotificationRequestSchema.parse(request.body ?? {}).channel),
  );

  app.get("/api/notifications/push/key", async (): Promise<PushKeyResponse> => ({
    publicKey: await notifications.publicKey(),
  }));

  app.post(
    "/api/notifications/push/subscriptions",
    async (request): Promise<NotificationSettingsDto> =>
      notifications.subscribe(
        PushSubscriptionRequestSchema.parse(request.body ?? {}),
        request.headers["user-agent"] ?? null,
      ),
  );

  app.post(
    "/api/notifications/push/unsubscribe",
    async (request): Promise<NotificationSettingsDto> =>
      notifications.unsubscribe(PushUnsubscribeRequestSchema.parse(request.body ?? {}).endpoint),
  );
}
