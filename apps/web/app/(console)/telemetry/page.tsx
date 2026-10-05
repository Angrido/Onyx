import type {
  CatalogResponse,
  QuotaDto,
  RoutingTelemetry,
  TelemetrySummary,
  UsageWindow,
} from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { RoutingSavings } from "@/components/router/routing-savings";
import { ModelBadge } from "@/components/tasks/status-badge";
import { KpiTiles } from "@/components/telemetry/kpi-tiles";
import { QuotaCard } from "@/components/telemetry/quota-card";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serverFetch } from "@/lib/api/server";
import { formatPercent, formatTokens, formatUsd } from "@/lib/format";
import type { GlossaryId } from "@/lib/glossary";
import type { Translate } from "@/lib/i18n/core";
import { getT } from "@/lib/i18n/server";
import { TIER_STYLES } from "@/lib/tiers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Usage") };
}

function WindowCard({ title, window, t }: { title: string; window: UsageWindow; t: Translate }) {
  const rows: [string, string, GlossaryId | null][] = [
    [t("Runs"), String(window.runs), null],
    [t("Cost"), formatUsd(window.costUsd), null],
    [t("Input tokens"), formatTokens(window.usage.inputTokens), "token"],
    [t("Output tokens"), formatTokens(window.usage.outputTokens), null],
    [t("Read from cache"), formatTokens(window.usage.cacheReadTokens), "cache"],
    [t("Cache write"), formatTokens(window.usage.cacheCreationTokens), null],
    [t("Cache hit ratio"), formatPercent(window.cacheHitRatio), null],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
          {rows.map(([label, value, term]) => (
            <div key={label} className="contents">
              <dt className="flex items-center gap-0.5 text-muted-foreground">
                {label}
                {term ? <HelpTip term={term} /> : null}
              </dt>
              <dd className="tabular text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default async function TelemetryPage() {
  const t = await getT();
  const [summary, catalog, routing, quota] = await Promise.all([
    serverFetch<TelemetrySummary>("/api/telemetry/summary"),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<RoutingTelemetry>("/api/telemetry/routing"),
    serverFetch<QuotaDto>("/api/quota"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={t("Tokens and spend")}
        title={t("Usage")}
        description={t(
          "How much Claude has read and written for your runs, what it would cost and how much of your subscription is used. With a subscription the costs are only indicative: you pay the subscription, not the tokens.",
        )}
      />
      <KpiTiles initial={summary} />
      <QuotaCard initial={quota} />
      <RoutingSavings telemetry={routing} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <WindowCard title={t("Today")} window={summary.today} t={t} />
        <WindowCard title={t("Last 7 days")} window={summary.last7Days} t={t} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("Spend by model · last 7 days")}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-1">
            {t("The router decides which tier each run lands on.")}
            <HelpTip term="tier" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.byModel.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No completed runs yet.")}</p>
          ) : (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label={t("Spend by model")}
            >
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">{t("Model")}</th>
                    <th className="pb-2 text-right font-medium">{t("Runs")}</th>
                    <th className="pb-2 text-right font-medium">{t("Input")}</th>
                    <th className="pb-2 text-right font-medium">{t("Output")}</th>
                    <th className="pb-2 text-right font-medium">{t("From cache")}</th>
                    <th className="pb-2 text-right font-medium">{t("Cost")}</th>
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
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("Model catalog")}</CardTitle>
          <CardDescription>{t("Prices drive estimates and counterfactuals only.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={t("Model catalog")}
          >
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">{t("Model")}</th>
                  <th className="pb-2 font-medium">{t("Tier")}</th>
                  <th className="pb-2 text-right font-medium">{t("Context")}</th>
                  <th className="pb-2 text-right font-medium">{t("Input $/MTok")}</th>
                  <th className="pb-2 text-right font-medium">{t("Output $/MTok")}</th>
                  <th className="pb-2 text-right font-medium">{t("Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {catalog.models.map((model) => (
                  <tr key={model.id} className="tabular">
                    <td className="py-2">
                      <span className="font-medium">{model.displayName}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {model.id}
                      </span>
                    </td>
                    <td className={`py-2 ${TIER_STYLES[model.tier].text}`}>
                      {t(TIER_STYLES[model.tier].label)}
                    </td>
                    <td className="py-2 text-right">{formatTokens(model.contextWindow)}</td>
                    <td className="py-2 text-right">${model.inputUsdPerMTok.toFixed(2)}</td>
                    <td className="py-2 text-right">${model.outputUsdPerMTok.toFixed(2)}</td>
                    <td className="py-2 text-right">
                      <Badge tone={model.enabled ? "success" : "neutral"}>
                        {model.enabled ? t("enabled") : t("disabled")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
