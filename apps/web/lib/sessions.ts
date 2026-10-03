import type {
  ResetStrategy,
  RoutingStrategy,
  SessionEndReason,
  SessionStatus,
} from "@onyx/contracts";

export const END_REASON_LABELS: Record<SessionEndReason, string> = {
  DOMAIN_SWITCH: "Domain switch",
  CONTEXT_PRESSURE: "Context pressure",
  MODEL_CHANGE: "Model change",
  MANUAL_RESET: "Manual reset",
  COMPLETED: "Completed",
  ERROR: "Never started",
  BUDGET_EXCEEDED: "Budget exceeded",
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  ACTIVE: "Active",
  IDLE: "Idle",
  ROTATED: "Rotated",
  CLOSED: "Closed",
};

export const RESET_STRATEGY_LABELS: Record<ResetStrategy, { label: string; hint: string }> = {
  HARD: { label: "Hard", hint: "Fresh context on a domain switch, no handoff note" },
  HANDOFF: { label: "Handoff", hint: "Fresh context plus a handoff note of at most 1,500 tokens" },
  SOFT: { label: "Soft", hint: "Keep the session and compact it under context pressure" },
};

export const ROUTING_STRATEGY_LABELS: Record<RoutingStrategy, string> = {
  OVERRIDE: "Override",
  RULE: "Rule",
  HEURISTIC: "Heuristic",
  CLASSIFIER: "Classifier",
  ESCALATION: "Escalation",
  DEESCALATION: "De-escalation",
};
