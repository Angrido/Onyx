import {
  SaveClaudeTokenRequestSchema,
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
}
