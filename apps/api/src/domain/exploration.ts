import type { RunItemOf, TokenUsage } from "@onyx/contracts";

export const EXPLORER_AGENTS = {
  explorer: {
    description:
      "Fast read-only search on a cheaper model: finds the files, symbols and usages relevant to a question and reports paths with line numbers.",
    prompt:
      "You explore the repository without changing it. Answer with file paths, line numbers and short excerpts, ordered by relevance. Never edit files.",
    tools: ["Read", "Glob", "Grep"],
    model: "haiku",
  },
} as const;

export const EXPLORER_TOOLS = ["Task", "Agent"];

export const EXPLORER_HINT =
  "Delegate broad searches (where something is used, which files handle a feature) to the `explorer` subagent, which runs on a cheaper model, and read yourself only the files your answer depends on.";

export interface ModelUsageRow {
  modelId: string;
  usage: TokenUsage;
  costUsd: number | null;
}

export function usageByModel(
  result: RunItemOf<"result">,
  fallbackModelId: string,
): ModelUsageRow[] {
  const entries = Object.entries(result.modelUsage);
  if (entries.length === 0)
    return [{ modelId: fallbackModelId, usage: result.usage, costUsd: result.costUsd }];
  return entries.map(([modelId, usage]) => ({
    modelId,
    usage: usage.usage,
    costUsd: usage.costUsd,
  }));
}

export function costOfModel(rows: readonly ModelUsageRow[], modelId: string): number | null {
  const match = rows.find((row) => row.modelId === modelId || row.modelId.startsWith(modelId));
  if (match) return match.costUsd;
  return rows.length === 1 ? (rows[0]?.costUsd ?? null) : null;
}
