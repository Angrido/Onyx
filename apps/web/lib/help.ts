import type { GlossaryEntry } from "@/lib/glossary";
import type { Translate } from "@/lib/i18n/core";

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function glossaryMatches(entry: GlossaryEntry, query: string, t: Translate): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearch(
    [entry.id, entry.term, t(entry.term), entry.definition, t(entry.definition)].join(" "),
  );
  return words.every((word) => haystack.includes(word));
}

export function filterGlossary<T extends GlossaryEntry>(
  entries: readonly T[],
  query: string,
  t: Translate,
): T[] {
  const words = normalizeSearch(query);
  const matching = entries.filter((entry) => glossaryMatches(entry, query, t));
  if (words.length === 0) return matching;
  const inTerm = (entry: T) =>
    normalizeSearch(`${entry.term} ${t(entry.term)}`).includes(words) ? 0 : 1;
  return [...matching].sort((a, b) => inTerm(a) - inTerm(b));
}

export function sortGlossary<T extends GlossaryEntry>(entries: readonly T[], t: Translate): T[] {
  return [...entries].sort((a, b) =>
    normalizeSearch(t(a.term)).localeCompare(normalizeSearch(t(b.term))),
  );
}
