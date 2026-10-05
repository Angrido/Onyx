"use client";

import type { HealthCheckDto, ProjectHealth, ProjectHealthReport } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CircleAlert, CircleCheck, CircleX, Loader2, RefreshCw, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { HEALTH_STYLES, globalIssues } from "@/lib/mission";
import { HEALTH_CHECK_LABELS, HEALTH_LEVEL_LABELS, checksSummary } from "@/lib/system";
import { cn } from "@/lib/utils";

const LEVEL_ICONS: Record<ProjectHealth, { icon: typeof CircleCheck; color: string }> = {
  OK: { icon: CircleCheck, color: "text-success" },
  ATTENTION: { icon: CircleAlert, color: "text-warning" },
  ERROR: { icon: CircleX, color: "text-destructive" },
};

export function HealthIcon({ level, className }: { level: ProjectHealth; className?: string }) {
  const { icon: Icon, color } = LEVEL_ICONS[level];
  return <Icon className={cn("size-3.5 shrink-0", color, className)} aria-hidden />;
}

export function HealthLights({ checks }: { checks: readonly HealthCheckDto[] }) {
  const t = useT();
  const label = checks
    .map((check) => `${t(HEALTH_CHECK_LABELS[check.id])}: ${t(HEALTH_LEVEL_LABELS[check.level])}`)
    .join(", ");
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label} title={label}>
      {checks.map((check) => (
        <HealthIcon key={check.id} level={check.level} />
      ))}
    </span>
  );
}

export function GlobalIssuesNote({ checks }: { checks: readonly HealthCheckDto[] }) {
  const t = useT();
  const issues = globalIssues(checks);
  if (issues.length === 0) return null;
  return (
    <p
      className="flex min-w-0 items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
      data-testid="global-issues-note"
    >
      <HealthIcon level={issues[0]?.level ?? "ATTENTION"} className="mt-px" />
      <span className="min-w-0">
        {issues.length === 1
          ? t("1 problem affects every project, not only this one:")
          : t("{count} problems affect every project, not only this one:", {
              count: issues.length,
            })}{" "}
        <span className="text-muted-foreground">
          {issues.map((issue) => issue.reason).join(" · ")}
        </span>{" "}
        <Link href="/#global-health" className="text-primary underline-offset-2 hover:underline">
          {t("See it in Mission control")}
        </Link>
      </span>
    </p>
  );
}

export function HealthCheckList({
  checks,
  className,
}: {
  checks: readonly HealthCheckDto[];
  className?: string;
}) {
  const t = useT();
  return (
    <ul className={cn("space-y-1.5 text-xs", className)} data-testid="health-checks">
      {checks.map((check) => (
        <li key={check.id} className="flex min-w-0 items-start gap-2" data-level={check.level}>
          <HealthIcon level={check.level} className="mt-px" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-foreground">{t(HEALTH_CHECK_LABELS[check.id])}</span>
            <span className="sr-only">{` (${t(HEALTH_LEVEL_LABELS[check.level])})`}</span>
            <span className="block break-words text-muted-foreground">{check.reason}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProjectHealthCard({ initial }: { initial: ProjectHealthReport }) {
  const t = useT();
  const {
    data = initial,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.projectHealth(initial.projectId),
    queryFn: () => api.get<ProjectHealthReport>(`/api/projects/${initial.projectId}/health`),
    initialData: initial,
    refetchInterval: 60_000,
  });
  const overall = HEALTH_STYLES[data.health];
  return (
    <Card id="health" data-testid="project-health">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="size-4 text-muted-foreground" aria-hidden />
            {t("Health checks")}
          </CardTitle>
          <CardDescription>
            {checksSummary(data.checks, t)}
            {" · "}
            {t("last check")} <RelativeTime iso={data.checkedAt} />
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={overall.tone} data-testid="project-health-level">
            <HealthIcon level={data.health} className="size-3" />
            {t(overall.label)}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label={t("Refresh the checks")}
            title={t("Refresh the checks")}
          >
            {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <HealthCheckList checks={data.checks} className="grid gap-3 space-y-0 sm:grid-cols-2" />
        <GlobalIssuesNote checks={data.globalChecks} />
      </CardContent>
    </Card>
  );
}
