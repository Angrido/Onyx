import { createHash } from "node:crypto";
import type { TokenUsage } from "@onyx/contracts";

export type CacheLoss =
  "NEW_SESSION" | "NONE" | "PREFIX_CHANGED" | "MODEL_CHANGED" | "EXPIRED" | "UNKNOWN";

export const DEFAULT_PROMPT_CACHE_TTL_MS = 5 * 60_000;
const NEGLIGIBLE_LOSS_TOKENS = 1_000;
const NEGLIGIBLE_LOSS_SHARE = 0.1;

export interface PrefixParts {
  modelId: string;
  primer: string;
  agents: unknown;
  mcpEnabled: boolean;
}

export function prefixHash(parts: PrefixParts): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.modelId, parts.primer, parts.agents ?? null, parts.mcpEnabled]))
    .digest("hex")
    .slice(0, 32);
}

export interface PreviousRun {
  modelId: string;
  prefixHash: string | null;
  endedAt: Date;
}

export interface CacheLossInput {
  sessionIsNew: boolean;
  firstTurn: TokenUsage | null;
  messageTokens: number;
  modelId: string;
  prefixHash: string;
  startedAt: Date;
  previous: PreviousRun | null;
  ttlMs: number;
}

export interface CacheVerdict {
  reason: CacheLoss | null;
  readTokens: number | null;
  writeTokens: number | null;
  lostTokens: number | null;
}

export function classifyCacheLoss(input: CacheLossInput): CacheVerdict {
  const turn = input.firstTurn;
  if (turn === null) return { reason: null, readTokens: null, writeTokens: null, lostTokens: null };
  const readTokens = turn.cacheReadTokens;
  const writeTokens = turn.cacheCreationTokens;
  if (input.sessionIsNew)
    return { reason: "NEW_SESSION", readTokens, writeTokens, lostTokens: null };
  const lostTokens = Math.max(0, writeTokens + turn.inputTokens - input.messageTokens);
  const context = readTokens + writeTokens + turn.inputTokens;
  if (lostTokens <= Math.max(NEGLIGIBLE_LOSS_TOKENS, context * NEGLIGIBLE_LOSS_SHARE))
    return { reason: "NONE", readTokens, writeTokens, lostTokens: 0 };
  const previous = input.previous;
  const reason: CacheLoss =
    previous === null
      ? "UNKNOWN"
      : previous.modelId !== input.modelId
        ? "MODEL_CHANGED"
        : previous.prefixHash !== null && previous.prefixHash !== input.prefixHash
          ? "PREFIX_CHANGED"
          : input.startedAt.getTime() - previous.endedAt.getTime() > input.ttlMs
            ? "EXPIRED"
            : "UNKNOWN";
  return { reason, readTokens, writeTokens, lostTokens };
}

export interface CacheLossRow {
  reason: CacheLoss;
  runs: number;
  lostTokens: number;
}

export interface CacheReport {
  resumedRuns: number;
  runsWithLoss: number;
  lostTokens: number;
  readTokens: number;
  byReason: CacheLossRow[];
}

export interface CacheGroup {
  reason: CacheLoss;
  runs: number;
  lostTokens: number;
  readTokens: number;
}

export function summarizeCache(groups: readonly CacheGroup[]): CacheReport {
  const resumed = groups.filter((group) => group.reason !== "NEW_SESSION");
  const rows = resumed
    .filter((group) => group.reason !== "NONE" && group.runs > 0)
    .map((group) => ({ reason: group.reason, runs: group.runs, lostTokens: group.lostTokens }))
    .sort((a, b) => b.lostTokens - a.lostTokens);
  return {
    resumedRuns: resumed.reduce((sum, group) => sum + group.runs, 0),
    runsWithLoss: rows.reduce((sum, row) => sum + row.runs, 0),
    lostTokens: rows.reduce((sum, row) => sum + row.lostTokens, 0),
    readTokens: resumed.reduce((sum, group) => sum + group.readTokens, 0),
    byReason: rows,
  };
}
