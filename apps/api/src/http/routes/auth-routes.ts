import {
  LoginRequestSchema,
  SetupRequestSchema,
  type AuthStatusResponse,
  type MeResponse,
} from "@onyx/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../../container";
import { unauthorized } from "../../errors";
import { clearSessionCookie, setSessionCookie } from "../security";

function metadata(request: FastifyRequest) {
  return { userAgent: request.headers["user-agent"] ?? null, ip: request.ip };
}

export function registerAuthRoutes(app: FastifyInstance, container: Container): void {
  const { auth, config } = container;

  app.get(
    "/api/auth/status",
    { config: { public: true } },
    async (): Promise<AuthStatusResponse> => ({
      setupRequired: await auth.setupRequired(),
    }),
  );

  app.post(
    "/api/auth/setup",
    { config: { public: true, rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply): Promise<MeResponse> => {
      const input = SetupRequestSchema.parse(request.body);
      const session = await auth.setup(input.username, input.password, metadata(request));
      setSessionCookie(reply, session, config.cookieSecure);
      reply.status(201);
      return { user: session.user };
    },
  );

  app.post(
    "/api/auth/login",
    { config: { public: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply): Promise<MeResponse> => {
      const input = LoginRequestSchema.parse(request.body);
      const session = await auth.login(input.username, input.password, metadata(request));
      setSessionCookie(reply, session, config.cookieSecure);
      return { user: session.user };
    },
  );

  app.post("/api/auth/logout", { config: { public: true } }, async (request, reply) => {
    if (request.sessionToken) await auth.logout(request.sessionToken);
    clearSessionCookie(reply, config.cookieSecure);
    reply.status(204);
  });

  app.get("/api/auth/me", async (request): Promise<MeResponse> => {
    if (!request.user) throw unauthorized();
    return { user: request.user };
  });
}
