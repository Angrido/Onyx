import type {
  CatalogResponse,
  ProjectListResponse,
  RouterSettingsDto,
  RoutingDecisionListResponse,
  RoutingRuleListResponse,
  RoutingTelemetry,
} from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { RouterConsole } from "@/components/router/router-console";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Router") };
}

export default async function RouterPage() {
  const t = await getT();
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
        eyebrow={t("Model router")}
        title={t("Router")}
        description={t(
          "Every run gets the cheapest tier that should finish it: rules first, then a weighted heuristic, then the classifier when the heuristic is unsure. Failures on max turns move up one tier.",
        )}
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
