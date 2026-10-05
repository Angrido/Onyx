"use client";

import type { ApprovalListResponse, ServerMessage } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { msg } from "@/lib/i18n/core";
import { useQuota } from "@/lib/live";
import { badgeText } from "@/lib/nav";
import { QUOTA_LEVEL_STYLES, isQuotaAlert, peakUtilization } from "@/lib/quota";
import { cn } from "@/lib/utils";
import { useChannel, useConnectionState } from "@/lib/ws/context";

const CONNECTION_STYLES = {
  open: { dot: "bg-success", label: msg("Live") },
  connecting: { dot: "bg-warning animate-pulse", label: msg("Connecting") },
  closed: { dot: "bg-destructive", label: msg("Offline") },
} as const;

export function usePendingApprovals(): number {
  const queryClient = useQueryClient();
  const { data = 0 } = useQuery({
    queryKey: queryKeys.approvalsPending,
    queryFn: () =>
      api
        .get<ApprovalListResponse>("/api/approvals?status=PENDING&limit=1")
        .then((page) => page.pending),
  });
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "approvals.changed")
        queryClient.setQueryData(queryKeys.approvalsPending, message.data.pending);
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);
  return data;
}

export function useLogout(): () => Promise<void> {
  const router = useRouter();
  return useCallback(async () => {
    await api.post("/api/auth/logout");
    router.replace("/login");
    router.refresh();
  }, [router]);
}

export function PendingBadge({
  count,
  compact,
  announce = true,
}: {
  count: number;
  compact: boolean;
  announce?: boolean;
}) {
  const t = useT();
  if (count === 0) return null;
  return (
    <motion.span
      key={count}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      data-testid="approvals-badge"
      className={cn(
        "grid place-items-center rounded-full bg-warning font-semibold text-background",
        compact
          ? "absolute -right-2 -top-1.5 h-4 min-w-4 px-1 text-[9px]"
          : "relative ml-auto h-5 min-w-5 px-1.5 text-[10px]",
      )}
    >
      <span aria-hidden="true">{badgeText(count)}</span>
      {announce ? <span className="sr-only">{t("{count} waiting", { count })}</span> : null}
    </motion.span>
  );
}

export function ConnectionIndicator({ className }: { className?: string }) {
  const t = useT();
  const connection = CONNECTION_STYLES[useConnectionState()];
  return (
    <span
      role="status"
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <span className={cn("size-2 shrink-0 rounded-full", connection.dot)} aria-hidden="true" />
      {t(connection.label)}
    </span>
  );
}

const QUOTA_TEXT = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

export function QuotaIndicator({ compact }: { compact: boolean }) {
  const t = useT();
  const { data: quota } = useQuota();
  if (!quota || !isQuotaAlert(quota.level)) return null;
  const style = QUOTA_LEVEL_STYLES[quota.level];
  const peak = peakUtilization(quota);
  const used = peak === null ? null : t("{percent} used", { percent: formatPercent(peak) });
  const label = `${t("Claude limit: {status}", { status: t(style.label) })}${used === null ? "" : ` (${used})`}`;
  if (compact)
    return (
      <Link
        href="/telemetry#quota"
        aria-label={label}
        title={label}
        data-testid="quota-indicator-compact"
        className={cn(
          "grid size-11 place-items-center rounded-md transition-colors hover:bg-surface-3",
          QUOTA_TEXT[style.tone],
        )}
      >
        <Gauge className="size-4" />
      </Link>
    );
  return (
    <Link
      href="/telemetry#quota"
      data-testid="quota-indicator"
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-2.5 py-2 text-xs transition-colors hover:bg-surface-2",
        QUOTA_TEXT[style.tone],
      )}
    >
      <Gauge className="size-4 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium">{t(style.label)}</span>
        <span className="block text-muted-foreground">
          {t("Claude limit")}
          {used === null ? "" : ` · ${used}`}
        </span>
      </span>
    </Link>
  );
}
