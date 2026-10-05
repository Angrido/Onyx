import { BookOpen } from "lucide-react";
import { glossaryEntry, type GlossaryId } from "@/lib/glossary";
import type { Translate } from "@/lib/i18n/core";

export function GlossaryChips({ terms, t }: { terms: readonly GlossaryId[]; t: Translate }) {
  if (terms.length === 0) return null;
  return (
    <ul aria-label={t("Related terms")} className="flex flex-wrap gap-1.5">
      {terms.map((id) => (
        <li key={id}>
          <a
            href={`#${id}`}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border-strong bg-surface-2 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-3" aria-hidden="true" />
            {t(glossaryEntry(id).term)}
          </a>
        </li>
      ))}
    </ul>
  );
}
