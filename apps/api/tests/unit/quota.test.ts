import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUOTA_SETTINGS,
  UNTIMED_WINDOW_MS,
  nextExpiry,
  nextReset,
  quotaAdmission,
  quotaLevel,
  quotaMessage,
  type QuotaWindow,
} from "../../src/domain/quota";

const NOW = new Date("2026-10-04T12:00:00.000Z");

function window(overrides: Partial<QuotaWindow>): QuotaWindow {
  return {
    type: "five_hour",
    status: "allowed",
    utilization: null,
    resetsAt: new Date(NOW.getTime() + 3_600_000),
    observedAt: NOW,
    ...overrides,
  };
}

describe("subscription quota levels", () => {
  it("is unknown before Claude reports anything and ok within the limits", () => {
    expect(quotaLevel([], DEFAULT_QUOTA_SETTINGS, NOW)).toBe("UNKNOWN");
    expect(quotaLevel([window({ utilization: 0.4 })], DEFAULT_QUOTA_SETTINGS, NOW)).toBe("OK");
  });

  it("warns, holds and limits by utilization and status, taking the worst window", () => {
    expect(quotaLevel([window({ utilization: 0.8 })], DEFAULT_QUOTA_SETTINGS, NOW)).toBe("WARNING");
    expect(
      quotaLevel(
        [window({ status: "allowed_warning", utilization: 0.5 })],
        DEFAULT_QUOTA_SETTINGS,
        NOW,
      ),
    ).toBe("WARNING");
    expect(quotaLevel([window({ status: "allowed_warning" })], DEFAULT_QUOTA_SETTINGS, NOW)).toBe(
      "HOLDING",
    );
    expect(
      quotaLevel(
        [window({ utilization: 0.2 }), window({ type: "seven_day", utilization: 0.95 })],
        DEFAULT_QUOTA_SETTINGS,
        NOW,
      ),
    ).toBe("HOLDING");
    expect(
      quotaLevel(
        [window({ status: "rejected" }), window({ type: "seven_day", utilization: 0.95 })],
        DEFAULT_QUOTA_SETTINGS,
        NOW,
      ),
    ).toBe("LIMITED");
  });

  it("forgets windows once they reset, and untimed ones after half an hour", () => {
    const reset = window({ status: "rejected", resetsAt: new Date(NOW.getTime() - 1) });
    expect(quotaLevel([reset], DEFAULT_QUOTA_SETTINGS, NOW)).toBe("OK");
    const untimed = window({ status: "rejected", resetsAt: null });
    expect(quotaLevel([untimed], DEFAULT_QUOTA_SETTINGS, NOW)).toBe("LIMITED");
    expect(
      quotaLevel([untimed], DEFAULT_QUOTA_SETTINGS, new Date(NOW.getTime() + UNTIMED_WINDOW_MS)),
    ).toBe("OK");
    expect(nextExpiry([untimed], NOW)).toEqual(new Date(NOW.getTime() + UNTIMED_WINDOW_MS));
  });

  it("resumes when every binding window has reset", () => {
    const early = new Date(NOW.getTime() + 60_000);
    const late = new Date(NOW.getTime() + 120_000);
    const windows = [
      window({ status: "rejected", resetsAt: early }),
      window({ type: "seven_day", status: "rejected", resetsAt: late }),
      window({ type: "seven_day_opus", utilization: 0.1, resetsAt: new Date(NOW.getTime() + 1) }),
    ];
    expect(nextReset(windows, DEFAULT_QUOTA_SETTINGS, NOW)).toEqual(late);
    expect(nextExpiry(windows, NOW)).toEqual(new Date(NOW.getTime() + 1));
  });
});

describe("admission under the quota", () => {
  it("holds every run at the limit and only the tasks that can wait near it", () => {
    const at = new Date(NOW.getTime() + 60_000);
    expect(quotaAdmission("LIMITED", false, DEFAULT_QUOTA_SETTINGS, at)).toMatchObject({
      decision: "hold",
    });
    expect(quotaAdmission("HOLDING", false, DEFAULT_QUOTA_SETTINGS, at)).toEqual({
      decision: "go",
    });
    expect(quotaAdmission("HOLDING", true, DEFAULT_QUOTA_SETTINGS, at)).toMatchObject({
      decision: "hold",
    });
    expect(
      quotaAdmission("HOLDING", true, { ...DEFAULT_QUOTA_SETTINGS, deferEnabled: false }, at),
    ).toEqual({ decision: "go" });
    expect(quotaAdmission("WARNING", true, DEFAULT_QUOTA_SETTINGS, at)).toEqual({
      decision: "go",
    });
  });

  it("explains the state in plain words", () => {
    const windows = [window({ utilization: 0.93 })];
    expect(quotaMessage("HOLDING", windows, DEFAULT_QUOTA_SETTINGS, NOW, 2)).toBe(
      "Almost at the 5-hour window (93% used): 2 tasks that can wait are held until it resets.",
    );
    expect(quotaMessage("HOLDING", windows, DEFAULT_QUOTA_SETTINGS, NOW, 0)).toBe(
      "Almost at the 5-hour window (93% used): tasks that can wait will be held until it resets.",
    );
  });
});
