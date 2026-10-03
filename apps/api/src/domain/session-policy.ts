import type { SessionEndReason, SessionStatus } from "@onyx/contracts";

export interface ActiveSessionView {
  id: string;
  modelId: string;
  status: SessionStatus;
  contextTokens: number;
  established: boolean;
}

export interface SessionRequest {
  modelId: string;
  forceNew: boolean;
  maxSessionTokens: number;
}

export type SessionDecision =
  | { action: "resume"; sessionId: string }
  | { action: "start"; rotate: { sessionId: string; reason: SessionEndReason } | null };

export function decideSession(
  active: ActiveSessionView | null,
  request: SessionRequest,
): SessionDecision {
  if (active === null || active.status === "ROTATED" || active.status === "CLOSED") {
    return { action: "start", rotate: null };
  }
  if (!active.established) {
    return { action: "start", rotate: { sessionId: active.id, reason: "ERROR" } };
  }
  if (request.forceNew) {
    return { action: "start", rotate: { sessionId: active.id, reason: "MANUAL_RESET" } };
  }
  if (active.modelId !== request.modelId) {
    return { action: "start", rotate: { sessionId: active.id, reason: "MODEL_CHANGE" } };
  }
  if (active.contextTokens >= request.maxSessionTokens) {
    return { action: "start", rotate: { sessionId: active.id, reason: "CONTEXT_PRESSURE" } };
  }
  return { action: "resume", sessionId: active.id };
}
