import { msg } from "@/lib/i18n/core";

export type OnboardingStepId = "claude" | "project" | "workspaces" | "commands" | "task";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  action: string;
  href: string;
  done: boolean;
}

export interface OnboardingInput {
  claudeConfigured: boolean;
  firstProject: {
    id: string;
    workspaceCount: number;
    allowedCommands: number;
    taskCount: number;
  } | null;
}

export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const project = input.firstProject;
  const projectHref = project ? `/projects/${project.id}` : "/projects";
  return [
    {
      id: "claude",
      title: msg("Connect your Claude account"),
      description: msg("Agents run with your Claude Max subscription or an API key."),
      action: msg("Open Settings"),
      href: "/settings",
      done: input.claudeConfigured,
    },
    {
      id: "project",
      title: msg("Add a project"),
      description: msg("Import a repository from GitHub or register a folder on the server."),
      action: msg("Add a project"),
      href: "/projects",
      done: project !== null,
    },
    {
      id: "workspaces",
      title: msg("Check the proposed workspaces"),
      description: msg(
        "Onyx splits the project by its folders so that each agent works in one area.",
      ),
      action: msg("Open the project"),
      href: projectHref,
      done: (project?.workspaceCount ?? 0) > 0,
    },
    {
      id: "commands",
      title: msg("Allow the commands of the stack"),
      description: msg("Tests, lint and build commands the agents may run without asking."),
      action: msg("Open the commands"),
      href: `${projectHref}#allowed-commands`,
      done: (project?.allowedCommands ?? 0) > 0,
    },
    {
      id: "task",
      title: msg("Create the first task"),
      description: msg("Describe a small change: Onyx picks the workspace and the model."),
      action: msg("Create a task"),
      href: projectHref,
      done: (project?.taskCount ?? 0) > 0,
    },
  ];
}

export function onboardingDone(steps: readonly OnboardingStep[]): boolean {
  return steps.every((step) => step.done);
}
