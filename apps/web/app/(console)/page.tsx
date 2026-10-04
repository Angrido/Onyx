import type {
  ApprovalListResponse,
  ClaudeAccountDto,
  ProjectDetailDto,
  ProjectListResponse,
  MissionControlDto,
  QueueDto,
  TaskListResponse,
  TelemetrySummary,
} from "@onyx/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { PendingApprovals } from "@/components/approvals/pending-approvals";
import { NetworkCard } from "@/components/layout/network-card";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { PageHeader } from "@/components/layout/page-header";
import { MissionControl } from "@/components/mission/mission-control";
import { QueuePanel } from "@/components/queue/queue-panel";
import { TaskList } from "@/components/tasks/task-list";
import { KpiTiles } from "@/components/telemetry/kpi-tiles";
import { Button } from "@/components/ui/button";
import { GitHubMark } from "@/components/ui/github-mark";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";
import { onboardingSteps } from "@/lib/onboarding";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Mission control") };
}

export default async function ConsolePage() {
  const t = await getT();
  const [telemetry, tasks, approvals, queue, mission, claude, projects] = await Promise.all([
    serverFetch<TelemetrySummary>("/api/telemetry/summary"),
    serverFetch<TaskListResponse>("/api/tasks?limit=20"),
    serverFetch<ApprovalListResponse>("/api/approvals?status=PENDING&limit=4"),
    serverFetch<QueueDto>("/api/queue"),
    serverFetch<MissionControlDto>("/api/mission-control"),
    serverFetch<ClaudeAccountDto>("/api/settings/claude"),
    serverFetch<ProjectListResponse>("/api/projects"),
  ]);
  const first = projects.items[0] ?? null;
  const firstDetail = first
    ? await serverFetch<ProjectDetailDto>(`/api/projects/${first.id}`).catch(() => null)
    : null;
  const steps = onboardingSteps({
    claudeConfigured: claude.configured,
    firstProject: first
      ? {
          id: first.id,
          workspaceCount: first.workspaceCount,
          allowedCommands: firstDetail?.allowedTools.length ?? 0,
          taskCount: first.taskCount,
        }
      : null,
  });
  return (
    <>
      <PageHeader
        eyebrow={t("Overview")}
        title={t("Mission control")}
        description={t(
          "Every project at a glance: branch and changes, agents and queue, last results, spend and health.",
        )}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/projects">{t("Open projects")}</Link>
            </Button>
            <Button asChild>
              <Link href="/projects?new=github">
                <GitHubMark />
                {t("Import from GitHub")}
              </Link>
            </Button>
          </>
        }
      />
      <GettingStarted steps={steps} />
      <KpiTiles initial={telemetry} />
      <PendingApprovals initial={approvals} />
      <MissionControl
        initial={mission}
        emptyAction={
          <Button asChild size="sm">
            <Link href="/projects?new=github">{t("Pick a project")}</Link>
          </Button>
        }
      />
      <QueuePanel initial={queue} />
      <NetworkCard />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">{t("Recent tasks")}</h2>
        <TaskList
          initial={tasks.items}
          emptyAction={
            <Button asChild size="sm">
              <Link href="/projects?new=github">{t("Pick a project")}</Link>
            </Button>
          }
        />
      </section>
    </>
  );
}
