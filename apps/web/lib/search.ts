import { SEARCH_MARK_END, SEARCH_MARK_START } from "@onyx/contracts/client";
import type { SearchResult } from "@onyx/contracts";
import { english, msg, type Translate } from "@/lib/i18n/core";

export const SEARCH_PREFIX = "search ";
export const searchMinLength = 2;

const KIND_LABELS = { TASK: msg("task"), RUN: msg("run"), FILE: msg("file") } as const;

export function searchHint(
  result: Pick<SearchResult, "kind" | "projectName" | "status">,
  t: Translate = english,
): string {
  const status = result.status ? ` · ${result.status.toLowerCase().replaceAll("_", " ")}` : "";
  return `${t(KIND_LABELS[result.kind])} · ${result.projectName}${status}`;
}

export function snippetParts(text: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  for (const [index, chunk] of text.split(SEARCH_MARK_START).entries()) {
    if (index === 0) {
      if (chunk) parts.push({ text: chunk, mark: false });
      continue;
    }
    const end = chunk.indexOf(SEARCH_MARK_END);
    if (end === -1) {
      if (chunk) parts.push({ text: chunk, mark: false });
      continue;
    }
    if (end > 0) parts.push({ text: chunk.slice(0, end), mark: true });
    const rest = chunk.slice(end + SEARCH_MARK_END.length);
    if (rest) parts.push({ text: rest, mark: false });
  }
  return parts;
}
