"use client";

import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/form-controls";
import { GLOSSARY } from "@/lib/glossary";
import { filterGlossary, sortGlossary } from "@/lib/help";
import { useT } from "@/lib/i18n/client";

export function GlossaryList() {
  const t = useT();
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => sortGlossary(GLOSSARY, t), [t]);
  const visible = useMemo(() => filterGlossary(sorted, query, t), [sorted, query, t]);

  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!GLOSSARY.some((entry) => entry.id === id)) return;
      setQuery("");
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <section id="glossary" aria-labelledby="glossary-title" className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="glossary-title" className="text-lg font-semibold tracking-tight">
            {t("Glossary")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("The words Onyx uses, in plain terms.")}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("Filter the glossary")}
            placeholder={t("Filter the terms…")}
            className="h-11 pr-11 pl-9 sm:h-9"
            data-testid="glossary-filter"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("Clear the filter")}
              className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:size-9"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <p className="sr-only" role="status">
        {visible.length === 1 ? t("1 term") : t("{count} terms", { count: visible.length })}
      </p>
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("No term matches “{query}”.", { query: query.trim() })}
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((entry) => (
            <div
              key={entry.id}
              id={entry.id}
              className="scroll-mt-20 rounded-xl border border-border bg-card/80 p-4 transition-colors target:border-primary target:bg-primary/12 md:scroll-mt-8"
            >
              <dt className="text-sm font-semibold tracking-tight">
                <a href={`#${entry.id}`} className="hover:text-primary">
                  {t(entry.term)}
                </a>
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t(entry.definition)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
