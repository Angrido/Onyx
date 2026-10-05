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
import { HelpTip } from "@/components/ui/help-tip";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Models") };
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
        eyebrow={
          <span className="inline-flex items-center gap-0.5">
            {t("Model router")}
            <HelpTip term="router" />
          </span>
        }
        title={t("Models")}
        description={t(
          "Onyx picks a Claude model for every run: the cheapest that should finish the task, and a stronger one if it fails. Here you see what this saves, try a task in the simulator and set your own rules.",
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
