import type { BlockedCommandsResponse, RunDto, RunEventsResponse } from "@onyx/contracts";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { RunConsole } from "@/components/runs/run-console";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const t = await getT();
  const [run, blocked, events] = await Promise.all([
    serverFetch<RunDto>(`/api/runs/${runId}`),
    serverFetch<BlockedCommandsResponse>(`/api/runs/${runId}/blocked`),
    serverFetch<RunEventsResponse>(`/api/runs/${runId}/events?after=0&limit=200`),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/tasks/${run.taskId}`} className="hover:text-foreground">
            {t("← Task")}
          </Link>
        }
        title={t("Run console")}
        description={run.prompt}
      />
      <RunConsole key={run.id} run={run} blocked={blocked} events={events} className="h-[78vh]" />
    </>
  );
}
