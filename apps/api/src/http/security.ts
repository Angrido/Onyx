import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService, IssuedSession } from "../application/auth-service";
import { forbidden, unauthorized } from "../errors";

export const SESSION_COOKIE = "onyx_sid";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface SecurityOptions {
  auth: AuthService;
  allowedOrigins: readonly string[];
  cookieSecure: boolean;
}

function isUpgrade(request: FastifyRequest): boolean {
  return request.headers.upgrade?.toLowerCase() === "websocket";
}

export function registerSecurity(app: FastifyInstance, options: SecurityOptions): void {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionToken", null);

  app.addHook("onRequest", async (request) => {
    const origin = request.headers.origin;
    const needsOriginCheck = !SAFE_METHODS.has(request.method) || isUpgrade(request);
    if (needsOriginCheck && origin !== undefined && !options.allowedOrigins.includes(origin)) {
      throw forbidden("Origin not allowed");
    }

    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const user = await options.auth.resolve(token);
    if (user) {
      request.user = user;
      request.sessionToken = token;
    }
  });

  app.addHook("preHandler", async (request) => {
    if (request.routeOptions.config.public === true) return;
    if (!request.user) throw unauthorized();
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  session: IssuedSession,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", secure, path: "/" });
}
