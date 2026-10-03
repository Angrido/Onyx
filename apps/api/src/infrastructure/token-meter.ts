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

export interface AnthropicTokenizerOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicTokenizer implements ReferenceTokenizer {
  readonly name = "anthropic" as const;
  private overhead: number | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AnthropicTokenizerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async count(texts: readonly string[]): Promise<number[]> {
    this.overhead ??= Math.max(0, (await this.raw(".")) - 1);
    const counts: number[] = [];
    for (const text of texts) {
      counts.push(text.length === 0 ? 0 : Math.max(0, (await this.raw(text)) - this.overhead));
    }
    return counts;
  }

  private async raw(text: string): Promise<number> {
    const response = await this.fetchImpl(
      `${this.options.baseUrl ?? "https://api.anthropic.com"}/v1/messages/count_tokens`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [{ role: "user", content: text }],
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(`count_tokens answered ${response.status}`);
    const payload = (await response.json()) as { input_tokens?: unknown };
    if (typeof payload.input_tokens !== "number")
      throw new Error("count_tokens returned no input_tokens");
    return payload.input_tokens;
  }
}
