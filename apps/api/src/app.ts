import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Container } from "./container";
import "./http/fastify-types";
import { registerErrorHandling } from "./http/error-handler";
import { registerAuthRoutes } from "./http/routes/auth-routes";
import { registerProjectRoutes } from "./http/routes/project-routes";
import { registerSystemRoutes } from "./http/routes/system-routes";
import { registerTaskRoutes } from "./http/routes/task-routes";
import { registerWsRoutes } from "./http/routes/ws-routes";
import { registerSecurity } from "./http/security";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_WS_MESSAGE_BYTES = 64 * 1024;

export async function buildApp(container: Container): Promise<FastifyInstance> {
  const loggerInstance: FastifyBaseLogger = container.logger;
  const app = Fastify({
    loggerInstance,
    bodyLimit: MAX_BODY_BYTES,
    trustProxy: "127.0.0.1",
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: MAX_WS_MESSAGE_BYTES } });

  registerErrorHandling(app);
  registerSecurity(app, {
    auth: container.auth,
    allowedOrigins: container.config.allowedOrigins,
    cookieSecure: container.config.cookieSecure,
  });

  registerSystemRoutes(app, container);
  registerAuthRoutes(app, container);
  registerProjectRoutes(app, container);
  registerTaskRoutes(app, container);
  registerWsRoutes(app, container);

  return app;
}
