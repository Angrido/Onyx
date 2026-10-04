import type { MissionProjectDto, ProjectHealth } from "@onyx/contracts";

export const MISSION_FILTERS = ["all", "working", "attention", "idle"] as const;
export type MissionFilter = (typeof MISSION_FILTERS)[number];

export const MISSION_SORTS = ["activity", "name", "today", "week"] as const;
export type MissionSort = (typeof MISSION_SORTS)[number];

export const FILTER_LABELS: Record<MissionFilter, string> = {
  all: "All",
  working: "Working",
  attention: "Needs attention",
  idle: "Idle",
};

export const SORT_LABELS: Record<MissionSort, string> = {
  activity: "Recent activity",
  name: "Name",
  today: "Spend today",
  week: "Spend this week",
};

export const HEALTH_STYLES: Record<
  ProjectHealth,
  { label: string; tone: "success" | "warning" | "danger"; dot: string }
> = {
  OK: { label: "Healthy", tone: "success", dot: "bg-success" },
  ATTENTION: { label: "Needs attention", tone: "warning", dot: "bg-warning" },
  ERROR: { label: "Error", tone: "danger", dot: "bg-destructive" },
};

const HEALTH_RANK: Record<ProjectHealth, number> = { OK: 0, ATTENTION: 1, ERROR: 2 };

export function isWorking(project: MissionProjectDto): boolean {
  return project.running > 0 || project.queued > 0;
}

export function filterProjects(
  projects: readonly MissionProjectDto[],
  filter: MissionFilter,
  query: string,
): MissionProjectDto[] {
  const needle = query.trim().toLowerCase();
  return projects.filter((project) => {
    if (needle && !project.name.toLowerCase().includes(needle)) return false;
    if (filter === "working") return isWorking(project);
    if (filter === "attention") return project.health !== "OK";
    if (filter === "idle") return !isWorking(project);
    return true;
  });
}

export function sortProjects(
  projects: readonly MissionProjectDto[],
  sort: MissionSort,
): MissionProjectDto[] {
  const byName = (left: MissionProjectDto, right: MissionProjectDto) =>
    left.name.localeCompare(right.name);
  return [...projects].sort((left, right) => {
    if (sort === "name") return byName(left, right);
    if (sort === "today") return right.today.costUsd - left.today.costUsd || byName(left, right);
    if (sort === "week") return right.week.costUsd - left.week.costUsd || byName(left, right);
    return (
      Number(isWorking(right)) - Number(isWorking(left)) ||
      right.lastActivityAt.localeCompare(left.lastActivityAt) ||
      byName(left, right)
    );
  });
}

export function filterCounts(
  projects: readonly MissionProjectDto[],
): Record<MissionFilter, number> {
  return {
    all: projects.length,
    working: projects.filter(isWorking).length,
    attention: projects.filter((project) => project.health !== "OK").length,
    idle: projects.filter((project) => !isWorking(project)).length,
  };
}

export function worstHealth(projects: readonly MissionProjectDto[]): ProjectHealth {
  return projects.reduce<ProjectHealth>(
    (worst, project) => (HEALTH_RANK[project.health] > HEALTH_RANK[worst] ? project.health : worst),
    "OK",
  );
}

export function gitLine(project: MissionProjectDto): string {
  const { git } = project;
  if (git.error) return "Git unavailable";
  if (!git.isRepo) return "Not a git repository";
  const parts = [git.branch ?? "detached"];
  parts.push(git.changeCount === 0 ? "clean" : `${git.changeCount} changed`);
  if (git.ahead > 0) parts.push(`${git.ahead} ahead`);
  if (git.behind > 0) parts.push(`${git.behind} behind`);
  return parts.join(" · ");
}
