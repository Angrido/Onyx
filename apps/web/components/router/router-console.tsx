"use client";

import type {
  CatalogResponse,
  ProjectDto,
  RouterSettingsDto,
  RoutingDecisionDto,
  RoutingRuleDto,
  RoutingTelemetry,
} from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { DecisionList } from "@/components/router/decision-list";
import { RouterSettingsForm } from "@/components/router/router-settings-form";
import { RouterSimulator } from "@/components/router/router-simulator";
import { RoutingSavings } from "@/components/router/routing-savings";
import { RulesPanel } from "@/components/router/rules-panel";
import { HelpTip } from "@/components/ui/help-tip";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";

export function RouterConsole({
  settings: initialSettings,
  rules,
  decisions,
  telemetry: initialTelemetry,
  projects,
  catalog,
}: {
  settings: RouterSettingsDto;
  rules: RoutingRuleDto[];
  decisions: RoutingDecisionDto[];
  telemetry: RoutingTelemetry;
  projects: ProjectDto[];
  catalog: CatalogResponse;
}) {
  const t = useT();
  const settings = useQuery({
    queryKey: queryKeys.routerSettings,
    queryFn: () => api.get<RouterSettingsDto>("/api/router/settings"),
    initialData: initialSettings,
  });
  const telemetry = useQuery({
    queryKey: queryKeys.routingTelemetry,
    queryFn: () => api.get<RoutingTelemetry>("/api/telemetry/routing"),
    initialData: initialTelemetry,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <details className="group rounded-xl border border-border bg-surface-1/60 px-4 py-3 text-sm">
        <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          {t("How the choice is made")}
        </summary>
        <p className="mt-2 text-muted-foreground">
          {t(
            "Every run gets the cheapest tier that should finish it: rules first, then a weighted heuristic, then the classifier when the heuristic is unsure. Failures on max turns move up one tier.",
          )}
          <HelpTip term="tier" className="ml-1" />
        </p>
      </details>
      <RoutingSavings telemetry={telemetry.data} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <RouterSimulator projects={projects} settings={settings.data} />
        <RouterSettingsForm key={JSON.stringify(settings.data)} settings={settings.data} />
      </div>
      <RulesPanel initial={rules} projects={projects} catalog={catalog} />
      <DecisionList initial={decisions} />
    </div>
  );
}
