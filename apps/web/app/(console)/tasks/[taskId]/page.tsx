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
  const [task, loops, catalog] = await Promise.all([
    serverFetch<TaskDetailDto>(`/api/tasks/${taskId}`),
    serverFetch<TddLoopListResponse>(`/api/tasks/${taskId}/tdd`),
    serverFetch<CatalogResponse>("/api/catalog"),
  ]);
  const latest = task.runs[0];
  const [blocked, events] = latest
    ? await Promise.all([
        latest.guardDenials >= 1
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
