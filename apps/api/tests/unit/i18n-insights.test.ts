import type { Insight } from "@onyx/db";
import { describe, expect, it } from "vitest";
import { answerFromIndex, toInsightDto } from "../../src/application/insight-service";
import type { ProjectContext } from "../../src/application/project-context";
import { graphFindings, parseNpmAudit, translateFinding } from "../../src/domain/ideation";
import { runWithLocale } from "../../src/i18n";

const context = {
  cycles: () => [["src/a.ts", "src/b.ts"]],
  definitions: () => [
    {
      relPath: "src/math.ts",
      line: 1,
      kind: "function",
      exported: true,
      signature: "add(a, b)",
    },
  ],
  findFile: () => null,
  importers: () => ["src/cart.ts"],
  mentions: () => [{ relPath: "src/cart.ts", line: 4, text: "add(1, 2)" }],
  imports: () => ({ internal: ["src/math.ts"], external: ["zod", "pino"] }),
  topFiles: () => [],
  largestFiles: () => [{ relPath: "src/big.ts", rawTokens: 12345 }],
} as unknown as ProjectContext;

function stored(answer: string): Insight {
  return {
    id: "insight-1",
    projectId: "project-1",
    question: "q",
    intent: "USAGES",
    mode: "INDEX",
    answer,
    sources: [],
    modelId: null,
    costUsd: null,
    tokens: null,
    createdAt: new Date("2026-10-04T12:00:00.000Z"),
  } as Insight;
}

function shown(intent: "USAGES" | "CYCLES" | "IMPORTS" | "LARGEST", locale: "it" | "en") {
  const answer = answerFromIndex(context, { intent, subject: "add" })?.answer ?? "";
  return runWithLocale(locale, () => toInsightDto(stored(answer)).answer);
}

describe("insight answers in Italian", () => {
  it("stores English and translates index answers when they are read", () => {
    const answer = answerFromIndex(context, { intent: "USAGES", subject: "add" })?.answer;
    expect(answer).toContain("`add` is defined in `src/math.ts:1` and used in 1 place:");
    expect(shown("USAGES", "en")).toBe(answer);
    expect(shown("USAGES", "it")).toBe(
      [
        "`add` è definito in `src/math.ts:1` e usato in 1 punto:",
        "",
        "- `src/cart.ts:4` — `add(1, 2)`",
        "",
        "_Dal grafo degli import e da una ricerca testuale nei file che importano: possono mancare import dinamici, riesportazioni tramite stringhe e codice generato. Chiedi al modello quando conta._",
      ].join("\n"),
    );
    expect(shown("CYCLES", "it")).toContain("1 ciclo di import:");
    expect(shown("IMPORTS", "it")).toContain(
      "`src/math.ts` importa 1 file del progetto e 2 pacchetti (zod, pino):",
    );
    expect(shown("LARGEST", "it")).toContain("- `src/big.ts` — ~12,345 token");
  });

  it("leaves model answers as Claude wrote them", () => {
    const row = { ...stored("From the index."), mode: "MODEL" } as Insight;
    expect(runWithLocale("it", () => toInsightDto(row).answer)).toBe("From the index.");
  });
});

describe("ideation findings in Italian", () => {
  it("translates rule texts at read time and keeps Claude's explanations", () => {
    const [cycle, hotspot] = graphFindings({
      cycles: [["a.ts", "b.ts"]],
      hotspots: [{ relPath: "core.ts", rawTokens: 9000, inDegree: 12 }],
    });
    const [vulnerable] = parseNpmAudit(
      { vulnerabilities: { lodash: { severity: "high", via: [{ title: "Pollution" }] } } },
      "package.json",
    );
    if (!cycle || !hotspot || !vulnerable) throw new Error("missing findings");
    expect(runWithLocale("it", () => translateFinding(cycle).title)).toBe("Ciclo di import");
    expect(runWithLocale("it", () => translateFinding(hotspot).excerpt)).toBe(
      "~9000 token, importato da 12 file",
    );
    expect(runWithLocale("it", () => translateFinding(vulnerable).title)).toBe(
      "Dipendenza vulnerabile: lodash",
    );
    expect(runWithLocale("en", () => translateFinding(hotspot))).toEqual({
      title: "Large file many others depend on",
      excerpt: "~9000 tokens, imported by 12 files",
      explanation: hotspot.explanation,
    });
    expect(
      runWithLocale("it", () =>
        translateFinding({ ...cycle, explanation: "Only types are imported." }),
      ).explanation,
    ).toBe("Only types are imported.");
  });
});
