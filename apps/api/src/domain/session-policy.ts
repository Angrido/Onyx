import type { ResetStrategy, SessionEndReason, SessionStatus } from "@onyx/contracts";

export interface ActiveSessionView {
  id: string;
  modelId: string;
  status: SessionStatus;
  contextTokens: number;
  established: boolean;
  pending: boolean;
  lastActivityAt: Date;
}

export interface SessionRequest {
  modelId: string;
  forceNew: boolean;
  maxSessionTokens: number;
  foreignChangeAt: Date | null;
}

export interface SessionRotation {
  sessionId: string;
  reason: SessionEndReason;
}

export type SessionDecision =
  | { action: "resume"; sessionId: string }
  | { action: "start"; reuse: string | null; rotate: SessionRotation | null };

export function decideSession(
  active: ActiveSessionView | null,
  request: SessionRequest,
): SessionDecision {
  if (active === null || active.status === "ROTATED" || active.status === "CLOSED") {
    return { action: "start", reuse: null, rotate: null };
  }
  if (active.pending) {
    return request.forceNew
      ? { action: "start", reuse: null, rotate: { sessionId: active.id, reason: "MANUAL_RESET" } }
      : { action: "start", reuse: active.id, rotate: null };
  }
  const rotate = (reason: SessionEndReason): SessionDecision => ({
    action: "start",
    reuse: null,
    rotate: { sessionId: active.id, reason },
  });
  if (!active.established) return rotate("ERROR");
  if (request.forceNew) return rotate("MANUAL_RESET");
  if (active.modelId !== request.modelId) return rotate("MODEL_CHANGE");
  if (request.foreignChangeAt !== null && request.foreignChangeAt > active.lastActivityAt) {
    return rotate("DOMAIN_SWITCH");
  }
  if (active.contextTokens >= request.maxSessionTokens) return rotate("CONTEXT_PRESSURE");
  return { action: "resume", sessionId: active.id };
}

export function wantsHandoff(strategy: ResetStrategy, reason: SessionEndReason | null): boolean {
  if (reason === "MANUAL_RESET") return false;
  if (reason === "CONTEXT_PRESSURE") return true;
  return strategy !== "HARD";
}
