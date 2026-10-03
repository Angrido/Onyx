export interface TokenEstimator {
  estimate(text: string, kind?: string | null): number;
}

export const CHARS_PER_TOKEN: Readonly<Record<string, number>> = {
  typescript: 3.3,
  tsx: 3.2,
  javascript: 3.4,
  python: 3.6,
  json: 2.9,
  yaml: 3.2,
  markdown: 4.2,
  text: 4.2,
  css: 3.0,
  html: 3.0,
  sql: 3.5,
  prisma: 3.4,
  lockfile: 2.15,
};

const DEFAULT_CHARS_PER_TOKEN = 3.4;

export class HeuristicTokenEstimator implements TokenEstimator {
  constructor(
    private readonly ratios: Readonly<Record<string, number>> = CHARS_PER_TOKEN,
    private readonly fallbackRatio = DEFAULT_CHARS_PER_TOKEN,
  ) {}

  estimate(text: string, kind: string | null = null): number {
    if (text.length === 0) return 0;
    const ratio = (kind === null ? undefined : this.ratios[kind]) ?? this.fallbackRatio;
    return Math.ceil(text.length / ratio);
  }
}

export const defaultEstimator: TokenEstimator = new HeuristicTokenEstimator();

export const FALLBACK_RATIO_KEY = "*";

export class AdjustableTokenEstimator implements TokenEstimator {
  private ratios: Readonly<Record<string, number>> = CHARS_PER_TOKEN;
  private fallbackRatio = DEFAULT_CHARS_PER_TOKEN;

  setRatios(overrides: Readonly<Record<string, number>>): void {
    const ratios: Record<string, number> = { ...CHARS_PER_TOKEN };
    let fallback = DEFAULT_CHARS_PER_TOKEN;
    for (const [kind, ratio] of Object.entries(overrides)) {
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      if (kind === FALLBACK_RATIO_KEY) fallback = ratio;
      else ratios[kind] = ratio;
    }
    this.ratios = ratios;
    this.fallbackRatio = fallback;
  }

  estimate(text: string, kind: string | null = null): number {
    if (text.length === 0) return 0;
    const ratio = (kind === null ? undefined : this.ratios[kind]) ?? this.fallbackRatio;
    return Math.ceil(text.length / ratio);
  }
}
