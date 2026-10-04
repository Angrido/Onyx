import type { QuotaDto, QuotaLevel } from "@onyx/contracts";

export type QuotaTone = "neutral" | "success" | "warning" | "danger";

export const QUOTA_LEVEL_STYLES: Record<QuotaLevel, { label: string; tone: QuotaTone }> = {
  UNKNOWN: { label: "Not reported", tone: "neutral" },
  OK: { label: "Within limits", tone: "success" },
  WARNING: { label: "Close to the limit", tone: "warning" },
  HOLDING: { label: "Holding tasks that can wait", tone: "warning" },
  LIMITED: { label: "Limit reached", tone: "danger" },
};

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-hour window",
  seven_day: "Weekly limit",
  seven_day_opus: "Weekly Opus limit",
  seven_day_sonnet: "Weekly Sonnet limit",
  overage: "Extra usage",
  subscription: "Subscription limit",
};

export function quotaWindowLabel(type: string): string {
  return WINDOW_LABELS[type] ?? type.replaceAll("_", " ");
}

const STATUS_LABELS: Record<string, string> = {
  allowed: "allowed",
  allowed_warning: "warning",
  rejected: "limit reached",
};

export function quotaStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

const resetFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatReset(iso: string | null): string {
  return iso === null ? "unknown" : resetFormat.format(new Date(iso));
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
