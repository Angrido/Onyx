"use client";

import type { ModelTier, RunStatus } from "@onyx/contracts";
import { motion, type TargetAndTransition, type Transition } from "motion/react";
import { TIER_STYLES } from "@/lib/tiers";
import { cn } from "@/lib/utils";

interface Signature {
  core: TargetAndTransition;
  halo: TargetAndTransition;
  transition: Transition;
  tint: string | null;
}

const LOOP: Transition = { duration: 2.4, repeat: Infinity, ease: "easeInOut" };

const SIGNATURES: Record<RunStatus | "IDLE", Signature> = {
  IDLE: {
    core: { scale: 1, opacity: 0.55 },
    halo: { scale: 1, opacity: 0 },
    transition: { duration: 0.4 },
    tint: null,
  },
  SPAWNING: {
    core: { scale: [0.6, 1.05, 0.95], opacity: [0.4, 1, 0.9] },
    halo: { scale: [1.6, 1], opacity: [0, 0.6] },
    transition: { duration: 0.9, repeat: Infinity, repeatType: "mirror", ease: "easeOut" },
    tint: null,
  },
  RUNNING: {
    core: { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] },
    halo: { scale: [1, 1.7, 1], opacity: [0.45, 0, 0.45] },
    transition: LOOP,
    tint: null,
  },
  COMPLETED: {
    core: { scale: [1.3, 1], opacity: 1 },
    halo: { scale: [1, 2.4], opacity: [0.7, 0] },
    transition: { duration: 0.8, ease: "easeOut" },
    tint: "var(--success)",
  },
  FAILED: {
    core: { x: [0, -3, 3, -2, 2, 0], opacity: 1 },
    halo: { scale: 1, opacity: 0.25 },
    transition: { duration: 0.45 },
    tint: "var(--destructive)",
  },
  TIMEOUT: {
    core: { x: [0, -3, 3, -2, 2, 0], opacity: 1 },
    halo: { scale: 1, opacity: 0.25 },
    transition: { duration: 0.45 },
    tint: "var(--warning)",
  },
  ABORTED: {
    core: { scale: 0.85, opacity: 0.5 },
    halo: { scale: 1, opacity: 0 },
    transition: { duration: 0.4 },
    tint: "var(--muted-foreground)",
  },
  INTERRUPTED: {
    core: { scale: 0.85, opacity: 0.5 },
    halo: { scale: 1, opacity: 0 },
    transition: { duration: 0.4 },
    tint: "var(--warning)",
  },
};

export function AgentOrb({
  tier,
  status,
  size = 40,
  className,
}: {
  tier: ModelTier;
  status: RunStatus | null;
  size?: number;
  className?: string;
}) {
  const signature = SIGNATURES[status ?? "IDLE"];
  const color = signature.tint ?? TIER_STYLES[tier].color;
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      aria-label={status ?? "idle"}
      role="img"
    >
      <motion.span
        key={`halo-${status}`}
        className="absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)` }}
        animate={signature.halo}
        transition={signature.transition}
      />
      <motion.span
        key={`core-${status}`}
        className="relative rounded-full"
        style={{
          width: size * 0.42,
          height: size * 0.42,
          background: `radial-gradient(circle at 35% 30%, oklch(1 0 0 / 0.9), ${color} 45%, color-mix(in oklch, ${color} 60%, black) 100%)`,
          boxShadow: `0 0 ${size * 0.4}px -${size * 0.08}px ${color}`,
        }}
        animate={signature.core}
        transition={signature.transition}
      />
    </div>
  );
}
