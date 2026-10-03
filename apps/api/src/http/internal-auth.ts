import type { FastifyRequest } from "fastify";
import { forbidden, unauthorized } from "../errors";
import type { RunGrant, RunTokenRegistry } from "../infrastructure/run-tokens";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function assertLoopback(request: FastifyRequest): void {
  const remote = request.socket.remoteAddress ?? "";
  if (!LOOPBACK_ADDRESSES.has(remote) || request.headers["x-forwarded-for"] !== undefined) {
    throw forbidden("Internal endpoints accept loopback connections only");
  }
}

export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!match?.[1]) throw unauthorized("Missing run token");
  return match[1];
}

export function requireGrant(
  request: FastifyRequest,
  registry: RunTokenRegistry,
): { token: string; grant: RunGrant } {
  assertLoopback(request);
  const token = bearerToken(request.headers.authorization);
  const grant = registry.resolve(token);
  if (!grant) throw unauthorized("Unknown or expired run token");
  return { token, grant };
}
