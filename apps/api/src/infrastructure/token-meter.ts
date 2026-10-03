import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

export type ReferenceName = "o200k_base" | "anthropic";

export interface ReferenceTokenizer {
  readonly name: ReferenceName;
  count(texts: readonly string[]): Promise<number[]>;
}

export class O200kTokenizer implements ReferenceTokenizer {
  readonly name = "o200k_base" as const;

  count(texts: readonly string[]): Promise<number[]> {
    return Promise.resolve(texts.map((text) => (text.length === 0 ? 0 : countTokens(text))));
  }
}

export interface TokenCounter {
  countTokens(text: string): Promise<number>;
}

export class AnthropicTokenizer implements ReferenceTokenizer {
  readonly name = "anthropic" as const;
  private overhead: number | null = null;

  constructor(private readonly counter: TokenCounter) {}

  async count(texts: readonly string[]): Promise<number[]> {
    this.overhead ??= Math.max(0, (await this.counter.countTokens(".")) - 1);
    const counts: number[] = [];
    for (const text of texts) {
      counts.push(
        text.length === 0 ? 0 : Math.max(0, (await this.counter.countTokens(text)) - this.overhead),
      );
    }
    return counts;
  }
}
