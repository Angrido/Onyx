import { describe, expect, it } from "vitest";
import {
  buildRoadmapPrompt,
  collectTodos,
  MAX_ROADMAP_ITEMS,
  parseRoadmap,
  ROADMAP_MARKER,
  taskPromptFor,
  withoutDuplicates,
} from "../../src/domain/roadmap";

describe("roadmap parsing", () => {
  it("reads a fenced JSON answer and normalises loose values", () => {
    const proposal = parseRoadmap(
      [
        "Here is the plan.",
        "```json",
        JSON.stringify({
          summary: "Healthy project.",
          items: [
            {
              title: "Add login tests",
              description: "Cover the login flow.",
              kind: "tests",
              priority: "High",
              effort: "small",
              workspace: "Backend",
              targetPaths: ["./apps/api/src/login.ts", "apps/api/src/login.ts"],
              rationale: "",
            },
            {
              title: "Fix the header",
              description: "Align it.",
              kind: "UI",
              priority: "p3",
              effort: "XL",
            },
            { title: "add login tests", description: "Duplicate", kind: "FEATURE" },
            { title: "x", description: "too short a title" },
          ],
        }),
        "```",
      ].join("\n"),
    );
    expect(proposal.summary).toBe("Healthy project.");
    expect(proposal.items).toEqual([
      {
        title: "Add login tests",
        description: "Cover the login flow.",
        kind: "TEST_FIX",
        priority: "HIGH",
        effort: "S",
        workspace: "Backend",
        targetPaths: ["apps/api/src/login.ts"],
        rationale: null,
      },
      {
        title: "Fix the header",
        description: "Align it.",
        kind: "UI_STYLE",
        priority: "LOW",
        effort: "L",
        workspace: null,
        targetPaths: [],
        rationale: null,
      },
    ]);
  });

  it("finds a bare JSON object inside prose and caps the list", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      title: `Task number ${index}`,
      description: "Do it.",
      kind: "CHORE",
    }));
    const proposal = parseRoadmap(`Sure! ${JSON.stringify({ items })} Done.`);
    expect(proposal.items).toHaveLength(MAX_ROADMAP_ITEMS);
    expect(() => parseRoadmap("No JSON at all")).toThrow(/expected JSON format/);
  });

  it("drops titles that are already planned", () => {
    const proposal = parseRoadmap(
      JSON.stringify({
        items: [
          { title: "Keep me", description: "a" },
          { title: "Already There", description: "b" },
        ],
      }),
    );
    expect(withoutDuplicates(proposal.items, ["already there"]).map((item) => item.title)).toEqual([
      "Keep me",
    ]);
  });
});

describe("roadmap knowledge", () => {
  it("collects TODO notes with their location", () => {
    expect(
      collectTodos([
        { relPath: "src/a.ts", content: "const a = 1;\nlet b = 2; TODO: validate input\n" },
        { relPath: "src/b.py", content: "# FIXME handle timeouts" },
      ]),
    ).toEqual(["src/a.ts:2 TODO: validate input", "src/b.py:1 FIXME: handle timeouts"]);
  });

  it("builds a prompt with the marker, language and only the sections it has", () => {
    const prompt = buildRoadmapPrompt({
      projectName: "shop",
      language: "it",
      focus: null,
      map: "src/a.ts ~10",
      readme: null,
      manifests: [],
      todos: ["src/a.ts:2 TODO: validate input"],
      gitLog: [],
      workspaces: [{ name: "Frontend", domain: "FRONTEND", pathGlobs: ["apps/web/**"] }],
      existingTitles: ["Old task"],
    });
    expect(prompt.startsWith(ROADMAP_MARKER)).toBe(true);
    expect(prompt).toContain("in Italian");
    expect(prompt).toContain("- Frontend (FRONTEND): apps/web/**");
    expect(prompt).toContain("- Old task");
    expect(prompt).not.toContain("## README");
    expect(prompt).not.toContain("## Operator focus");
  });

  it("turns a suggestion into a task prompt", () => {
    expect(
      taskPromptFor({
        description: "Do X.",
        rationale: "Because Y.",
        targetPaths: ["a.ts", "b.ts"],
      }),
    ).toBe("Do X.\n\nWhy: Because Y.\n\nFiles likely involved: a.ts, b.ts");
  });
});
