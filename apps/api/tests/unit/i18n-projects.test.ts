import { describe, expect, it } from "vitest";
import { analyzeCommands } from "../../src/domain/command-rules";
import { detectStack, type StackFacts } from "../../src/domain/stack-commands";
import { runWithLocale } from "../../src/i18n";

const facts: StackFacts = {
  files: new Set(["package.json", "pnpm-lock.yaml", "go.mod", "Makefile"]),
  packageJson: { scripts: { test: "vitest" } },
  makeTargets: ["build"],
  pyproject: null,
};

function reasons(): Record<string, string> {
  return Object.fromEntries(
    detectStack(facts).commands.map((command) => [command.command, command.reason]),
  );
}

describe("project texts in Italian", () => {
  it("describes the proposed stack commands in the chosen language", () => {
    const italian = runWithLocale("it", reasons);
    expect(italian["pnpm run test"]).toBe('Lo script "test" di package.json');
    expect(italian["go test"]).toBe("Esegue i test Go");
    expect(italian["make build"]).toBe('Il target "build" del Makefile');
    const english = runWithLocale("en", reasons);
    expect(english["pnpm run test"]).toBe('The "test" script of package.json');
    expect(english["make build"]).toBe('The "build" target of the Makefile');
  });

  it("explains blocked and refused commands in the chosen language", () => {
    const commands = ["timeout 5 pnpm add left-pad", "sudo ls", "git push origin main"];
    const italian = runWithLocale("it", () => analyzeCommands(commands));
    expect(italian.suggestions[0]?.reason).toBe(
      "installa pacchetti, che possono eseguire i propri script",
    );
    expect(italian.refused.map((entry) => entry.reason)).toEqual([
      "esegue comandi come un altro utente",
      "Onyx fa il push dei branch: gli agenti non fanno mai push",
    ]);
    const english = runWithLocale("en", () => analyzeCommands(commands));
    expect(english.refused.map((entry) => entry.reason)).toEqual([
      "runs commands as another user",
      "Onyx pushes the branches: agents never push",
    ]);
  });
});
