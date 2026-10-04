import type { QueueDto, QueueItemKind, QueueWaitReason } from "@onyx/contracts";
import { english, msg, type Translate } from "@/lib/i18n/core";

export const WAIT_LABELS: Record<QueueWaitReason, string> = {
  SLOTS: msg("waiting for a free slot"),
  PROJECT: msg("project at its run limit"),
  WORKSPACE: msg("workspace busy"),
  QUOTA: msg("held by the quota or a budget"),
};

export const KIND_LABELS: Record<QueueItemKind, string | null> = {
  TASK: null,
  TDD: msg("TDD fix"),
  PLAN: msg("Plan step"),
};

export const AGING_OPTIONS = [
  { label: msg("Off"), minutes: 0 },
  { label: msg("Every 15 minutes"), minutes: 15 },
  { label: msg("Every 30 minutes"), minutes: 30 },
  { label: msg("Every hour"), minutes: 60 },
  { label: msg("Every 2 hours"), minutes: 120 },
] as const;

export function limitOptions(maxConcurrent: number): number[] {
  return Array.from({ length: Math.max(1, maxConcurrent) }, (_, index) => index + 1);
}

export function slotSummary(
  queue: Pick<QueueDto, "active" | "maxConcurrent" | "reservedSlots">,
  t: Translate = english,
) {
  const used = Math.min(queue.maxConcurrent, queue.active.length + queue.reservedSlots);
  const max = queue.maxConcurrent;
  const usage =
    max === 1
      ? t("{used} of 1 slot in use", { used })
      : t("{used} of {max} slots in use", { used, max });
  if (queue.reservedSlots === 0) return usage;
  return `${usage} · ${t("{count} held by terminals", { count: queue.reservedSlots })}`;
}

export function projectLimitLabel(limit: number | null, t: Translate = english): string {
  if (limit === null) return t("no limit");
  return limit === 1 ? t("at most 1 run") : t("at most {count} runs", { count: limit });
}
