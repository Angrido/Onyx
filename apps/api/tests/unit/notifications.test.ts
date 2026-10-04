import { describe, expect, it } from "vitest";
import {
  approvalMessage,
  linkFor,
  ntfyRequest,
  pushPayload,
  quotaNotice,
  runMessage,
  telegramRequest,
} from "../../src/domain/notifications";

const RUN = {
  runId: "run1",
  taskTitle: "Fix login",
  projectName: "shop",
  costUsd: 0.4213,
  blockedCommands: 0,
};

describe("notification messages", () => {
  it("describes how a run ended", () => {
    expect(runMessage({ ...RUN, status: "COMPLETED" })).toMatchObject({
      event: "RUN_FINISHED",
      title: "Done · Fix login",
      body: "shop: Fix login · $0.42",
      path: "/runs/run1",
      urgent: false,
    });
    expect(runMessage({ ...RUN, status: "TIMEOUT", costUsd: null })).toMatchObject({
      event: "RUN_FAILED",
      title: "Run timeout · Fix login",
      body: "shop: Fix login",
      urgent: true,
    });
    expect(runMessage({ ...RUN, status: "FAILED", blockedCommands: 2 })).toMatchObject({
      event: "RUN_BLOCKED",
      title: "Waiting for you · Fix login",
    });
    expect(runMessage({ ...RUN, status: "ABORTED" })).toBeNull();
    expect(
      runMessage({ ...RUN, status: "COMPLETED", taskTitle: "x".repeat(300) })?.title,
    ).toHaveLength(120);
  });

  it("tells budget approvals from the others", () => {
    expect(
      approvalMessage({ id: "a1", kind: "BUDGET", title: "Daily limit", projectName: null }),
    ).toMatchObject({ event: "BUDGET", title: "Budget reached", body: "Daily limit" });
    expect(
      approvalMessage({ id: "a2", kind: "PLAN", title: "Plan ready", projectName: "shop" }),
    ).toMatchObject({ event: "APPROVAL", body: "shop: Plan ready", path: "/approvals" });
  });

  it("speaks up when the quota gets worse and when it resets", () => {
    expect(quotaNotice("OK", "WARNING", "80% used")?.title).toBe("Claude limits: getting close");
    expect(quotaNotice("WARNING", "LIMITED", "Limit")?.urgent).toBe(true);
    expect(quotaNotice("LIMITED", "WARNING", "x")).toBeNull();
    expect(quotaNotice("WARNING", "OK", "x")).toBeNull();
    expect(quotaNotice("HOLDING", "OK", "Back to normal")?.title).toBe("Claude limits reset");
    expect(quotaNotice("UNKNOWN", "OK", "x")).toBeNull();
  });
});

describe("channel formats", () => {
  const message = runMessage({ ...RUN, status: "FAILED", taskTitle: "Caffè <b>" });
  if (!message) throw new Error("message expected");

  it("builds an ntfy request with a link and an encoded title", () => {
    const request = ntfyRequest(
      { server: "https://ntfy.example.net", topic: "onyx", token: "tk_1" },
      message,
      "http://onyx.lan:3000",
    );
    expect(request.url).toBe("https://ntfy.example.net/onyx");
    expect(request.headers).toEqual({
      Title: `=?UTF-8?B?${Buffer.from("Run failed · Caffè <b>").toString("base64")}?=`,
      Priority: "high",
      Tags: "warning",
      Click: "http://onyx.lan:3000/runs/run1",
      Authorization: "Bearer tk_1",
    });
    expect(request.body).toBe("shop: Caffè <b> · $0.42");
    expect(
      ntfyRequest({ server: "http://n.lan/base/", topic: "t", token: null }, message, null),
    ).toMatchObject({ url: "http://n.lan/base/t", headers: { Priority: "high" } });
  });

  it("builds a Telegram message with escaped HTML", () => {
    const request = telegramRequest(
      { apiUrl: "https://api.telegram.org/", token: "1:abc", chatId: "42" },
      message,
      "http://onyx.lan:3000",
    );
    expect(request.url).toBe("https://api.telegram.org/bot1:abc/sendMessage");
    expect(request.body).toEqual({
      chat_id: "42",
      text: '<b>Run failed · Caffè &lt;b&gt;</b>\nshop: Caffè &lt;b&gt; · $0.42\n<a href="http://onyx.lan:3000/runs/run1">Open in Onyx</a>',
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
    });
  });

  it("keeps the push payload small and relative", () => {
    expect(JSON.parse(pushPayload(message))).toEqual({
      title: "Run failed · Caffè <b>",
      body: "shop: Caffè <b> · $0.42",
      url: "/runs/run1",
      tag: "run-run1",
    });
    expect(linkFor(null, "/x")).toBeNull();
    expect(linkFor("https://onyx.lan/", "/approvals")).toBe("https://onyx.lan/approvals");
  });
});
