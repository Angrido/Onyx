import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RoutingFeatures, TaskKind, TokenUsage } from "@onyx/contracts";
import { z } from "zod/v4";

export const AUX_MODEL_ID = "claude-haiku-4-5";

export interface AuxUsage {
  modelId: string;
  usage: TokenUsage;
}

export interface ClassificationInput {
  title: string;
  prompt: string;
  kind: TaskKind;
  features: RoutingFeatures;
}

export interface ClassifierVerdict {
  tier: "SCOUT" | "BUILDER" | "ARCHITECT";
  rationale: string;
  usage: AuxUsage;
}

export interface TaskClassifier {
  readonly modelId: string;
  classify(input: ClassificationInput): Promise<ClassifierVerdict>;
}

export interface HandoffSummaryInput {
  workspaceName: string;
  draft: string;
  budgetTokens: number;
}

export interface HandoffSummary {
  text: string;
  usage: AuxUsage;
}

export interface HandoffSummarizer {
  readonly modelId: string;
  summarize(input: HandoffSummaryInput): Promise<HandoffSummary>;
}

export interface AnthropicAuxOptions {
  apiKey: string;
  modelId?: string;
  client?: Anthropic;
  timeoutMs?: number;
}

const MAX_PROMPT_CHARS = 8_000;

const CLASSIFIER_SYSTEM = [
  "You route coding tasks for Claude Code agents to the cheapest model tier that will complete them reliably.",
  "SCOUT (Claude Haiku 4.5): documentation, chores and small read-mostly changes.",
  "BUILDER (Claude Sonnet 5.5): features, bug fixes and UI work confined to a few files.",
  "ARCHITECT (Claude Opus 5.5): architecture, schema or migration design, security, concurrency, cross-module refactors and changes with a large blast radius.",
  "Pick the tier and explain the choice in one sentence.",
].join("\n");

const SUMMARIZER_SYSTEM = [
  "You write handoff notes between Claude Code sessions working on the same repository.",
  "Rewrite the draft into concise Markdown for the next session: keep the headings, every changed file path, decisions, failures and open items; drop repetition.",
  "Never add facts that are not in the draft.",
].join("\n");

const VerdictSchema = z.object({
  tier: z.enum(["SCOUT", "BUILDER", "ARCHITECT"]),
  rationale: z.string(),
});

function toUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}

export class AnthropicAuxModel implements TaskClassifier, HandoffSummarizer {
  readonly modelId: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicAuxOptions) {
    this.modelId = options.modelId ?? AUX_MODEL_ID;
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? 30_000,
        maxRetries: 1,
      });
  }

  async classify(input: ClassificationInput): Promise<ClassifierVerdict> {
    const response = await this.client.messages.parse({
      model: this.modelId,
      max_tokens: 400,
      system: CLASSIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            title: input.title,
            kind: input.kind,
            prompt: input.prompt.slice(0, MAX_PROMPT_CHARS),
            signals: input.features,
          }),
        },
      ],
      output_config: { format: zodOutputFormat(VerdictSchema) },
    });
    if (response.stop_reason === "refusal") throw new Error("The classifier declined the task");
    const verdict = response.parsed_output;
    if (!verdict) throw new Error("The classifier returned no verdict");
    return {
      tier: verdict.tier,
      rationale: verdict.rationale.trim(),
      usage: { modelId: this.modelId, usage: toUsage(response.usage) },
    };
  }

  async summarize(input: HandoffSummaryInput): Promise<HandoffSummary> {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: input.budgetTokens + 200,
      system: SUMMARIZER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Workspace: ${input.workspaceName}\nStay under ${input.budgetTokens} tokens.\n\n${input.draft}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new Error("The summarizer declined the note");
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (text.length === 0) throw new Error("The summarizer returned an empty note");
    return { text, usage: { modelId: this.modelId, usage: toUsage(response.usage) } };
  }

  async countTokens(text: string): Promise<number> {
    const response = await this.client.messages.countTokens({
      model: this.modelId,
      messages: [{ role: "user", content: text }],
    });
    return response.input_tokens;
  }
}
