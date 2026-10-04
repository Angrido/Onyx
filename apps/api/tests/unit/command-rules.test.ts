import { describe, expect, it } from "vitest";
import {
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
    expect(commandPrograms("")).toEqual([]);
  });
});

describe("rule suggestions", () => {
  it("proposes one rule per program and flags the risky ones", () => {
    expect(
      suggestRules(["python3 -c 'import x'", "npx playwright --version", "rm -r dist", "npx foo"]),
    ).toEqual([
      { rule: "Bash(python3 *)", program: "python3", risky: false },
      { rule: "Bash(npx *)", program: "npx", risky: false },
      { rule: "Bash(rm *)", program: "rm", risky: true },
    ]);
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
