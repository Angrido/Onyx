"use client";

import { Brain, LayoutDashboard, Lightbulb, Map as MapIcon, Network, Scissors } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { GitHubMark } from "@/components/ui/github-mark";
import { useT } from "@/lib/i18n/client";
import { PROJECT_TABS, projectSection, type ProjectTabId } from "@/lib/project-nav";
import { cn } from "@/lib/utils";

const TAB_ICONS: Record<ProjectTabId, ReactNode> = {
  overview: <LayoutDashboard />,
  insights: <Lightbulb />,
  roadmap: <MapIcon />,
  github: <GitHubMark />,
  memory: <Brain />,
  graph: <Network />,
  surgeon: <Scissors />,
};

export function ProjectNav({ projectId, name }: { projectId: string; name: string }) {
  const t = useT();
  const pathname = usePathname() ?? "";
  const section = projectSection(projectId, pathname);
  const base = `/projects/${projectId}`;
  const current = PROJECT_TABS.find((tab) => tab.id === section.tab);
  const crumbs: Crumb[] = [
    { label: t("Projects"), href: "/projects" },
    section.exact && section.tab === "overview" ? { label: name } : { label: name, href: base },
  ];
  if (section.tab !== "overview" && current) crumbs.push({ label: t(current.label) });
  if (section.child === "workspace") crumbs.push({ label: t("Workspace") });
  if (section.child === "plan") crumbs.push({ label: t("Plan") });

  return (
    <div className="space-y-3" data-testid="project-nav">
      <Breadcrumbs label={t("Breadcrumb")} items={crumbs} />
      <nav aria-label={t("Project sections")} className="max-w-full overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {PROJECT_TABS.map((tab) => {
            const active = tab.id === section.tab;
            const exact = active && section.exact;
            return (
              <li key={tab.id}>
                <Link
                  href={`${base}${tab.path}`}
                  aria-current={exact ? "page" : active ? "true" : undefined}
                  data-testid={`project-tab-${tab.id}`}
                  className={cn(
                    "-mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
                    active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  <span aria-hidden="true" className="inline-flex">
                    {TAB_ICONS[tab.id]}
                  </span>
                  {t(tab.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
