import type { MemoryFactDto, MemoryFactKind } from "@onyx/contracts";
import { english, msg, type Translate } from "@/lib/i18n/core";

export const FACT_KIND_LABELS: Record<MemoryFactKind, string> = {
  TEST: msg("Tests"),
  COMMAND: msg("Command"),
  FILE: msg("Key file"),
  PITFALL: msg("Pitfall"),
  NOTE: msg("Note"),
};

export const FACT_KIND_TONES: Record<
  MemoryFactKind,
  "success" | "primary" | "neutral" | "warning"
> = {
  TEST: "success",
  COMMAND: "primary",
  FILE: "neutral",
  PITFALL: "warning",
  NOTE: "primary",
};

export interface FactGroups {
  active: MemoryFactDto[];
  suggested: MemoryFactDto[];
  dismissed: MemoryFactDto[];
}

export function groupFacts(facts: readonly MemoryFactDto[]): FactGroups {
  const groups: FactGroups = { active: [], suggested: [], dismissed: [] };
  for (const fact of facts) {
    if (fact.status === "ACTIVE") groups.active.push(fact);
    else if (fact.status === "SUGGESTED") groups.suggested.push(fact);
    else if (fact.status === "DISMISSED") groups.dismissed.push(fact);
  }
  groups.active.sort(
    (left, right) =>
      Number(right.included) - Number(left.included) ||
      Number(right.pinned) - Number(left.pinned) ||
      right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
  return groups;
}

export function factSource(
  fact: Pick<MemoryFactDto, "kind" | "evidence" | "sourceTaskTitle" | "lastSeenAt">,
  t: Translate = english,
): string {
  const date = fact.lastSeenAt.slice(0, 10);
  if (fact.kind === "NOTE") return t("added by you · {date}", { date });
  const runs = fact.evidence === 1 ? t("1 run") : t("{count} runs", { count: fact.evidence });
  return fact.sourceTaskTitle
    ? t("{runs} · last in “{title}” · {date}", { runs, title: fact.sourceTaskTitle, date })
    : t("{runs} · {date}", { runs, date });
}

export function budgetShare(tokens: number, budget: number): number {
  return budget > 0 ? Math.min(1, tokens / budget) : 0;
}
