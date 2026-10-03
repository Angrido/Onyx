import type { CatalogResponse, TaskDetailDto, TddLoopListResponse } from "@onyx/contracts";
import { TaskDetail } from "@/components/tasks/task-detail";
import { serverFetch } from "@/lib/api/server";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [task, catalog, loops] = await Promise.all([
    serverFetch<TaskDetailDto>(`/api/tasks/${taskId}`),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<TddLoopListResponse>(`/api/tasks/${taskId}/tdd`),
  ]);
  return <TaskDetail initial={task} initialLoops={loops.items} catalog={catalog} />;
}
