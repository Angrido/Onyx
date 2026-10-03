import { ErrorCode } from "@onyx/contracts";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, ErrorCode.BadRequest, message, details);

export const unauthorized = (message = "Authentication required"): AppError =>
  new AppError(401, ErrorCode.Unauthorized, message);

export const forbidden = (message = "Forbidden"): AppError =>
  new AppError(403, ErrorCode.Forbidden, message);

export const notFound = (resource: string): AppError =>
  new AppError(404, ErrorCode.NotFound, `${resource} not found`);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, ErrorCode.Conflict, message, details);
