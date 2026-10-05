import { describe, expect, it } from "vitest";
import {
  compareArms,
  conflictResolutionRow,
  quotaRow,
  savingsVerdict,
  type ArmSample,
} from "../../src/domain/savings";
import { runWithLocale } from "../../src/i18n";

const settings = { enabled: true, controlShare: 0.25, variant: null };

function sample(contextTokens: number): ArmSample {
  return {
    completed: true,
    contextTokens,
    outputTokens: 500,
    costUsd: null,
    turns: 4,
    readFiles: 3,
  };
}

const pack = {
  windowDays: 30,
  runs: 4,
  runsWithPack: 4,
  controlRuns: 0,
  baselineTokens: 10_000,
  deliveredTokens: 4_000,
  rereadTokens: 0,
  grossSaving: 0.6,
  netSaving: 0.6,
  runsWithRereads: 0,
  rereadFiles: 0,
  readFiles: 4,
  missedFiles: 0,
  expansions: 0,
  topRereads: [],
};

const collecting = compareArms({
  settings,
  pack: [sample(1_000), sample(1_200)],
  control: [sample(2_000), sample(2_200)],
  windowDays: 90,
  since: null,
});

describe("savings texts in Italian", () => {
  it("translates the verdict and keeps English as before", () => {
    const english = savingsVerdict(collecting, pack);
    expect(english.headline).toBe("Measuring: 2 of 10 runs per arm so far");
    expect(english.detail).toBe(
      "The experiment needs 10 finished runs with and without the context before it can tell. Until then the estimate says an estimated 60% fewer context tokens.",
    );
    const italian = runWithLocale("it", () => savingsVerdict(collecting, pack));
    expect(italian.headline).toBe("Misurazione in corso: finora 2 run su 10 per gruppo");
    expect(italian.detail).toBe(
      "L'esperimento ha bisogno di 10 run concluse con e senza il contesto prima di potersi esprimere. Fino ad allora la stima indica il 60% di token di contesto in meno.",
    );
  });

  it("picks singular and plural sentences in the ledger", () => {
    const input = {
      proposals: 1,
      applied: 1,
      unusable: 0,
      refused: 0,
      usd: 0.12,
      windowDays: 30,
    };
    expect(runWithLocale("it", () => conflictResolutionRow(input).detail)).toBe(
      "Un costo, non un risparmio: 1 conflitto affidato a Claude per $0.120 negli ultimi 30 giorni; applicati: 1, rifiutati: 0, non utilizzabili: 0 (marcatori rimasti o test falliti).",
    );
    expect(
      runWithLocale("en", () => conflictResolutionRow({ ...input, proposals: 2 }).detail),
    ).toBe(
      "A cost, not a saving: 2 conflicts handed to Claude for $0.120 in the last 30 days; 1 applied, 0 refused and 0 not usable (markers left or tests failing).",
    );
    const quota = { deferredRuns: 1, limitedRuns: 3, windowDays: 30 };
    expect(runWithLocale("it", () => quotaRow(quota).detail)).toBe(
      "Negli ultimi 30 giorni: 1 run in attesa che la finestra dell'abbonamento si azzerasse, 3 run al limite mentre lavoravano. Trattenere i task sposta la spesa dopo l'azzeramento invece di ridurla.",
    );
    expect(runWithLocale("en", () => quotaRow(quota).detail)).toBe(
      "In the last 30 days 1 run waited for the subscription window to reset and 3 runs hit the limit while working. Holding moves the spend after the reset instead of reducing it.",
    );
  });
});
