import { describe, expect, it } from "vitest";
import {
  analyzeCommands,
  commandPrograms,
  continuePrompt,
  mergeRules,
  suggestRules,
} from "../../src/domain/command-rules";

describe("command programs", () => {
  it("lists every program of a compound command, without cd", () => {
    expect(
      commandPrograms(
        'cd /root/Onyx/.onyx-data/projects/Usciamo-; ls -a; cat package.json; which chromium chromium-browser google-chrome; python3 -c "import playwright" 2>&1; npx --no-install playwright --version 2>&1 | tail -1',
      ),
    ).toEqual(["ls", "cat", "which", "python3", "npx", "tail"]);
  });

  it("skips environment assignments, wrappers and redirections", () => {
    expect(
      commandPrograms("CI=1 env NODE_ENV=test npm run build > out.log && node dist/a.js"),
    ).toEqual(["npm", "node"]);
    expect(commandPrograms("./node_modules/.bin/playwright install chromium")).toEqual([
      "./node_modules/.bin/playwright",
    ]);
    expect(commandPrograms("$HOME/bin/tool")).toEqual([]);
    expect(commandPrograms("echo hi\nrm -rf build")).toEqual(["echo", "rm"]);
    expect(commandPrograms("if true; then make; fi")).toEqual(["make"]);
    expect(commandPrograms("")).toEqual([]);
  });
});

describe("rule suggestions", () => {
  it("never preselects interpreters, package runners or commands that delete", () => {
    expect(
      suggestRules([
        "python3 -c 'import x'",
        "npx playwright --version",
        "rm -r dist",
        "npx foo",
      ]).map((entry) => [entry.rule, entry.safety, entry.reason]),
    ).toEqual([
      ["Bash(python3 *)", "REVIEW", "runs any code it is given, not just one command"],
      ["Bash(npx *)", "REVIEW", "downloads and runs any package"],
      ["Bash(rm *)", "REVIEW", "can delete or change files"],
    ]);
  });

  it("proposes the program behind wrappers and subshells, never the wrapper (A9)", () => {
    const rules = (command: string) =>
      suggestRules([command]).map((entry) => [entry.rule, entry.safety]);
    expect(rules("timeout 5 rm -rf ~")).toEqual([["Bash(rm *)", "REVIEW"]]);
    expect(rules("nice -n 5 rm -rf /")).toEqual([["Bash(rm *)", "REVIEW"]]);
    expect(rules("(cd x; make)")).toEqual([["Bash(make *)", "REVIEW"]]);
    expect(rules("find . -name x | xargs rm")).toEqual([
      ["Bash(find *)", "REVIEW"],
      ["Bash(rm *)", "REVIEW"],
    ]);
    expect(suggestRules(["timeout 60 pnpm test"])[0]).toMatchObject({
      rule: "Bash(pnpm test *)",
      safety: "SAFE",
      reason: "the agent ran it through timeout: the rule covers the command without timeout",
      command: "timeout 60 pnpm test",
    });
  });

  it("scopes package managers and git to the subcommand", () => {
    const rules = (command: string) =>
      suggestRules([command]).map((entry) => [entry.rule, entry.safety]);
    expect(rules("pnpm run build")).toEqual([["Bash(pnpm run build *)", "SAFE"]]);
    expect(rules("pnpm --filter api test --run")).toEqual([
      ["Bash(pnpm --filter api test *)", "SAFE"],
    ]);
    expect(rules("npm install lodash")).toEqual([["Bash(npm install *)", "REVIEW"]]);
    expect(rules("pnpm exec tsx a.ts")).toEqual([["Bash(pnpm exec *)", "REVIEW"]]);
    expect(rules("git status --short")).toEqual([["Bash(git status *)", "SAFE"]]);
    expect(rules("vitest run src")).toEqual([["Bash(vitest *)", "SAFE"]]);
  });

  it("refuses privileged commands and pushes instead of proposing them", () => {
    expect(analyzeCommands(["sudo apt install x", "git -C . push origin main"])).toEqual({
      suggestions: [],
      refused: [
        {
          command: "sudo apt install x",
          program: "sudo",
          reason: "runs commands as another user",
        },
        {
          command: "git -C . push origin main",
          program: "git push",
          reason: "Onyx pushes the branches: agents never push",
        },
      ],
    });
  });

  it("merges rules without duplicates or malformed entries", () => {
    expect(
      mergeRules(["Bash(npm *)"], ["Bash(npm *)", " Bash(npx *) ", "Read(**)", "Bash()"]),
    ).toEqual(["Bash(npm *)", "Bash(npx *)"]);
  });

  it("tells the agent what changed and passes the reply on", () => {
    expect(continuePrompt(["Bash(npx *)", "Bash(python3 *)"], undefined)).toBe(
      "The commands you could not run before are now allowed: npx *, python3 *. Continue the task.",
    );
    expect(
      continuePrompt(["Bash(npx *)"], "Sì, installa Playwright. Solo le schermate dell'invito."),
    ).toBe(
      "The commands you could not run before are now allowed: npx *.\n\nSì, installa Playwright. Solo le schermate dell'invito.",
    );
  });
});
