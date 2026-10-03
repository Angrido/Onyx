import type { CatalogResponse, TaskDetailDto } from "@onyx/contracts";
import { TaskDetail } from "@/components/tasks/task-detail";
import { serverFetch } from "@/lib/api/server";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const [task, catalog] = await Promise.all([
    serverFetch<TaskDetailDto>(`/api/tasks/${taskId}`),
    serverFetch<CatalogResponse>("/api/catalog"),
  ]);
  return <TaskDetail initial={task} catalog={catalog} />;
}
