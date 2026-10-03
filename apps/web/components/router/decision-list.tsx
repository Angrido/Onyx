"use client";

import type { RoutingDecisionDto, RoutingDecisionListResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import Link from "next/link";
import { ModelBadge, TierBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { topComponents, WEIGHT_LABELS } from "@/lib/router";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";

function signals(decision: RoutingDecisionDto): string | null {
  if (!decision.components) return null;
  const top = topComponents(decision.components);
  return top.length > 0
    ? top.map((entry) => `${WEIGHT_LABELS[entry.key].label} ${entry.value.toFixed(2)}`).join(" · ")
    : null;
}

export function DecisionList({ initial }: { initial: RoutingDecisionDto[] }) {
  const decisions = useQuery({
    queryKey: queryKeys.routingDecisions,
    queryFn: () => api.get<RoutingDecisionListResponse>("/api/routing-decisions?limit=30"),
    initialData: { items: initial },
    select: (data) => data.items,
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          Recent decisions
        </CardTitle>
        <CardDescription>One per run, with the rationale stored next to it.</CardDescription>
      </CardHeader>
      <CardContent>
        {decisions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No routed runs yet.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="routing-decisions">
            {decisions.data.map((decision) => {
              const detail = signals(decision);
              return (
                <li
                  key={decision.id ?? `${decision.taskId}-${decision.createdAt}`}
                  className="space-y-1 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {decision.taskId ? (
                      <Link
                        href={`/tasks/${decision.taskId}`}
                        className="min-w-0 max-w-full truncate font-medium hover:text-primary"
                      >
                        {decision.taskTitle ?? "Task"}
                      </Link>
                    ) : null}
                    <TierBadge tier={decision.tier} />
                    <ModelBadge modelId={decision.modelId} />
                    <Badge>
                      {ROUTING_STRATEGY_LABELS[decision.strategy]}
                      {decision.ruleName ? ` · ${decision.ruleName}` : ""}
                    </Badge>
                    {decision.score !== null ? (
                      <span className="tabular font-mono text-[11px] text-muted-foreground">
                        {decision.score.toFixed(2)}
                      </span>
                    ) : null}
                    {decision.createdAt ? (
                      <span className="ml-auto text-xs text-muted-foreground">
                        <RelativeTime iso={decision.createdAt} />
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{decision.rationale}</p>
                  {detail ? <p className="text-[11px] text-muted-foreground/80">{detail}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
