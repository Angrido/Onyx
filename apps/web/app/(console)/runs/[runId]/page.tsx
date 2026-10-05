import type {
  BlockedCommandsResponse,
  ProjectDetailDto,
  RunDto,
  RunEventsResponse,
  TaskDetailDto,
} from "@onyx/contracts";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { RunDetail } from "@/components/runs/run-detail";
import { serverFetch } from "@/lib/api/server";
import { shortId } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const t = await getT();
  const [run, blocked, events] = await Promise.all([
    serverFetch<RunDto>(`/api/runs/${runId}`),
    serverFetch<BlockedCommandsResponse>(`/api/runs/${runId}/blocked`),
    serverFetch<RunEventsResponse>(`/api/runs/${runId}/events?after=0&limit=200`),
  ]);
  const task = await serverFetch<TaskDetailDto>(`/api/tasks/${run.taskId}`);
  const project = await serverFetch<ProjectDetailDto>(`/api/projects/${task.projectId}`);
  return (
    <>
      <PageHeader
        eyebrow={
          <Breadcrumbs
            label={t("Breadcrumb")}
            items={[
              { label: t("Projects"), href: "/projects" },
              { label: project.name, href: `/projects/${project.id}` },
              { label: task.title, href: `/tasks/${task.id}` },
              { label: t("Run {id}", { id: shortId(run.id) }) },
            ]}
          />
        }
        title={t("Run of {task}", { task: task.title })}
        description={<span className="line-clamp-3 break-words">{run.prompt}</span>}
      />
      <RunDetail run={run} blocked={blocked} events={events} />
    </>
  );
}
