import { describe, expect, it } from "vitest";
import {
  capPerRule,
  fingerprint,
  graphFindings,
  parseNpmAudit,
  readReview,
  reviewPrompt,
  scanSource,
  snippet,
} from "../../src/domain/ideation";
import { citedSources, classifyQuestion, questionSubject } from "../../src/domain/insights";
import { ideationRow, insightsRow } from "../../src/domain/savings";

describe("insight questions", () => {
  it("recognises questions in English and Italian", () => {
    expect(classifyQuestion("Where is `formatPrice` used?")).toEqual({
      intent: "USAGES",
      subject: "formatPrice",
    });
    expect(classifyQuestion("Dove si usa calculateTotal?")).toEqual({
      intent: "USAGES",
      subject: "calculateTotal",
    });
    expect(classifyQuestion("Who imports src/lib/db.ts?")).toEqual({
      intent: "IMPORTERS",
      subject: "src/lib/db.ts",
    });
    expect(classifyQuestion("chi importa utils.ts")).toEqual({
      intent: "IMPORTERS",
      subject: "utils.ts",
    });
    expect(classifyQuestion("What does apps/api/src/server.ts import?")).toMatchObject({
      intent: "IMPORTS",
      subject: "apps/api/src/server.ts",
    });
    expect(classifyQuestion("Where is TaskService defined?")).toEqual({
      intent: "DEFINITION",
      subject: "TaskService",
    });
    expect(classifyQuestion("Dove è definito parseConfig")).toMatchObject({ intent: "DEFINITION" });
    expect(classifyQuestion("Which are the most central files?").intent).toBe("CENTRAL");
    expect(classifyQuestion("Quali sono i file più grandi?").intent).toBe("LARGEST");
    expect(classifyQuestion("Ci sono dipendenze circolari?").intent).toBe("CYCLES");
    expect(classifyQuestion("How does checkout handle refunds?").intent).toBe("OPEN");
  });

  it("prefers quoted names, then paths, then code-like words", () => {
    expect(questionSubject('where is "user.id" read')).toBe("user.id");
    expect(questionSubject("who uses the cart helper in web/badge.ts")).toBe("web/badge.ts");
    expect(questionSubject("where is the getUser function used")).toBe("getUser");
    expect(questionSubject("where is it")).toBeNull();
  });

  it("collects the files a model answer cites", () => {
    expect(citedSources("See `src/a.ts:12` and src/b/c.tsx, not e.g. or v1.2")).toEqual([
      { path: "src/a.ts", line: 12 },
      { path: "src/b/c.tsx", line: null },
    ]);
  });
});

describe("ideation rules", () => {
  it("flags unsafe calls and leaves comments and safe code alone", () => {
    const source = [
      "// eval(x) in a comment",
      "export function run(input: string) {",
      "  const value = eval(input);",
      "  db.query(`SELECT * FROM users WHERE id = ${input}`);",
      '  db.query("SELECT * FROM users WHERE id = ?", [input]);',
      "  el.innerHTML = input;",
      '  const apiKey = "sk_live_0123456789abcdef";',
      "  const token = Math.random().toString(36);",
      "  return value;",
      "}",
    ].join("\n");
    const rules = scanSource("src/run.ts", "typescript", source).map((finding) => [
      finding.rule,
      finding.line,
    ]);
    expect(rules).toEqual([
      ["eval", 3],
      ["sql-concatenation", 4],
      ["html-injection", 6],
      ["hardcoded-secret", 7],
      ["insecure-random", 8],
    ]);
    expect(
      scanSource("src/run.test.ts", "typescript", '  const apiKey = "sk_live_0123456789abcdef";'),
    ).toEqual([]);
  });

  it("finds queries and awaits inside loops", () => {
    const source = [
      "export async function load(ids: string[]) {",
      "  for (const id of ids) {",
      "    const user = await prisma.user.findUnique({ where: { id } });",
      "    await notify(user);",
      "  }",
      "  const all = await prisma.user.findMany();",
      "  return all;",
      "}",
    ].join("\n");
    expect(
      scanSource("src/load.ts", "typescript", source).map((finding) => [
        finding.rule,
        finding.line,
      ]),
    ).toEqual([
      ["query-in-loop", 3],
      ["await-in-loop", 4],
    ]);
  });

  it("checks Python and server-only rules", () => {
    expect(scanSource("app/load.py", "python", "data = pickle.loads(raw)")[0]?.rule).toBe(
      "python-unsafe",
    );
    expect(
      scanSource("src/routes/users.ts", "typescript", "const x = readFileSync(path);")[0]?.rule,
    ).toBe("sync-fs-in-server");
    expect(scanSource("scripts/build.ts", "typescript", "const x = readFileSync(path);")).toEqual(
      [],
    );
  });

  it("turns cycles and hotspots into findings and caps each rule", () => {
    const graph = graphFindings({
      cycles: [["a.ts", "b.ts"]],
      hotspots: [{ relPath: "core.ts", rawTokens: 9000, inDegree: 12 }],
    });
    expect(graph.map((finding) => [finding.rule, finding.excerpt])).toEqual([
      ["import-cycle", "a.ts → b.ts → a.ts"],
      ["hotspot", "~9000 tokens, imported by 12 files"],
    ]);
    const many = Array.from({ length: 30 }, () => graph[0] ?? graph[1]).filter(
      (entry) => entry !== undefined,
    );
    expect(capPerRule(many)).toHaveLength(25);
  });

  it("reads npm audit reports in both formats", () => {
    expect(
      parseNpmAudit(
        {
          vulnerabilities: {
            lodash: { severity: "high", via: [{ title: "Prototype pollution" }] },
          },
        },
        "package.json",
      ),
    ).toMatchObject([
      { title: "Vulnerable dependency: lodash", severity: "HIGH", excerpt: "Prototype pollution" },
    ]);
    expect(
      parseNpmAudit(
        { advisories: { 1: { module_name: "minimist", severity: "low", title: "Bad" } } },
        "package.json",
      ),
    ).toMatchObject([{ title: "Vulnerable dependency: minimist", severity: "LOW" }]);
    expect(parseNpmAudit(null, "package.json")).toEqual([]);
  });

  it("fingerprints a finding by rule, file and code, not by line", () => {
    const base = { rule: "eval", file: "a.ts", excerpt: "eval(x)" };
    expect(fingerprint(base)).toBe(fingerprint({ ...base, excerpt: "eval(x)  " }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, file: "b.ts" }));
  });

  it("shows the flagged line with its neighbours", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const shown = snippet(text, 10, 2).split("\n");
    expect(shown).toEqual([
      "    8  line 8",
      "    9  line 9",
      "   10> line 10",
      "   11  line 11",
      "   12  line 12",
    ]);
  });

  it("keeps only known items from the model review", () => {
    const prompt = reviewPrompt([
      { id: "1", title: "Eval", rule: "eval", file: "a.ts", snippet: "eval(x)" },
    ]);
    expect(prompt).toContain("## Item 1: Eval (eval)\na.ts");
    expect(
      readReview(
        {
          findings: [
            { id: "1", verdict: "false_positive", confidence: 3, explanation: "Constant" },
            { id: "9", verdict: "real", confidence: 0.9, explanation: "x" },
            { id: "1", verdict: "maybe", confidence: 0.5, explanation: "x" },
          ],
        },
        new Set(["1"]),
      ),
    ).toEqual([
      { id: "1", verdict: "FALSE_POSITIVE", confidence: 1, explanation: "Constant", fix: null },
    ]);
  });
});

describe("savings rows", () => {
  it("estimates what index answers saved from measured model answers", () => {
    expect(insightsRow({ index: 0, model: 0, modelTokens: [], windowDays: 30 }).evidence).toBe(
      "ESTIMATED",
    );
    const row = insightsRow({ index: 3, model: 1, modelTokens: [5000], windowDays: 30 });
    expect(row).toMatchObject({ tokens: 15000, runs: 4 });
    expect(row.detail).toContain(
      "3 of 4 answers came from the index without a model (75%, measured)",
    );
    expect(insightsRow({ index: 2, model: 0, modelTokens: [], windowDays: 30 }).tokens).toBe(16000);
  });

  it("compares the snippets Claude read with the analysed code", () => {
    expect(
      ideationRow({
        analyses: 2,
        reviews: 0,
        snippetTokens: 0,
        projectTokens: 0,
        modelTokens: 0,
        usd: 0,
        windowDays: 30,
      }).detail,
    ).toContain("2 analyses without a model");
    const row = ideationRow({
      analyses: 1,
      reviews: 1,
      snippetTokens: 2000,
      projectTokens: 50000,
      modelTokens: 6000,
      usd: 0.01,
      windowDays: 30,
    });
    expect(row).toMatchObject({ evidence: "ESTIMATED", tokens: 48000, runs: 1 });
    expect(
      ideationRow({
        analyses: 1,
        reviews: 1,
        snippetTokens: 800,
        projectTokens: 400,
        modelTokens: 9000,
        usd: 0.003,
        windowDays: 30,
      }),
    ).toMatchObject({ tokens: 0 });
  });
});
