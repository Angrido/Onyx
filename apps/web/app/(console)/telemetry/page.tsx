import type {
  CatalogResponse,
  RoutingTelemetry,
  TelemetrySummary,
  UsageWindow,
} from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { RoutingSavings } from "@/components/router/routing-savings";
import { ModelBadge } from "@/components/tasks/status-badge";
import { KpiTiles } from "@/components/telemetry/kpi-tiles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serverFetch } from "@/lib/api/server";
import { formatPercent, formatTokens, formatUsd } from "@/lib/format";
import { TIER_STYLES } from "@/lib/tiers";

export const metadata = { title: "Telemetry" };

function WindowCard({ title, window }: { title: string; window: UsageWindow }) {
  const rows = [
    ["Runs", String(window.runs)],
    ["Cost", formatUsd(window.costUsd)],
    ["Input tokens", formatTokens(window.usage.inputTokens)],
    ["Output tokens", formatTokens(window.usage.outputTokens)],
    ["Cache read", formatTokens(window.usage.cacheReadTokens)],
    ["Cache write", formatTokens(window.usage.cacheCreationTokens)],
    ["Cache hit ratio", formatPercent(window.cacheHitRatio)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default async function TelemetryPage() {
  const [summary, catalog, routing] = await Promise.all([
    serverFetch<TelemetrySummary>("/api/telemetry/summary"),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<RoutingTelemetry>("/api/telemetry/routing"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Telemetry"
        title="Tokens and spend"
        description="Usage reported by Claude Code for every run. Costs come from the CLI result; with a subscription token they are notional."
      />
      <KpiTiles initial={summary} />
      <RoutingSavings telemetry={routing} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <WindowCard title="Today" window={summary.today} />
        <WindowCard title="Last 7 days" window={summary.last7Days} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Spend by model · last 7 days</CardTitle>
          <CardDescription>The router decides which tier each run lands on.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.byModel.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed runs yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 text-right font-medium">Runs</th>
                  <th className="pb-2 text-right font-medium">Input</th>
                  <th className="pb-2 text-right font-medium">Output</th>
                  <th className="pb-2 text-right font-medium">Cache read</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.byModel.map((row) => (
                  <tr key={row.modelId} className="tabular">
                    <td className="py-2">
                      <ModelBadge modelId={row.modelId} />
                    </td>
                    <td className="py-2 text-right">{row.runs}</td>
                    <td className="py-2 text-right">{formatTokens(row.usage.inputTokens)}</td>
                    <td className="py-2 text-right">{formatTokens(row.usage.outputTokens)}</td>
                    <td className="py-2 text-right">{formatTokens(row.usage.cacheReadTokens)}</td>
                    <td className="py-2 text-right font-medium">{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Model catalog</CardTitle>
          <CardDescription>Prices drive estimates and counterfactuals only.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">Tier</th>
                <th className="pb-2 text-right font-medium">Context</th>
                <th className="pb-2 text-right font-medium">Input $/MTok</th>
                <th className="pb-2 text-right font-medium">Output $/MTok</th>
                <th className="pb-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {catalog.models.map((model) => (
                <tr key={model.id} className="tabular">
                  <td className="py-2">
                    <span className="font-medium">{model.displayName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{model.id}</span>
                  </td>
                  <td className={`py-2 ${TIER_STYLES[model.tier].text}`}>
                    {TIER_STYLES[model.tier].label}
                  </td>
                  <td className="py-2 text-right">{formatTokens(model.contextWindow)}</td>
                  <td className="py-2 text-right">${model.inputUsdPerMTok.toFixed(2)}</td>
                  <td className="py-2 text-right">${model.outputUsdPerMTok.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    <Badge tone={model.enabled ? "success" : "neutral"}>
                      {model.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
