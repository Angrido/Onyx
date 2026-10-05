"use client";

import { CircleCheck, CircleDot, CircleX, Info, Loader2, TriangleAlert } from "lucide-react";
import { Children, type ReactNode } from "react";
import { explainError } from "@/lib/errors";
import { useT } from "@/lib/i18n/client";
import { renderGuide, type Banner, type BannerTone } from "@/lib/task-guide";
import { cn } from "@/lib/utils";

const TONE_STYLES: Record<BannerTone, { box: string; icon: string }> = {
  neutral: { box: "border-border-strong bg-surface-1", icon: "text-muted-foreground" },
  info: { box: "border-primary/40 bg-primary/8", icon: "text-primary" },
  success: { box: "border-success/40 bg-success/8", icon: "text-success" },
  warning: { box: "border-warning/40 bg-warning/8", icon: "text-warning" },
  danger: { box: "border-destructive/40 bg-destructive/8", icon: "text-destructive" },
};

const TONE_ICONS = {
  neutral: CircleDot,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
} as const;

export function StatusBanner({
  banner,
  children,
  extra,
  testId,
}: {
  banner: Banner<string>;
  children?: ReactNode;
  extra?: ReactNode;
  testId?: string;
}) {
  const t = useT();
  const style = TONE_STYLES[banner.tone];
  const Icon = banner.busy ? Loader2 : TONE_ICONS[banner.tone];
  const explained = banner.error ? explainError(banner.error, null, t) : null;
  return (
    <section
      aria-label={t("Status")}
      className={cn("flex gap-3 rounded-xl border p-4 sm:p-5", style.box)}
      data-testid={testId}
      data-tone={banner.tone}
    >
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", style.icon, banner.busy && "animate-spin")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold" aria-live="polite">
          {renderGuide(banner.title, t)}
        </p>
        {banner.detail ? (
          <p className="text-sm text-muted-foreground">{renderGuide(banner.detail, t)}</p>
        ) : null}
        {explained ? (
          <div className="space-y-1 text-sm" data-testid="status-error">
            <p className="break-words text-foreground">{explained.message}</p>
            {explained.fix ? (
              <p className="text-muted-foreground">
                {t("How to fix it: {fix}", { fix: explained.fix })}
              </p>
            ) : null}
          </div>
        ) : null}
        {banner.hint ? (
          <p className="break-words text-xs text-muted-foreground">{renderGuide(banner.hint, t)}</p>
        ) : null}
        {extra}
        {Children.toArray(children).length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-1.5">{children}</div>
        ) : null}
      </div>
    </section>
  );
}
