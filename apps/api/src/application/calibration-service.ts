import { createHash } from "node:crypto";
import { TokenCalibrationSchema, type TokenCalibration } from "@onyx/contracts";
import type { Prisma, PrismaClient } from "@onyx/db";
import { FALLBACK_RATIO_KEY, type AdjustableTokenEstimator } from "@onyx/lean-ctx";
import type { Logger } from "pino";
import type { ReferenceTokenizer } from "../infrastructure/token-meter";

export const CALIBRATION_SETTING_KEY = "tokens.calibration";

export interface CalibrationSample {
  kind: string | null;
  text: string;
}

export interface CalibrationServiceDeps {
  prisma: PrismaClient;
  estimator: AdjustableTokenEstimator;
  tokenizer: () => ReferenceTokenizer;
  logger: Logger;
}

const MAX_FILES_PER_KIND = 60;
const MAX_CHARS_PER_KIND = 400_000;
const MIN_FILES_PER_KIND = 2;
const MIN_CHARS_PER_KIND = 4_000;

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export class CalibrationService {
  private current: TokenCalibration | null = null;

  constructor(private readonly deps: CalibrationServiceDeps) {}

  get calibration(): TokenCalibration | null {
    return this.current;
  }

  get fingerprint(): string | undefined {
    return this.current?.fingerprint;
  }

  get referenceName(): TokenCalibration["reference"] {
    return this.deps.tokenizer().name;
  }

  async load(): Promise<void> {
    const setting = await this.deps.prisma.appSetting.findUnique({
      where: { key: CALIBRATION_SETTING_KEY },
    });
    const parsed = TokenCalibrationSchema.safeParse(setting?.value);
    if (!parsed.success) return;
    this.apply(parsed.data);
  }

  async measure(texts: readonly string[]): Promise<number[]> {
    return this.deps.tokenizer().count(texts);
  }

  async calibrate(samples: readonly CalibrationSample[]): Promise<TokenCalibration> {
    const groups = new Map<string, string[]>();
    for (const sample of samples) {
      if (sample.text.length === 0) continue;
      const key = sample.kind ?? FALLBACK_RATIO_KEY;
      const group = groups.get(key) ?? [];
      const used = group.reduce((sum, text) => sum + text.length, 0);
      if (group.length >= MAX_FILES_PER_KIND || used >= MAX_CHARS_PER_KIND) continue;
      group.push(sample.text);
      groups.set(key, group);
    }

    const tokenizer = this.deps.tokenizer();
    const ratios: Record<string, number> = {};
    let totalChars = 0;
    let totalTokens = 0;
    let sampleFiles = 0;
    for (const [kind, texts] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const counts = await tokenizer.count(texts);
      const chars = texts.reduce((sum, text) => sum + text.length, 0);
      const tokens = counts.reduce((sum, count) => sum + count, 0);
      totalChars += chars;
      totalTokens += tokens;
      sampleFiles += texts.length;
      if (texts.length < MIN_FILES_PER_KIND || chars < MIN_CHARS_PER_KIND || tokens === 0) continue;
      ratios[kind] = round(chars / tokens);
    }
    if (totalTokens > 0) ratios[FALLBACK_RATIO_KEY] = round(totalChars / totalTokens);

    const fingerprint = createHash("sha1")
      .update(`${tokenizer.name}:${JSON.stringify(Object.entries(ratios).sort())}`)
      .digest("hex")
      .slice(0, 8);
    const calibration: TokenCalibration = {
      reference: tokenizer.name,
      fingerprint,
      ratios,
      sampleFiles,
      measuredAt: new Date().toISOString(),
    };
    await this.deps.prisma.appSetting.upsert({
      where: { key: CALIBRATION_SETTING_KEY },
      create: {
        key: CALIBRATION_SETTING_KEY,
        value: calibration as unknown as Prisma.InputJsonValue,
      },
      update: { value: calibration as unknown as Prisma.InputJsonValue },
    });
    this.apply(calibration);
    this.deps.logger.info({ fingerprint, ratios, sampleFiles }, "Token estimator calibrated");
    return calibration;
  }

  private apply(calibration: TokenCalibration): void {
    this.current = calibration;
    this.deps.estimator.setRatios(calibration.ratios);
  }
}
