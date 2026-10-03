import type { ModelTier, RunStatus, TaskStatus } from "@onyx/contracts";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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

function humanize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={TASK_TONES[status]}>{humanize(status)}</Badge>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge tone={RUN_TONES[status]}>{humanize(status)}</Badge>;
}

const TIER_TONES: Record<ModelTier, Tone> = {
  ARCHITECT: "architect",
  BUILDER: "builder",
  SCOUT: "scout",
  APEX: "apex",
};

export function ModelBadge({ modelId }: { modelId: string }) {
  const tier = tierOfModel(modelId);
  return (
    <Badge tone={TIER_TONES[tier]} title={TIER_STYLES[tier].label}>
      {modelLabel(modelId)}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: ModelTier }) {
  return <Badge tone={TIER_TONES[tier]}>{TIER_STYLES[tier].label}</Badge>;
}
