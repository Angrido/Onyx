import type {
  BlockedCommandsResponse,
  CatalogResponse,
  ProjectDetailDto,
  RunEventsResponse,
  TaskDetailDto,
  TddLoopListResponse,
} from "@onyx/contracts";
import { TaskDetail } from "@/components/tasks/task-detail";
import { serverFetch } from "@/lib/api/server";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [task, loops, catalog] = await Promise.all([
    serverFetch<TaskDetailDto>(`/api/tasks/${taskId}`),
    serverFetch<TddLoopListResponse>(`/api/tasks/${taskId}/tdd`),
    serverFetch<CatalogResponse>("/api/catalog"),
  ]);
  const latest = task.runs[0];
  const [project, blocked, events] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${task.projectId}`),
    latest && latest.guardDenials >= 1
      ? serverFetch<BlockedCommandsResponse>(`/api/runs/${latest.id}/blocked`)
      : null,
    latest
      ? serverFetch<RunEventsResponse>(`/api/runs/${latest.id}/events?after=0&limit=200`)
      : null,
  ]);
  return (
    <TaskDetail
      initial={task}
      initialLoops={loops.items}
      initialBlocked={blocked}
      initialEvents={events}
      catalog={catalog}
      projectName={project.name}
    />
  );
}
