import type { MergeResolutionDto, QaReviewDto } from "@onyx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { localizeQaReview, localizeResolution } from "../../src/application/review-service";
import { rememberLocale, runWithLocale, tx } from "../../src/i18n";

const review: QaReviewDto = {
  id: "review-1",
  attempt: 1,
  verdict: "ERROR",
  summary: "The review returned no verdict",
  criteria: [
    { index: 1, text: "It works", met: false, evidence: "Not reviewed" },
    { index: 2, text: "It is tested", met: true, evidence: "src/a.ts:3 `it()`" },
  ],
  issues: [],
  diffTokens: 10,
  diffTruncated: false,
  modelId: "claude-test",
  costUsd: null,
  createdAt: new Date(0).toISOString(),
};

const resolution: MergeResolutionDto = {
  id: "resolution-1",
  state: "FAILED",
  files: ["src/a.ts"],
  diff: "",
  checks: "No test runner: tests not run.",
  checksPassed: null,
  modelId: "claude-test",
  costUsd: null,
  message: "Conflict markers are still in src/a.ts",
  createdAt: new Date(0).toISOString(),
  decidedAt: null,
};

describe("plan texts", () => {
  afterEach(() => rememberLocale("en"));

  it("renders the fixed plan and loop messages in Italian", () => {
    runWithLocale("it", () => {
      expect(tx("Waiting for a merge decision in Approvals")).toBe(
        "In attesa di una decisione sul merge in Approvazioni",
      );
      expect(tx("A task it depends on failed")).toBe("Un task da cui dipende non è riuscito");
      expect(tx("Stopped by the operator")).toBe("Fermato dall'operatore");
    });
  });

  it("keeps the English messages unchanged", () => {
    runWithLocale("en", () => {
      expect(tx("Waiting for a merge decision in Approvals")).toBe(
        "Waiting for a merge decision in Approvals",
      );
      expect(localizeQaReview(review)).toEqual(review);
      expect(localizeResolution(resolution)).toEqual(resolution);
    });
  });

  it("translates only the texts Onyx writes in reviews and resolutions", () => {
    runWithLocale("it", () => {
      const shown = localizeQaReview(review);
      expect(shown.summary).toBe("La revisione non ha restituito un verdetto");
      expect(shown.criteria.map((criterion) => criterion.evidence)).toEqual([
        "Non verificato",
        "src/a.ts:3 `it()`",
      ]);
      const resolved = localizeResolution(resolution);
      expect(resolved.checks).toBe("Nessun test runner: test non eseguiti.");
      expect(resolved.message).toBe("Conflict markers are still in src/a.ts");
    });
  });
});
