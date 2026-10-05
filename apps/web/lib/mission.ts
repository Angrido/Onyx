import type { HealthCheckDto, MissionProjectDto, ProjectHealth } from "@onyx/contracts";
import { formatTokens, formatUsd } from "@/lib/format";
import { english, msg, type Translate } from "@/lib/i18n/core";

export const MISSION_FILTERS = ["all", "working", "attention", "idle"] as const;
export type MissionFilter = (typeof MISSION_FILTERS)[number];

export const MISSION_SORTS = ["activity", "name", "today", "week"] as const;
export type MissionSort = (typeof MISSION_SORTS)[number];

export const FILTER_LABELS: Record<MissionFilter, string> = {
  all: msg("All"),
  working: msg("Working"),
  attention: msg("Needs attention"),
  idle: msg("Idle"),
};

export const SORT_LABELS: Record<MissionSort, string> = {
  activity: msg("Recent activity"),
  name: msg("Name"),
  today: msg("Spend today"),
  week: msg("Spend this week"),
};

export const HEALTH_STYLES: Record<
  ProjectHealth,
  { label: string; tone: "success" | "warning" | "danger"; dot: string }
> = {
  OK: { label: msg("Healthy"), tone: "success", dot: "bg-success" },
  ATTENTION: { label: msg("Needs attention"), tone: "warning", dot: "bg-warning" },
  ERROR: { label: msg("Error"), tone: "danger", dot: "bg-destructive" },
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

export function gitLine(project: MissionProjectDto, t: Translate = english): string {
  const { git } = project;
  if (git.error) return t("Git unavailable");
  if (!git.isRepo) return t("Not a git repository");
  const parts = [git.branch ?? t("detached")];
  parts.push(git.changeCount === 0 ? t("clean") : t("{count} changed", { count: git.changeCount }));
  if (git.ahead > 0) parts.push(t("{count} ahead", { count: git.ahead }));
  if (git.behind > 0) parts.push(t("{count} behind", { count: git.behind }));
  return parts.join(" · ");
}

export function isQuiet(project: MissionProjectDto): boolean {
  return (
    !isWorking(project) &&
    project.activeTasks.length === 0 &&
    project.pendingApprovals === 0 &&
    project.today.runs === 0 &&
    project.today.tokens === 0 &&
    project.today.costUsd === 0
  );
}

export function lastTaskAt(project: MissionProjectDto): string | null {
  return project.lastRun ? (project.lastRun.endedAt ?? project.lastRun.startedAt) : null;
}

export function spendLine(project: MissionProjectDto, t: Translate = english): string | null {
  const { today, week } = project;
  const todayEmpty = today.costUsd === 0 && today.tokens === 0;
  if (todayEmpty && week.costUsd === 0 && week.tokens === 0) return null;
  if (todayEmpty) return t("This week {cost}", { cost: formatUsd(week.costUsd) });
  return [
    t("Today {cost} · {tokens} tokens", {
      cost: formatUsd(today.costUsd),
      tokens: formatTokens(today.tokens),
    }),
    t("week {cost}", { cost: formatUsd(week.costUsd) }),
  ].join(" · ");
}

export function activityLine(project: MissionProjectDto, t: Translate = english): string {
  const parts = [
    project.running > 0 ? t("{count} running", { count: project.running }) : t("No agent running"),
  ];
  if (project.queued > 0) parts.push(t("{count} queued", { count: project.queued }));
  if (project.runLimit !== null) parts.push(t("limit {count}", { count: project.runLimit }));
  if (project.openTasks === 1) parts.push(t("1 open task"));
  if (project.openTasks > 1) parts.push(t("{count} open tasks", { count: project.openTasks }));
  return parts.join(" · ");
}

export function globalIssues(checks: readonly HealthCheckDto[]): HealthCheckDto[] {
  return [...checks]
    .filter((check) => check.level !== "OK")
    .sort((left, right) => HEALTH_RANK[right.level] - HEALTH_RANK[left.level]);
}
