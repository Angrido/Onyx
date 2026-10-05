import { describe, expect, it } from "vitest";
import {
  classifyCacheLoss,
  prefixHash,
  summarizeCache,
  type CacheLossInput,
} from "../../src/domain/prompt-cache";

const STARTED = new Date("2026-10-04T10:00:00Z");
const PREFIX = prefixHash({
  modelId: "claude-sonnet-5-5",
  primer: "map",
  agents: null,
  mcpEnabled: true,
});

function input(overrides: Partial<CacheLossInput> = {}): CacheLossInput {
  return {
    sessionIsNew: false,
    firstTurn: {
      inputTokens: 3,
      outputTokens: 40,
      cacheCreationTokens: 200,
      cacheReadTokens: 30_000,
    },
    messageTokens: 200,
    modelId: "claude-sonnet-5-5",
    prefixHash: PREFIX,
    startedAt: STARTED,
    previous: {
      modelId: "claude-sonnet-5-5",
      prefixHash: PREFIX,
      endedAt: new Date(STARTED.getTime() - 60_000),
    },
    ttlMs: 5 * 60_000,
    ...overrides,
  };
}

const LOST = { inputTokens: 3, outputTokens: 40, cacheCreationTokens: 30_200, cacheReadTokens: 0 };

describe("prompt cache classification", () => {
  it("does not count the first run of a session as a loss", () => {
    expect(classifyCacheLoss(input({ sessionIsNew: true, firstTurn: LOST }))).toEqual({
      reason: "NEW_SESSION",
      readTokens: 0,
      writeTokens: 30_200,
      lostTokens: null,
    });
  });

  it("sees a resume that reads its history from the cache", () => {
    expect(classifyCacheLoss(input())).toMatchObject({ reason: "NONE", lostTokens: 0 });
  });

  it("names why a resume had to write its history again", () => {
    expect(classifyCacheLoss(input({ firstTurn: LOST, modelId: "claude-opus-5-5" }))).toMatchObject(
      {
        reason: "MODEL_CHANGED",
        lostTokens: 30_003,
      },
    );
    expect(classifyCacheLoss(input({ firstTurn: LOST, prefixHash: "other" })).reason).toBe(
      "PREFIX_CHANGED",
    );
    expect(
      classifyCacheLoss(
        input({
          firstTurn: LOST,
          previous: {
            modelId: "claude-sonnet-5-5",
            prefixHash: PREFIX,
            endedAt: new Date(STARTED.getTime() - 6 * 60_000),
          },
        }),
      ).reason,
    ).toBe("EXPIRED");
    expect(classifyCacheLoss(input({ firstTurn: LOST })).reason).toBe("UNKNOWN");
    expect(classifyCacheLoss(input({ firstTurn: LOST, previous: null })).reason).toBe("UNKNOWN");
  });

  it("ignores runs that never reached the model", () => {
    expect(classifyCacheLoss(input({ firstTurn: null })).reason).toBeNull();
  });

  it("hashes the parts of the prompt that the cache depends on", () => {
    const base = { modelId: "m", primer: "p", agents: { a: 1 }, mcpEnabled: true };
    expect(prefixHash(base)).toBe(prefixHash({ ...base }));
    expect(prefixHash(base)).not.toBe(prefixHash({ ...base, primer: "q" }));
    expect(prefixHash(base)).not.toBe(prefixHash({ ...base, mcpEnabled: false }));
  });

  it("sums the losses by reason, biggest first", () => {
    expect(
      summarizeCache([
        { reason: "NEW_SESSION", runs: 3, lostTokens: 0, readTokens: 0 },
        { reason: "NONE", runs: 1, lostTokens: 0, readTokens: 30_000 },
        { reason: "EXPIRED", runs: 2, lostTokens: 25_000, readTokens: 0 },
        { reason: "PREFIX_CHANGED", runs: 1, lostTokens: 20_000, readTokens: 0 },
      ]),
    ).toEqual({
      resumedRuns: 4,
      runsWithLoss: 3,
      lostTokens: 45_000,
      readTokens: 30_000,
      byReason: [
        { reason: "EXPIRED", runs: 2, lostTokens: 25_000 },
        { reason: "PREFIX_CHANGED", runs: 1, lostTokens: 20_000 },
      ],
    });
  });
});
