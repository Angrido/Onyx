import type { QuotaDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { isQuotaAlert, peakUtilization, quotaStatusLabel, quotaWindowLabel } from "@/lib/quota";
import { INITIAL_FEED, applyRunEvent } from "@/lib/run-feed";

function quota(windows: QuotaDto["windows"]): QuotaDto {
  return {
    level: "WARNING",
    windows,
    settings: { warnAt: 0.8, holdAt: 0.9, deferEnabled: true },
    deferredTasks: 0,
    nextResetAt: null,
    message: "",
  };
}

describe("subscription quota in the console", () => {
  it("names the windows and statuses Claude reports", () => {
    expect(quotaWindowLabel("five_hour")).toBe("5-hour window");
    expect(quotaWindowLabel("seven_day_opus")).toBe("Weekly Opus limit");
    expect(quotaWindowLabel("brand_new")).toBe("brand new");
    expect(quotaStatusLabel("rejected")).toBe("limit reached");
  });

  it("alerts only near or at the limit and ignores windows that already reset", () => {
    expect(isQuotaAlert("OK")).toBe(false);
    expect(isQuotaAlert("UNKNOWN")).toBe(false);
    expect(isQuotaAlert("HOLDING")).toBe(true);
    const window = {
      type: "five_hour",
      status: "allowed",
      resetsAt: null,
      observedAt: "2026-10-04T00:00:00Z",
    };
    expect(
      peakUtilization(
        quota([
          { ...window, utilization: 0.4, stale: false },
          { ...window, type: "seven_day", utilization: 0.97, stale: true },
        ]),
      ),
    ).toBe(0.4);
    expect(peakUtilization(quota([]))).toBeNull();
  });

  it("shows rate limit events in the run feed", () => {
    const state = applyRunEvent(INITIAL_FEED, 1, [
      {
        kind: "rate_limit",
        status: "allowed_warning",
        limitType: "five_hour",
        resetsAt: "2026-10-04T15:00:00.000Z",
        utilization: 0.82,
        overageStatus: null,
        usingOverage: false,
      },
    ]);
    expect(state.entries).toMatchObject([{ kind: "rate_limit", item: { utilization: 0.82 } }]);
  });
});
