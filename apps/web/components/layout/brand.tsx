import { cn } from "@/lib/utils";

export function OnyxMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <defs>
        <linearGradient id="onyx-facet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.85 0.1 293)" />
          <stop offset="1" stopColor="oklch(0.45 0.18 293)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 29 9.5v13L16 30 3 22.5v-13z"
        fill="oklch(0.18 0.01 286)"
        stroke="url(#onyx-facet)"
        strokeWidth="1.5"
      />
      <path
        d="M16 2v28M3 9.5l26 13M29 9.5l-26 13"
        stroke="url(#onyx-facet)"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      <circle cx="16" cy="16" r="3.2" fill="url(#onyx-facet)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <OnyxMark />
      <div className="leading-none">
        <p className="text-sm font-semibold tracking-[0.18em]">ONYX</p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Agent control
        </p>
      </div>
    </div>
  );
}
