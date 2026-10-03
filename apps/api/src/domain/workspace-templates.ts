import type { Domain, ResetStrategy } from "@onyx/contracts";

export interface WorkspaceTemplate {
  name: string;
  domain: Domain;
  pathGlobs: string[];
  agentConfigName: string;
  resetStrategy: ResetStrategy;
  color: string;
}

export const DEFAULT_WORKSPACES: readonly WorkspaceTemplate[] = [
  {
    name: "Frontend",
    domain: "FRONTEND",
    pathGlobs: ["apps/web/**", "packages/ui/**", "src/components/**", "src/app/**"],
    agentConfigName: "builder",
    resetStrategy: "HANDOFF",
    color: "amber",
  },
  {
    name: "Backend",
    domain: "BACKEND",
    pathGlobs: ["apps/api/**", "packages/core/**", "src/server/**"],
    agentConfigName: "builder",
    resetStrategy: "HANDOFF",
    color: "violet",
  },
  {
    name: "Database",
    domain: "DATABASE",
    pathGlobs: ["packages/db/**", "**/prisma/**", "**/migrations/**"],
    agentConfigName: "architect",
    resetStrategy: "HANDOFF",
    color: "cyan",
  },
  {
    name: "Infra",
    domain: "INFRA",
    pathGlobs: ["deploy/**", ".github/**", "Dockerfile", "docker-compose*.yml"],
    agentConfigName: "builder",
    resetStrategy: "HARD",
    color: "slate",
  },
];
