import type {
  CatalogResponse,
  ProjectListResponse,
  RouterSettingsDto,
  RoutingDecisionListResponse,
  RoutingRuleListResponse,
  RoutingTelemetry,
} from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { RouterConsole } from "@/components/router/router-console";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Router" };

export default async function RouterPage() {
  const [settings, rules, decisions, telemetry, projects, catalog] = await Promise.all([
    serverFetch<RouterSettingsDto>("/api/router/settings"),
    serverFetch<RoutingRuleListResponse>("/api/routing-rules"),
    serverFetch<RoutingDecisionListResponse>("/api/routing-decisions?limit=30"),
    serverFetch<RoutingTelemetry>("/api/telemetry/routing"),
    serverFetch<ProjectListResponse>("/api/projects"),
    serverFetch<CatalogResponse>("/api/catalog"),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Model router"
        title="Router"
        description="Every run gets the cheapest tier that should finish it: rules first, then a weighted heuristic, then the classifier when the heuristic is unsure. Failures on max turns move up one tier."
      />
      <RouterConsole
        settings={settings}
        rules={rules.items}
        decisions={decisions.items}
        telemetry={telemetry}
        projects={projects.items}
        catalog={catalog}
      />
    </>
  );
}
