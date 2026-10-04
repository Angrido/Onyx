import type { RoutingTelemetry } from "@onyx/contracts";
import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, formatUsd } from "@/lib/format";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";
import { TIER_STYLES, modelLabel } from "@/lib/tiers";
import { cn } from "@/lib/utils";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-0/60 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="tabular text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function RoutingSavings({ telemetry }: { telemetry: RoutingTelemetry }) {
  const reference = telemetry.referenceModelId ? modelLabel(telemetry.referenceModelId) : "Opus";
  const saving = telemetry.savingRatio;
  const maxTierCost = Math.max(
    0.000001,
    ...telemetry.byTier.map((row) => Math.max(row.costUsd, row.counterfactualUsd)),
  );
  return (
    <Card data-testid="routing-savings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="size-4 text-success" />
          Cost per completed task vs all on {reference}
        </CardTitle>
        <CardDescription>
          Every run of the last {telemetry.windowDays} days is also priced as if it had run on{" "}
          {reference} with the same token usage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Stat
            label="Completed tasks"
            value={String(telemetry.completedTasks)}
            hint={`${formatUsd(telemetry.costUsd)} spent`}
          />
          <Stat label="Routed, per task" value={formatUsd(telemetry.costPerCompletedTask)} />
          <Stat
            label={`All ${reference}, per task`}
            value={formatUsd(telemetry.counterfactualPerCompletedTask)}
          />
          <Stat
            label="Saving"
            value={saving === null ? "—" : formatPercent(saving)}
            hint={
              saving === null
                ? "Complete a task to measure"
                : `${formatUsd(telemetry.counterfactualUsd - telemetry.costUsd)} less`
            }
          />
        </div>
        {telemetry.byTier.length > 0 ? (
          <div className="space-y-2.5">
            {telemetry.byTier.map((row) => {
              const style = TIER_STYLES[row.tier];
              return (
                <div key={row.tier} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3">
                  <span className={cn("text-xs font-medium", style.text)}>
                    {style.label}
                    <span className="ml-1 text-muted-foreground">· {row.runs} runs</span>
                  </span>
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(row.costUsd / maxTierCost) * 100}%`,
                          background: style.color,
                        }}
                      />
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-muted-foreground/40"
                        style={{ width: `${(row.counterfactualUsd / maxTierCost) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="tabular text-right text-xs">
                    {formatUsd(row.costUsd)}
                    <span className="block text-muted-foreground">
                      vs {formatUsd(row.counterfactualUsd)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {telemetry.byStrategy.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {telemetry.byStrategy.map((row) => (
              <span
                key={row.strategy}
                className="rounded-full border border-border bg-surface-1 px-2.5 py-1 text-muted-foreground"
              >
                {ROUTING_STRATEGY_LABELS[row.strategy]}{" "}
                <span className="tabular font-medium text-foreground">{row.decisions}</span>
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
