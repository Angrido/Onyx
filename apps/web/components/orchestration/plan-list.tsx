"use client";

import type { OrchestrationDto, OrchestrationListResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitMerge, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatUsd } from "@/lib/format";
import {
  isPlanActive,
  PLAN_STATUS_LABELS,
  PLAN_STATUS_TONES,
  planProgress,
} from "@/lib/orchestration";

function PlanRow({ plan }: { plan: OrchestrationDto }) {
  const progress = planProgress(plan.nodes);
  return (
    <Link
      href={`/projects/${plan.projectId}/plans/${plan.id}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/60"
      data-testid="plan-row"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PLAN_STATUS_TONES[plan.status]}>
            {isPlanActive(plan) ? <Loader2 className="size-3 animate-spin" /> : null}
            {PLAN_STATUS_LABELS[plan.status]}
          </Badge>
          {plan.workBranch ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <GitMerge className="size-3" />
              {plan.workBranch}
            </span>
          ) : null}
        </div>
        <p className="truncate text-sm font-medium">{plan.goal}</p>
      </div>
      <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
        <p>{progress.total > 0 ? `${progress.merged}/${progress.total} merged` : "No tasks yet"}</p>
        <p>
          {formatUsd(plan.costUsd)} · <RelativeTime iso={plan.createdAt} />
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function PlanList({
  projectId,
  initial,
}: {
  projectId: string;
  initial: OrchestrationDto[];
}) {
  const { data: plans = initial } = useQuery({
    queryKey: queryKeys.orchestrations(projectId),
    queryFn: () =>
      api
        .get<OrchestrationListResponse>(`/api/projects/${projectId}/orchestrations`)
        .then((page) => page.items),
    initialData: initial,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((plan) => isPlanActive(plan)) ? 5_000 : false,
  });
  if (plans.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight">Plans</h2>
      <Card className="divide-y divide-border overflow-hidden">
        {plans.slice(0, 8).map((plan) => (
          <PlanRow key={plan.id} plan={plan} />
        ))}
      </Card>
    </section>
  );
}
