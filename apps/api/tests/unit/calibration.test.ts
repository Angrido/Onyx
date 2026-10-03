import type { PrismaClient } from "@onyx/db";
import { AdjustableTokenEstimator } from "@onyx/lean-ctx";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { CalibrationService } from "../../src/application/calibration-service";
import type { ReferenceTokenizer } from "../../src/infrastructure/token-meter";

const fixedRatio = (ratio: number): ReferenceTokenizer => ({
  name: "o200k_base",
  count: (texts) => Promise.resolve(texts.map((text) => Math.ceil(text.length / ratio))),
});

function service(tokenizer: ReferenceTokenizer, estimator = new AdjustableTokenEstimator()) {
  const stored: unknown[] = [];
  const prisma = {
    appSetting: {
      findUnique: () => Promise.resolve(null),
      upsert: (args: unknown) => {
        stored.push(args);
        return Promise.resolve(args);
      },
    },
  } as unknown as PrismaClient;
  return {
    estimator,
    stored,
    calibration: new CalibrationService({
      prisma,
      estimator,
      tokenizer: () => tokenizer,
      logger: pino({ level: "silent" }),
    }),
  };
}

describe("token calibration", () => {
  it("fits a ratio for a kind represented by one large file", async () => {
    const { calibration, estimator, stored } = service(fixedRatio(2));
    const json = `[${'{"id":1},'.repeat(1_000)}]`;
    const result = await calibration.calibrate([
      { kind: "json", text: json },
      { kind: "typescript", text: "export const a = 1;\n".repeat(400) },
    ]);
    expect(result.ratios["json"]).toBe(2);
    expect(estimator.estimate(json, "json")).toBe(Math.ceil(json.length / 2));
    expect(stored).toHaveLength(1);
  });

  it("keeps the measured ratio of files without a kind as the fallback", async () => {
    const { calibration } = service(fixedRatio(4));
    const result = await calibration.calibrate([
      { kind: null, text: "INFO started\n".repeat(400) },
      { kind: "typescript", text: "x".repeat(50) },
    ]);
    expect(result.ratios["*"]).toBe(4);
    expect(result.ratios["typescript"]).toBeUndefined();
  });
});
