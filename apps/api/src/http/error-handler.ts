import { ErrorCode, type ApiError } from "@onyx/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../errors";

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.BadRequest,
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  409: ErrorCode.Conflict,
  429: ErrorCode.TooManyRequests,
  503: ErrorCode.Unavailable,
};

function body(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send(
        body(
          ErrorCode.BadRequest,
          "Invalid request",
          error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        ),
      );
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
    }
    const statusCode =
      "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode < 500) {
      return reply
        .status(statusCode)
        .send(body(STATUS_CODES[statusCode] ?? ErrorCode.BadRequest, error.message));
    }
    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send(body(ErrorCode.Internal, "Internal server error"));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(body(ErrorCode.NotFound, `Route ${request.method} ${request.url} not found`));
  });
}
