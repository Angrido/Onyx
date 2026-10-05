"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { activeSection, SETTINGS_SECTIONS, sectionForAnchor } from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

const OFFSET = 140;

export function SettingsIndex() {
  const t = useT();
  const [current, setCurrent] = useState<string>(SETTINGS_SECTIONS[0]?.id ?? "");

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const tops = SETTINGS_SECTIONS.flatMap((section) => {
        const element = document.getElementById(section.id);
        return element ? [{ id: section.id, top: element.getBoundingClientRect().top }] : [];
      });
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const next = atBottom ? tops[tops.length - 1]?.id : activeSection(tops, OFFSET);
      if (next) setCurrent(next);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    const fromHash = () => {
      const section = sectionForAnchor(window.location.hash);
      if (section) setCurrent(section.id);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", fromHash);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", fromHash);
    };
  }, []);

  return (
    <nav
      aria-label={t("Settings sections")}
      className="min-w-0 lg:sticky lg:top-8 lg:self-start"
      data-testid="settings-index"
    >
      <ul className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {SETTINGS_SECTIONS.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={active ? "location" : undefined}
                onClick={() => setCurrent(section.id)}
                className={cn(
                  "flex min-h-9 items-center whitespace-nowrap rounded-full border px-3 text-sm transition-colors lg:rounded-md lg:border-transparent lg:px-3",
                  active
                    ? "border-primary/50 bg-primary/12 font-medium text-foreground lg:border-transparent"
                    : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {t(section.label)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
