"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const STORAGE_EVENT = "onyx-advanced-options";

function readFlag(key: string | undefined): boolean | null {
  if (!key) return null;
  try {
    const value = window.localStorage.getItem(key);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeFlag(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    return;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
  };
}

export function AdvancedOptions({
  title,
  summary,
  storageKey,
  defaultOpen = false,
  variant = "card",
  children,
  testId,
}: {
  title: string;
  summary?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  variant?: "card" | "inline";
  children: ReactNode;
  testId?: string;
}) {
  const panelId = useId();
  const [choice, setChoice] = useState<boolean | null>(null);
  const stored = useSyncExternalStore(
    subscribe,
    () => readFlag(storageKey),
    () => null,
  );
  const open = choice ?? stored ?? defaultOpen;

  function toggle() {
    const next = !open;
    setChoice(next);
    if (storageKey) writeFlag(storageKey, next);
  }

  return (
    <div
      className={cn(
        variant === "card"
          ? "rounded-xl border border-border bg-card/80"
          : "rounded-lg border border-border bg-surface-1",
      )}
      data-testid={testId}
      data-open={open}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-xl text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          variant === "card" ? "px-5 py-3.5" : "px-3 py-2.5",
        )}
      >
        <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {summary ? (
            <span className="block truncate text-xs text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={cn("space-y-5 border-t border-border", variant === "card" ? "p-5" : "p-3")}
      >
        {open ? children : null}
      </div>
    </div>
  );
}
