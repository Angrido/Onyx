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
  index: (projectId: string) => ["index", projectId] as const,
  graph: (projectId: string, focus: string | null, depth: number) =>
    ["graph", projectId, focus, depth] as const,
  allGraphs: (projectId: string) => ["graph", projectId] as const,
  fileContext: (projectId: string, path: string, level: number) =>
    ["file-context", projectId, path, level] as const,
};
