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
  workspace: (workspaceId: string) => ["workspace", workspaceId] as const,
  terminals: (workspaceId: string) => ["terminals", workspaceId] as const,
  routerSettings: ["router", "settings"] as const,
  routingRules: ["router", "rules"] as const,
  routingDecisions: ["router", "decisions"] as const,
  routingTelemetry: ["router", "telemetry"] as const,
  routerPreview: (input: object) => ["router", "preview", input] as const,
  index: (projectId: string) => ["index", projectId] as const,
  graph: (projectId: string, focus: string | null, depth: number) =>
    ["graph", projectId, focus, depth] as const,
  allGraphs: (projectId: string) => ["graph", projectId] as const,
  fileContext: (projectId: string, path: string, level: number) =>
    ["file-context", projectId, path, level] as const,
  surgeon: (projectId: string, workspaceId: string | null) =>
    ["surgeon", projectId, workspaceId] as const,
  allSurgeon: (projectId: string) => ["surgeon", projectId] as const,
  surgeonCompiled: (projectId: string, workspaceId: string | null, version: string) =>
    ["surgeon", projectId, workspaceId, "compiled", version] as const,
};
