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
import { DecisionList } from "@/components/router/decision-list";
import { RouterSettingsForm } from "@/components/router/router-settings-form";
import { RouterSimulator } from "@/components/router/router-simulator";
import { RoutingSavings } from "@/components/router/routing-savings";
import { RulesPanel } from "@/components/router/rules-panel";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

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
