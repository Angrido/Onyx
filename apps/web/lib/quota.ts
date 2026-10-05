import type { QuotaDto, QuotaLevel } from "@onyx/contracts";
import { english, msg, type Translate } from "@/lib/i18n/core";

export type QuotaTone = "neutral" | "success" | "warning" | "danger";

export const QUOTA_LEVEL_STYLES: Record<QuotaLevel, { label: string; tone: QuotaTone }> = {
  UNKNOWN: { label: msg("Not reported"), tone: "neutral" },
  OK: { label: msg("Within limits"), tone: "success" },
  WARNING: { label: msg("Close to the limit"), tone: "warning" },
  HOLDING: { label: msg("Holding tasks that can wait"), tone: "warning" },
  LIMITED: { label: msg("Limit reached"), tone: "danger" },
};

const WINDOW_LABELS: Record<string, string> = {
  five_hour: msg("5-hour window"),
  seven_day: msg("Weekly limit"),
  seven_day_opus: msg("Weekly Opus limit"),
  seven_day_sonnet: msg("Weekly Sonnet limit"),
  overage: msg("Extra usage"),
  subscription: msg("Subscription limit"),
};

export function quotaWindowLabel(type: string, t: Translate = english): string {
  const label = WINDOW_LABELS[type];
  return label === undefined ? type.replaceAll("_", " ") : t(label);
}

const STATUS_LABELS: Record<string, string> = {
  allowed: msg("allowed"),
  allowed_warning: msg("warning"),
  rejected: msg("limit reached"),
};

export function quotaStatusLabel(status: string, t: Translate = english): string {
  const label = STATUS_LABELS[status];
  return label === undefined ? status.replaceAll("_", " ") : t(label);
}

const resetFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatReset(iso: string | null, t: Translate = english): string {
  return iso === null ? t("unknown") : resetFormat.format(new Date(iso));
}

export function isQuotaAlert(level: QuotaLevel | undefined): boolean {
  return level === "WARNING" || level === "HOLDING" || level === "LIMITED";
}

export function peakUtilization(quota: QuotaDto): number | null {
  const values = quota.windows
    .filter((window) => !window.stale && window.utilization !== null)
    .map((window) => window.utilization ?? 0);
  return values.length === 0 ? null : Math.max(...values);
}
