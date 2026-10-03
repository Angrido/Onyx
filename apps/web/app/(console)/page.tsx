import type { ApprovalListResponse, TaskListResponse, TelemetrySummary } from "@onyx/contracts";
import Link from "next/link";
import { PendingApprovals } from "@/components/approvals/pending-approvals";
import { NetworkCard } from "@/components/layout/network-card";
import { PageHeader } from "@/components/layout/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { KpiTiles } from "@/components/telemetry/kpi-tiles";
import { Button } from "@/components/ui/button";
import { GitHubMark } from "@/components/ui/github-mark";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Console" };

export default async function ConsolePage() {
  const [telemetry, tasks, approvals] = await Promise.all([
    serverFetch<TelemetrySummary>("/api/telemetry/summary"),
    serverFetch<TaskListResponse>("/api/tasks?limit=20"),
    serverFetch<ApprovalListResponse>("/api/approvals?status=PENDING&limit=4"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Agent console"
        description="Live state of every Claude Code agent orchestrated by this Onyx instance."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/projects">Open projects</Link>
            </Button>
            <Button asChild>
              <Link href="/projects?new=github">
                <GitHubMark />
                Import from GitHub
              </Link>
            </Button>
          </>
        }
      />
      <KpiTiles initial={telemetry} />
      <PendingApprovals initial={approvals} />
      <NetworkCard />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Recent tasks</h2>
        <TaskList
          initial={tasks.items}
          emptyAction={
            <Button asChild size="sm">
              <Link href="/projects?new=github">Pick a project</Link>
            </Button>
          }
        />
      </section>
    </>
  );
}
