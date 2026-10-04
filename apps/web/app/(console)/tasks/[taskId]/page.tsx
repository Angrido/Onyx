import type {
  BlockedCommandsResponse,
  CatalogResponse,
  RunEventsResponse,
  TaskDetailDto,
  TddLoopListResponse,
} from "@onyx/contracts";
import { TaskDetail } from "@/components/tasks/task-detail";
import { serverFetch } from "@/lib/api/server";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [task, catalog, loops] = await Promise.all([
    serverFetch<TaskDetailDto>(`/api/tasks/${taskId}`),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<TddLoopListResponse>(`/api/tasks/${taskId}/tdd`),
  ]);
  const latest = task.runs[0];
  const [blocked, events] = latest
    ? await Promise.all([
        latest.guardDenials > 0
          ? serverFetch<BlockedCommandsResponse>(`/api/runs/${latest.id}/blocked`)
          : null,
        serverFetch<RunEventsResponse>(`/api/runs/${latest.id}/events?after=0&limit=200`),
      ])
    : [null, null];
  return (
    <TaskDetail
      initial={task}
      initialLoops={loops.items}
      initialBlocked={blocked}
      initialEvents={events}
      catalog={catalog}
    />
  );
}
