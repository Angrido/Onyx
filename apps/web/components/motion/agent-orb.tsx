"use client";

import type { ModelTier, RunStatus } from "@onyx/contracts";
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import { toolFamily, type ToolFamily } from "@/lib/run-feed";
import { TIER_STYLES } from "@/lib/tiers";
import { cn } from "@/lib/utils";

interface Signature {
  core: TargetAndTransition;
  halo: TargetAndTransition;
  transition: Transition;
  tint: string | null;
  muted: boolean;
}

const LOOP: Transition = { duration: 2.4, repeat: Infinity, ease: "easeInOut" };

const SIGNATURES: Record<RunStatus | "IDLE", Signature> = {
  IDLE: {
    core: { scale: 1, opacity: 0.55 },
    halo: { scale: 1, opacity: 0 },
    transition: { duration: 0.4 },
    tint: null,
    muted: false,
  },
  SPAWNING: {
    core: { scale: [0.6, 1.05, 0.95], opacity: [0.4, 1, 0.9] },
    halo: { scale: [1.6, 1], opacity: [0, 0.6] },
    transition: { duration: 0.9, repeat: Infinity, repeatType: "mirror", ease: "easeOut" },
    tint: null,
    muted: false,
  },
  RUNNING: {
    core: { scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] },
    halo: { scale: [1, 1.7, 1], opacity: [0.45, 0, 0.45] },
    transition: LOOP,
    tint: null,
    muted: false,
  },
  COMPLETED: {
    core: { scale: [1.3, 1], opacity: 1 },
    halo: { scale: [1, 2.4], opacity: [0.7, 0] },
    transition: { duration: 0.8, ease: "easeOut" },
    tint: "var(--success)",
    muted: false,
  },
  FAILED: {
    core: { x: [0, -3, 3, -2, 2, 0], opacity: 1 },
    halo: { scale: 1, opacity: 0.25 },
    transition: { duration: 0.45 },
    tint: "var(--destructive)",
    muted: true,
  },
  TIMEOUT: {
    core: { x: [0, -3, 3, -2, 2, 0], opacity: 1 },
    halo: { scale: 1, opacity: 0.25 },
    transition: { duration: 0.45 },
    tint: "var(--warning)",
    muted: true,
  },
  ABORTED: {
    core: { scale: 0.85, opacity: 0.5 },
    halo: { scale: 1, opacity: 0 },
    transition: { duration: 0.4 },
    tint: "var(--muted-foreground)",
    muted: true,
  },
  INTERRUPTED: {
    core: { scale: 0.85, opacity: 0.5 },
    halo: { scale: 1, opacity: 0 },
    transition: { duration: 0.4 },
    tint: "var(--warning)",
    muted: true,
  },
};

const SATELLITE_COLORS: Record<ToolFamily, string> = {
  read: "var(--tier-scout)",
  edit: "var(--tier-builder)",
  shell: "var(--warning)",
  context: "var(--primary)",
  delegate: "var(--tier-architect)",
  web: "var(--tier-apex)",
  other: "var(--muted-foreground)",
};

export function AgentOrb({
  tier,
  status,
  tool = null,
  size = 40,
  className,
}: {
  tier: ModelTier;
  status: RunStatus | null;
  tool?: string | null;
  size?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const signature = SIGNATURES[status ?? "IDLE"];
  const color = signature.tint ?? TIER_STYLES[tier].color;
  const family = tool ? toolFamily(tool) : null;
  const orbiting = family !== null && (status === "RUNNING" || status === "SPAWNING");
  const still = (target: TargetAndTransition): TargetAndTransition => {
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target))
      flat[key] = Array.isArray(value) ? value[value.length - 1] : value;
    return flat as TargetAndTransition;
  };
  const transition = reduced ? { duration: 0 } : signature.transition;
  const label = [status ?? "idle", tool ? `using ${tool}` : null].filter(Boolean).join(", ");
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center transition-[filter] duration-500",
        signature.muted && "saturate-[0.35]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={label}
      role="img"
      data-status={status ?? "IDLE"}
      data-tool-family={orbiting ? family : undefined}
    >
      <motion.span
        key={`halo-${status}`}
        className="absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)` }}
        animate={reduced ? still(signature.halo) : signature.halo}
        transition={transition}
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
        animate={reduced ? still(signature.core) : signature.core}
        transition={transition}
      />
      {orbiting ? (
        <motion.span
          key={`orbit-${family}`}
          className="absolute inset-0"
          initial={{ rotate: 0, opacity: 0 }}
          animate={reduced ? { rotate: 0, opacity: 1 } : { rotate: 360, opacity: 1 }}
          transition={
            reduced
              ? { duration: 0 }
              : {
                  rotate: { duration: 1.6, repeat: Infinity, ease: "linear" },
                  opacity: { duration: 0.2 },
                }
          }
        >
          <span
            className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full"
            style={{
              width: Math.max(4, size * 0.14),
              height: Math.max(4, size * 0.14),
              background: SATELLITE_COLORS[family],
              boxShadow: `0 0 ${size * 0.2}px ${SATELLITE_COLORS[family]}`,
            }}
          />
        </motion.span>
      ) : null}
    </div>
  );
}
