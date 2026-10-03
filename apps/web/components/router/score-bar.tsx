"use client";

import type { ModelTier, RouterThresholds } from "@onyx/contracts";
import { motion } from "motion/react";
import { scorePosition } from "@/lib/router";
import { TIER_STYLES } from "@/lib/tiers";
import { cn } from "@/lib/utils";

export function ScoreBar({
  score,
  max,
  thresholds,
  tier,
  className,
}: {
  score: number | null;
  max: number;
  thresholds: RouterThresholds;
  tier: ModelTier;
  className?: string;
}) {
  const builder = scorePosition(thresholds.builder, max);
  const architect = scorePosition(thresholds.architect, max);
  const zones = [
    { tier: "SCOUT" as const, from: 0, to: builder },
    { tier: "BUILDER" as const, from: builder, to: architect },
    { tier: "ARCHITECT" as const, from: architect, to: 100 },
  ];
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
        {zones.map((zone) => (
          <span
            key={zone.tier}
            className="absolute inset-y-0"
            style={{
              left: `${zone.from}%`,
              width: `${Math.max(0, zone.to - zone.from)}%`,
              background: `color-mix(in oklch, ${TIER_STYLES[zone.tier].color} 28%, transparent)`,
            }}
          />
        ))}
        {score !== null ? (
          <motion.span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
            style={{ background: TIER_STYLES[tier].color }}
            initial={false}
            animate={{ left: `${scorePosition(score, max)}%` }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          />
        ) : null}
      </div>
      <div className="relative h-4 text-[10px] text-muted-foreground">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${builder}%` }}>
          {thresholds.builder.toFixed(2)}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${architect}%` }}>
          {thresholds.architect.toFixed(2)}
        </span>
        <span className="absolute right-0">{max.toFixed(2)}</span>
      </div>
    </div>
  );
}
