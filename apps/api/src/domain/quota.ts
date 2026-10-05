import type { QuotaLevel, QuotaSettings } from "@onyx/contracts";
import { msg, tx, type Params } from "../i18n";

export interface QuotaWindow {
  type: string;
  status: string;
  utilization: number | null;
  resetsAt: Date | null;
  observedAt: Date;
}

export type QuotaAdmission = { decision: "go" } | { decision: "hold"; reason: string };

export const DEFAULT_QUOTA_SETTINGS: QuotaSettings = {
  warnAt: 0.8,
  holdAt: 0.9,
  deferEnabled: true,
};

export const UNTIMED_WINDOW_MS = 30 * 60_000;

const WINDOW_NAMES: Readonly<Record<string, string>> = {
  five_hour: msg("5-hour window"),
  seven_day: msg("weekly limit"),
  seven_day_opus: msg("weekly Opus limit"),
  seven_day_sonnet: msg("weekly Sonnet limit"),
  overage: msg("extra usage"),
  subscription: msg("subscription limit"),
};

export function windowName(type: string): string {
  const name = WINDOW_NAMES[type];
  return name === undefined ? type.replaceAll("_", " ") : tx(name);
}

export function windowExpiry(window: QuotaWindow): Date {
  return window.resetsAt ?? new Date(window.observedAt.getTime() + UNTIMED_WINDOW_MS);
}

export function isStale(window: QuotaWindow, now: Date): boolean {
  return windowExpiry(window).getTime() <= now.getTime();
}

function rank(level: QuotaLevel): number {
  return ["UNKNOWN", "OK", "WARNING", "HOLDING", "LIMITED"].indexOf(level);
}

export function windowLevel(window: QuotaWindow, settings: QuotaSettings): QuotaLevel {
  if (window.status === "rejected") return "LIMITED";
  const utilization = window.utilization;
  if (utilization !== null && utilization >= settings.holdAt) return "HOLDING";
  if (window.status === "allowed_warning") return utilization === null ? "HOLDING" : "WARNING";
  if (utilization !== null && utilization >= settings.warnAt) return "WARNING";
  return "OK";
}

export function quotaLevel(
  windows: readonly QuotaWindow[],
  settings: QuotaSettings,
  now: Date,
): QuotaLevel {
  if (windows.length === 0) return "UNKNOWN";
  let level: QuotaLevel = "OK";
  for (const window of windows) {
    if (isStale(window, now)) continue;
    const current = windowLevel(window, settings);
    if (rank(current) > rank(level)) level = current;
  }
  return level;
}

export function bindingWindows(
  windows: readonly QuotaWindow[],
  settings: QuotaSettings,
  now: Date,
): QuotaWindow[] {
  const level = quotaLevel(windows, settings, now);
  return windows.filter(
    (window) => !isStale(window, now) && windowLevel(window, settings) === level,
  );
}

export function nextReset(
  windows: readonly QuotaWindow[],
  settings: QuotaSettings,
  now: Date,
): Date | null {
  const binding = bindingWindows(windows, settings, now);
  if (binding.length === 0) return null;
  return binding.map(windowExpiry).reduce((latest, expiry) => (expiry > latest ? expiry : latest));
}

export function nextExpiry(windows: readonly QuotaWindow[], now: Date): Date | null {
  const pending = windows.map(windowExpiry).filter((expiry) => expiry > now);
  if (pending.length === 0) return null;
  return pending.reduce((earliest, expiry) => (expiry < earliest ? expiry : earliest));
}

function untilText(at: Date | null): string {
  return at === null ? "until Claude reports the limit again" : `until ${at.toISOString()}`;
}

export function quotaAdmission(
  level: QuotaLevel,
  canWait: boolean,
  settings: QuotaSettings,
  resumeAt: Date | null,
): QuotaAdmission {
  if (level === "LIMITED")
    return {
      decision: "hold",
      reason: `The Claude subscription limit is reached; runs wait ${untilText(resumeAt)}`,
    };
  if (level === "HOLDING" && canWait && settings.deferEnabled)
    return {
      decision: "hold",
      reason: `The Claude subscription is almost used up; tasks that can wait start ${untilText(resumeAt)}`,
    };
  return { decision: "go" };
}

export function quotaMessage(
  level: QuotaLevel,
  windows: readonly QuotaWindow[],
  settings: QuotaSettings,
  now: Date,
  deferred: number,
): string {
  const binding = bindingWindows(windows, settings, now)[0];
  const name = binding ? windowName(binding.type) : "";
  const utilization = binding?.utilization ?? null;
  const say = (plain: string, measured: string, params: Params = {}) =>
    utilization === null
      ? tx(plain, { name, ...params })
      : tx(measured, { name, percent: Math.round(utilization * 100), ...params });
  switch (level) {
    case "UNKNOWN":
      return tx("No limit reported yet: Claude reports the subscription limits during runs.");
    case "OK":
      return tx("Within the subscription limits.");
    case "WARNING":
      return say(
        msg("Getting close to the {name}. Runs continue."),
        msg("Getting close to the {name} ({percent}% used). Runs continue."),
      );
    case "HOLDING":
      if (!settings.deferEnabled)
        return say(
          msg("Almost at the {name}. Holding tasks that can wait is off."),
          msg("Almost at the {name} ({percent}% used). Holding tasks that can wait is off."),
        );
      if (deferred === 0)
        return say(
          msg("Almost at the {name}: tasks that can wait will be held until it resets."),
          msg(
            "Almost at the {name} ({percent}% used): tasks that can wait will be held until it resets.",
          ),
        );
      if (deferred === 1)
        return say(
          msg("Almost at the {name}: {count} task that can wait is held until it resets."),
          msg(
            "Almost at the {name} ({percent}% used): {count} task that can wait is held until it resets.",
          ),
          { count: deferred },
        );
      return say(
        msg("Almost at the {name}: {count} tasks that can wait are held until it resets."),
        msg(
          "Almost at the {name} ({percent}% used): {count} tasks that can wait are held until it resets.",
        ),
        { count: deferred },
      );
    case "LIMITED":
      return say(
        msg("The {name} is reached: queued runs wait until it resets."),
        msg("The {name} ({percent}% used) is reached: queued runs wait until it resets."),
      );
  }
}
