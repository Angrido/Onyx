export const queryKeys = {
  me: ["me"] as const,
  catalog: ["catalog"] as const,
  telemetry: ["telemetry"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  tasks: (filter: { projectId?: string; status?: string } = {}) => ["tasks", filter] as const,
  allTasks: ["tasks"] as const,
  task: (id: string) => ["task", id] as const,
  run: (id: string) => ["run", id] as const,
  sessions: (workspaceId: string) => ["sessions", workspaceId] as const,
};
