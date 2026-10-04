import type {
  IdeationDto,
  InsightDto,
  InsightListResponse,
  ProjectDetailDto,
  SavingsReport,
  TaskDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

const FILES = {
  "src/cart.ts": [
    'import { add } from "./math";',
    'import { label } from "./labels";',
    "export function total(prices: number[]): number {",
    "  return prices.reduce((sum, price) => add(sum, price), 0);",
    "}",
    "export const title = label;",
    "",
  ].join("\n"),
  "src/labels.ts": [
    'import { total } from "./cart";',
    "export const label = `Total ${total([])}`;",
    "",
  ].join("\n"),
  "src/server/routes.ts": [
    "export async function users(db: { query(sql: string): Promise<unknown> }, ids: string[], name: string) {",
    "  const rows = await db.query(`SELECT * FROM users WHERE name = '${name}'`);",
    "  for (const id of ids) {",
    "    await db.query(`SELECT * FROM orders WHERE user = ${id}`);",
    "  }",
    '  const safe = eval("1 + 1"); const marker = "stub-fp";',
    "  return rows;",
    "}",
    "",
  ].join("\n"),
};

async function ask(question: string, useModel = false) {
  return api.post<InsightDto>(`/api/projects/${project.id}/insights`, { question, useModel });
}

beforeAll(async () => {
  context = await createTestContext({ projectFiles: FILES });
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
});

describe("insights", () => {
  it("answers questions about the code from the index, with sources and no model", async () => {
    const usages = await ask("Where is add used?");
    expect(usages.status).toBe(201);
    expect(usages.body).toMatchObject({
      intent: "USAGES",
      mode: "INDEX",
      costUsd: null,
      sources: [{ path: "src/cart.ts", line: 4 }],
    });
    expect(usages.body.answer).toContain(
      "`add` is defined in `src/math.ts:1` and used in 1 place:",
    );
    expect(usages.body.answer).toContain("Ask the model when it matters.");

    expect((await ask("Dove è definito `total`?")).body).toMatchObject({
      intent: "DEFINITION",
      sources: [{ path: "src/cart.ts", line: 3 }],
    });
    expect((await ask("Who imports src/math.ts?")).body.sources).toEqual([
      { path: "src/cart.ts", line: null },
    ]);
    const imports = (await ask("What does src/cart.ts import?")).body;
    expect(imports.intent).toBe("IMPORTS");
    expect(imports.sources.map((source) => source.path).sort()).toEqual([
      "src/labels.ts",
      "src/math.ts",
    ]);
    const cycles = (await ask("Are there circular imports?")).body;
    expect(cycles.answer).toContain("1 import cycle:");
    expect(cycles.answer).toMatch(/src\/(cart|labels)\.ts → src\/(cart|labels)\.ts → /);
    expect((await ask("Which are the most central files?")).body.mode).toBe("INDEX");
  });

  it("asks Haiku when the index cannot answer, or when asked to, and records the cost", async () => {
    const open = await ask("How does the cart compute the total?");
    expect(open.body).toMatchObject({ intent: "OPEN", mode: "MODEL" });
    expect(open.body.answer).toContain('answers "How does the cart compute the total?"');
    expect(open.body.costUsd).toBeGreaterThan(0);
    expect(open.body.tokens).toBeGreaterThan(0);
    const forced = await ask("Where is add used?", true);
    expect(forced.body).toMatchObject({
      mode: "MODEL",
      sources: [{ path: "src/math.ts", line: 1 }],
    });
    const list = (await api.get<InsightListResponse>(`/api/projects/${project.id}/insights`)).body;
    expect(list).toMatchObject({ indexAnswers: 6, modelAnswers: 2, indexed: true });
    expect(list.items[0]?.id).toBe(forced.body.id);
    expect(await context.container.prisma.tokenLog.count({ where: { purpose: "insights" } })).toBe(
      2,
    );
    expect((await ask("hi")).status).toBe(400);
  });
});

describe("ideation", () => {
  async function analyse(): Promise<IdeationDto> {
    const started = await api.post<IdeationDto>(`/api/projects/${project.id}/ideation`);
    expect(started.status).toBe(202);
    await context.container.ideation.settled(project.id);
    return (await api.get<IdeationDto>(`/api/projects/${project.id}/ideation`)).body;
  }

  it("finds suspicious code without a model, then lets Claude check only those snippets", async () => {
    const first = await analyse();
    expect(first.run).toMatchObject({
      status: "DONE",
      audit: "No lockfile: dependency audit skipped",
      modelTokens: null,
    });
    expect(first.run?.files).toBeGreaterThanOrEqual(4);
    const rules = first.findings.map(
      (finding) => `${finding.rule}@${finding.file}:${finding.line ?? "-"}`,
    );
    expect(rules).toEqual(
      expect.arrayContaining([
        "sql-concatenation@src/server/routes.ts:2",
        "query-in-loop@src/server/routes.ts:4",
        "eval@src/server/routes.ts:6",
        expect.stringMatching(/^import-cycle@src\/(cart|labels)\.ts:-$/),
      ]),
    );
    expect(first.findings[0]?.severity).toBe("HIGH");
    expect(first.reviewable).toBe(4);

    const reviewed = (await api.post<IdeationDto>(`/api/projects/${project.id}/ideation/review`))
      .body;
    const byRule = new Map(reviewed.findings.map((finding) => [finding.rule, finding]));
    expect(byRule.get("eval")).toMatchObject({ verdict: "FALSE_POSITIVE", confidence: 0.1 });
    expect(byRule.get("sql-concatenation")).toMatchObject({
      verdict: "REAL",
      confidence: 0.85,
      fix: "Pass the value as a parameter instead.",
    });
    expect(byRule.get("import-cycle")?.verdict).toBeNull();
    expect(reviewed.reviewable).toBe(0);
    expect(reviewed.run?.modelTokens).toBeGreaterThan(0);
    expect(reviewed.run?.snippetTokens).toBeGreaterThan(0);
    expect((await api.post(`/api/projects/${project.id}/ideation/review`)).status).toBe(400);
  });

  it("turns a finding into a draft task and remembers what was dismissed", async () => {
    const current = (await api.get<IdeationDto>(`/api/projects/${project.id}/ideation`)).body;
    const sql = current.findings.find((finding) => finding.rule === "sql-concatenation");
    const evil = current.findings.find((finding) => finding.rule === "eval");
    const task = await api.post<TaskDto>(`/api/ideation/findings/${sql?.id}/task`, {});
    expect(task.status).toBe(201);
    expect(task.body).toMatchObject({
      title: "SQL built by concatenating values in routes.ts",
      kind: "BUGFIX",
      status: "DRAFT",
      priority: 10,
      targetPaths: ["src/server/routes.ts"],
    });
    expect(task.body.prompt).toContain("Suggested fix: Pass the value as a parameter instead.");
    expect((await api.post(`/api/ideation/findings/${sql?.id}/task`, {})).status).toBe(409);
    const dismissed = (await api.post<IdeationDto>(`/api/ideation/findings/${evil?.id}/dismiss`))
      .body;
    expect(dismissed.findings.find((finding) => finding.id === evil?.id)?.state).toBe("DISMISSED");

    const again = await analyse();
    expect(again.run?.id).not.toBe(current.run?.id);
    expect(again.findings.find((finding) => finding.rule === "eval")?.state).toBe("DISMISSED");
    expect(
      again.findings.find(
        (finding) => finding.rule === "sql-concatenation" && finding.line === sql?.line,
      ),
    ).toMatchObject({
      state: "TASKED",
      taskId: task.body.id,
    });
  });

  it("shows both features in Savings", async () => {
    context.container.savings.forget();
    const report = await waitFor(
      async () => (await api.get<SavingsReport>("/api/telemetry/savings")).body,
      (entry) => entry.ledger.some((row) => row.source === "ideation"),
    );
    expect(report.ledger.find((row) => row.source === "insights")?.detail).toContain(
      "6 of 8 answers came from the index without a model (75%, measured)",
    );
    expect(report.ledger.find((row) => row.source === "ideation")?.detail).toContain(
      "In 1 review the snippets",
    );
  });
});
