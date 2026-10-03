"use client";

import type { TelemetrySummary } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { Bot, Coins, Database, Gauge } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent, formatTokens, formatUsd } from "@/lib/format";
import { useLiveSystem } from "@/lib/live";

function Tile({
  icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div
        className="pointer-events-none absolute -top-12 -right-12 size-32 rounded-full opacity-25 blur-2xl"
        style={{ background: accent }}
      />
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-3 h-9 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={value}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="tabular text-3xl font-semibold tracking-tight"
          >
            {value}
          </motion.p>
        </AnimatePresence>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

export function KpiTiles({ initial }: { initial: TelemetrySummary }) {
  useLiveSystem();
  const { data } = useQuery({
    queryKey: queryKeys.telemetry,
    queryFn: () => api.get<TelemetrySummary>("/api/telemetry/summary"),
    initialData: initial,
    refetchInterval: 30_000,
  });
  const today = data.today;
  const totalTokens =
    today.usage.inputTokens +
    today.usage.outputTokens +
    today.usage.cacheReadTokens +
    today.usage.cacheCreationTokens;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        icon={<Bot className="size-3.5" />}
        label="Active agents"
        value={String(data.activeRuns)}
        detail={`${data.queuedTasks} queued`}
        accent="var(--primary)"
      />
      <Tile
        icon={<Coins className="size-3.5" />}
        label="Spend today"
        value={formatUsd(today.costUsd)}
        detail={`${today.runs} runs · ${formatUsd(data.last7Days.costUsd)} in 7 days`}
        accent="var(--tier-builder)"
      />
      <Tile
        icon={<Database className="size-3.5" />}
        label="Tokens today"
        value={formatTokens(totalTokens)}
        detail={`${formatTokens(today.usage.outputTokens)} generated`}
        accent="var(--tier-scout)"
      />
      <Tile
        icon={<Gauge className="size-3.5" />}
        label="Cache hit ratio"
        value={formatPercent(today.cacheHitRatio)}
        detail={`${formatTokens(today.usage.cacheReadTokens)} tokens from cache`}
        accent="var(--success)"
      />
    </div>
  );
}
