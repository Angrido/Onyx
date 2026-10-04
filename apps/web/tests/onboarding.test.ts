import { describe, expect, it } from "vitest";
import { onboardingDone, onboardingSteps } from "@/lib/onboarding";

describe("getting started", () => {
  it("starts from the Claude account on an empty Onyx", () => {
    const steps = onboardingSteps({ claudeConfigured: false, firstProject: null });
    expect(steps.map((step) => [step.id, step.done, step.href])).toEqual([
      ["claude", false, "/settings"],
      ["project", false, "/projects"],
      ["workspaces", false, "/projects"],
      ["commands", false, "/projects#allowed-commands"],
      ["task", false, "/projects"],
    ]);
    expect(onboardingDone(steps)).toBe(false);
  });

  it("points the project steps to the first project and ends when all are done", () => {
    const partial = onboardingSteps({
      claudeConfigured: true,
      firstProject: { id: "p1", workspaceCount: 3, allowedCommands: 0, taskCount: 0 },
    });
    expect(partial.filter((step) => !step.done).map((step) => [step.id, step.href])).toEqual([
      ["commands", "/projects/p1#allowed-commands"],
      ["task", "/projects/p1"],
    ]);
    expect(
      onboardingDone(
        onboardingSteps({
          claudeConfigured: true,
          firstProject: { id: "p1", workspaceCount: 3, allowedCommands: 4, taskCount: 1 },
        }),
      ),
    ).toBe(true);
  });
});
