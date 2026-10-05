import { msg } from "@/lib/i18n/core";

export type ProjectTabId =
  "overview" | "insights" | "roadmap" | "github" | "memory" | "graph" | "surgeon";

export interface ProjectTab {
  id: ProjectTabId;
  label: string;
  path: string;
}

export const PROJECT_TABS: readonly ProjectTab[] = [
  { id: "overview", label: msg("Overview"), path: "" },
  { id: "insights", label: msg("Insights"), path: "/insights" },
  { id: "roadmap", label: msg("Roadmap"), path: "/roadmap" },
  { id: "github", label: msg("GitHub"), path: "/github" },
  { id: "memory", label: msg("Memory"), path: "/memory" },
  { id: "graph", label: msg("Graph"), path: "/graph" },
  { id: "surgeon", label: msg("Context Surgeon"), path: "/surgeon" },
];

export interface ProjectSection {
  tab: ProjectTabId;
  exact: boolean;
  child: "workspace" | "plan" | null;
}

export function projectSection(projectId: string, pathname: string): ProjectSection {
  const base = `/projects/${projectId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/\/+$/, "") : "";
  const [first = "", ...more] = rest.split("/").filter((part) => part.length > 0);
  if (first === "workspaces") return { tab: "overview", exact: false, child: "workspace" };
  if (first === "plans") return { tab: "overview", exact: false, child: "plan" };
  const tab = PROJECT_TABS.find((entry) => entry.path === (first ? `/${first}` : ""));
  if (!tab) return { tab: "overview", exact: false, child: null };
  return { tab: tab.id, exact: more.length === 0, child: null };
}
