import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 tracking-wide",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-2 text-muted-foreground",
        primary: "border-primary/40 bg-primary/12 text-primary",
        success: "border-success/40 bg-success/12 text-success",
        warning: "border-warning/40 bg-warning/12 text-warning",
        danger: "border-destructive/40 bg-destructive/12 text-destructive",
        architect: "border-architect/40 bg-architect/12 text-architect",
        builder: "border-builder/40 bg-builder/12 text-builder",
        scout: "border-scout/40 bg-scout/12 text-scout",
        apex: "border-apex/40 bg-apex/12 text-apex",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
