import { describe, expect, it } from "vitest";
import { EVENT_LABELS, EVENT_ORDER, applicationServerKey, pushSupport } from "../lib/notifications";

describe("notification helpers", () => {
  it("explains why push is not available", () => {
    const base = { isSecureContext: true, hasServiceWorker: true, hasPushManager: true };
    expect(pushSupport({ ...base, permission: "default" })).toEqual({ ok: true });
    expect(pushSupport({ ...base, isSecureContext: false, permission: null })).toEqual({
      ok: false,
      reason: "insecure",
    });
    expect(pushSupport({ ...base, hasPushManager: false, permission: null })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(pushSupport({ ...base, permission: "denied" })).toEqual({ ok: false, reason: "denied" });
  });

  it("decodes the server key", () => {
    expect([...applicationServerKey("AQID_w")]).toEqual([1, 2, 3, 255]);
  });

  it("labels every event once", () => {
    expect([...EVENT_ORDER].sort()).toEqual(Object.keys(EVENT_LABELS).sort());
  });
});
