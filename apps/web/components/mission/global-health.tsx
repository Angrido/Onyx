"use client";

import type { HealthCheckDto, HealthCheckId, MissionControlDto } from "@onyx/contracts";
import Link from "next/link";
import { HealthIcon } from "@/components/system/health-checks";
import { Button } from "@/components/ui/button";
import { msg } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/client";
import { useMission } from "@/lib/live";
import { globalIssues } from "@/lib/mission";
import { HEALTH_CHECK_LABELS } from "@/lib/system";
import { cn } from "@/lib/utils";

const FIXES: Partial<Record<HealthCheckId, { label: string; href: string }>> = {
  claude: { label: msg("Connect Claude"), href: "/settings#claude" },
  disk: { label: msg("Open diagnostics"), href: "/settings#diagnostics" },
};

function Issue({ check }: { check: HealthCheckDto }) {
  const t = useT();
  const fix = FIXES[check.id];
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      data-testid={`global-issue-${check.id}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <HealthIcon level={check.level} className="mt-0.5 size-4" />
        <p className="min-w-0 text-sm">
          <span className="font-medium">{t(HEALTH_CHECK_LABELS[check.id])}</span>
          <span className="block break-words text-muted-foreground">{check.reason}</span>
        </p>
      </div>
      {fix ? (
        <Button asChild size="sm" variant={check.id === "claude" ? "default" : "secondary"}>
          <Link href={fix.href}>{t(fix.label)}</Link>
        </Button>
      ) : null}
    </li>
  );
}

export function GlobalHealth({ initial }: { initial: MissionControlDto }) {
  const t = useT();
  const { data = initial } = useMission(initial);
  const issues = globalIssues(data.globalChecks);
  if (issues.length === 0) return null;
  const error = issues.some((issue) => issue.level === "ERROR");
  return (
    <section
      id="global-health"
      aria-labelledby="global-health-heading"
      data-testid="global-health"
      className={cn(
        "scroll-mt-6 space-y-3 rounded-xl border px-4 py-3",
        error ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10",
      )}
    >
      <h2 id="global-health-heading" className="text-sm font-semibold tracking-tight">
        {t("Affects every project")}
      </h2>
      <ul className="space-y-3">
        {issues.map((issue) => (
          <Issue key={issue.id} check={issue} />
        ))}
      </ul>
    </section>
  );
}
