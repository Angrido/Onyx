"use client";

import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { glossaryEntry, type GlossaryId } from "@/lib/glossary";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 288;
const MARGIN = 12;

export function HelpTip({ term, className }: { term: GlossaryId; className?: string }) {
  const t = useT();
  const entry = glossaryEntry(term);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - MARGIN * 2);
      const left = Math.min(
        Math.max(MARGIN, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - MARGIN,
      );
      setStyle({ width, left: left - rect.left });
    };
    place();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return (
    <span ref={root} className={cn("relative inline-flex align-middle", className)}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("What does {term} mean?", { term: t(entry.term) })}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <span
          id={id}
          role="note"
          style={style}
          className="absolute top-full z-50 mt-1 block rounded-lg border border-border-strong bg-surface-2 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-foreground shadow-xl"
        >
          <span className="mb-1 block font-medium">{t(entry.term)}</span>
          <span className="block text-muted-foreground">{t(entry.definition)}</span>
          <Link
            href={`/help#${entry.id}`}
            className="mt-2 inline-block text-primary underline-offset-2 hover:underline"
          >
            {t("Open the guide")}
          </Link>
        </span>
      ) : null}
    </span>
  );
}
