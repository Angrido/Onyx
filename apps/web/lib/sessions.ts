import type {
  ResetStrategy,
  RoutingStrategy,
  SessionEndReason,
  SessionStatus,
} from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";

export const END_REASON_LABELS: Record<SessionEndReason, string> = {
  DOMAIN_SWITCH: msg("Domain switch"),
  CONTEXT_PRESSURE: msg("Context pressure"),
  MODEL_CHANGE: msg("Model change"),
  MANUAL_RESET: msg("Manual reset"),
  COMPLETED: msg("Completed"),
  ERROR: msg("Never started"),
  BUDGET_EXCEEDED: msg("Budget exceeded"),
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  ACTIVE: msg("Active"),
  IDLE: msg("Idle"),
  ROTATED: msg("Rotated"),
  CLOSED: msg("Closed"),
};

export const RESET_STRATEGY_LABELS: Record<ResetStrategy, { label: string; hint: string }> = {
  HARD: { label: msg("Hard"), hint: msg("Fresh context on a domain switch, no handoff note") },
  HANDOFF: {
    label: msg("Handoff"),
    hint: msg("Fresh context plus a handoff note of at most 1,500 tokens"),
  },
  SOFT: { label: msg("Soft"), hint: msg("Keep the session and compact it under context pressure") },
};

export const ROUTING_STRATEGY_LABELS: Record<RoutingStrategy, string> = {
  OVERRIDE: msg("Override"),
  RULE: msg("Rule"),
  HEURISTIC: msg("Heuristic"),
  CLASSIFIER: msg("Classifier"),
  ESCALATION: msg("Escalation"),
  DEESCALATION: msg("De-escalation"),
};
