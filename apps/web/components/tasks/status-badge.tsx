"use client";

import type { ModelTier, RunStatus, TaskStatus } from "@onyx/contracts";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { msg } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/client";
import { TIER_STYLES, modelLabel, tierOfModel } from "@/lib/tiers";

type Tone = NonNullable<BadgeProps["tone"]>;

const TASK_TONES: Record<TaskStatus, Tone> = {
  DRAFT: "neutral",
  PLANNING: "primary",
  AWAITING_APPROVAL: "warning",
  QUEUED: "warning",
  RUNNING: "primary",
  TDD_LOOP: "primary",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  INTERRUPTED: "warning",
};

const RUN_TONES: Record<RunStatus, Tone> = {
  SPAWNING: "primary",
  RUNNING: "primary",
  COMPLETED: "success",
  FAILED: "danger",
  ABORTED: "neutral",
  TIMEOUT: "warning",
  INTERRUPTED: "warning",
};

const TASK_LABELS: Record<TaskStatus, string> = {
  DRAFT: msg("Draft"),
  PLANNING: msg("Planning"),
  AWAITING_APPROVAL: msg("Awaiting approval"),
  QUEUED: msg("Queued"),
  RUNNING: msg("Running"),
  TDD_LOOP: msg("Tdd loop"),
  COMPLETED: msg("Completed"),
  FAILED: msg("Failed"),
  CANCELLED: msg("Cancelled"),
  INTERRUPTED: msg("Interrupted"),
};

const RUN_LABELS: Record<RunStatus, string> = {
  SPAWNING: msg("Spawning"),
  RUNNING: msg("Running"),
  COMPLETED: msg("Completed"),
  FAILED: msg("Failed"),
  ABORTED: msg("Aborted"),
  TIMEOUT: msg("Timeout"),
  INTERRUPTED: msg("Interrupted"),
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const t = useT();
  return <Badge tone={TASK_TONES[status]}>{t(TASK_LABELS[status])}</Badge>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useT();
  return <Badge tone={RUN_TONES[status]}>{t(RUN_LABELS[status])}</Badge>;
}

const TIER_TONES: Record<ModelTier, Tone> = {
  ARCHITECT: "architect",
  BUILDER: "builder",
  SCOUT: "scout",
  APEX: "apex",
};

export function ModelBadge({ modelId }: { modelId: string }) {
  const t = useT();
  const tier = tierOfModel(modelId);
  return (
    <Badge tone={TIER_TONES[tier]} title={t(TIER_STYLES[tier].label)}>
      {modelLabel(modelId)}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: ModelTier }) {
  const t = useT();
  return <Badge tone={TIER_TONES[tier]}>{t(TIER_STYLES[tier].label)}</Badge>;
}
