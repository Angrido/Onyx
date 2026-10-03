import type { ServerMessage } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { compactFocus, inputLeavesDraft } from "../../src/application/terminal-service";
import {
  buildRunSettings,
  statusLineSetting,
  terminalHooks,
} from "../../src/domain/permission-rules";
import { WsHub, ptyOutputMessage, type WsConnection } from "../../src/infrastructure/ws-hub";

class FakeConnection implements WsConnection {
  readonly messages: ServerMessage[] = [];
  bufferedAmount = 0;

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  close(): void {}
}

describe("terminal input tracking", () => {
  it("treats typed text without Enter as a draft", () => {
    expect(inputLeavesDraft(false, "hel")).toBe(true);
    expect(inputLeavesDraft(true, "lo\r")).toBe(false);
    expect(inputLeavesDraft(false, "one\rtwo")).toBe(true);
  });

  it("ignores escape sequences and clears the draft on Ctrl+C", () => {
    expect(inputLeavesDraft(false, "\x1b[A\x1b[B")).toBe(false);
    expect(inputLeavesDraft(true, "\x03")).toBe(false);
    expect(inputLeavesDraft(true, "\x1b[D")).toBe(true);
  });

  it("names the workspace in the compact focus", () => {
    expect(compactFocus("Frontend")).toContain("Frontend workspace");
  });
});

describe("terminal settings", () => {
  it("adds SessionStart, UserPromptSubmit and a quoted status line", () => {
    const settings = buildRunSettings({
      hooks: terminalHooks("http://127.0.0.1:4000"),
      statusLine: statusLineSetting("/usr/bin/node", "/opt/o'nyx/statusline.js"),
    });
    expect(settings.hooks?.SessionStart?.[0]).toMatchObject({
      matcher: "startup|resume|clear|compact",
      hooks: [{ type: "http", url: "http://127.0.0.1:4000/internal/hooks/session-start" }],
    });
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks[0]?.url).toBe(
      "http://127.0.0.1:4000/internal/hooks/user-prompt-submit",
    );
    expect(settings.statusLine).toEqual({
      type: "command",
      command: `'/usr/bin/node' '/opt/o'\\''nyx/statusline.js'`,
      padding: 0,
    });
  });
});

describe("pty channels", () => {
  it("sends the snapshot on subscribe and live output afterwards", async () => {
    const hub = new WsHub(async () => []);
    hub.registerSnapshot("pty:", (channel) =>
      channel === "pty:t1" ? [ptyOutputMessage("t1", "earlier")] : [],
    );
    const connection = new FakeConnection();
    const subscriber = hub.connect(connection);
    expect(hub.hasListeners("pty:t1")).toBe(false);
    await hub.subscribe(subscriber, ["pty:t1"]);
    hub.publishPtyOutput("t1", "later");
    hub.publishPtyOutput("t2", "elsewhere");
    expect(
      connection.messages.map((message) =>
        message.type === "pty.output" ? message.data.data : message.type,
      ),
    ).toEqual(["subscribed", "earlier", "later"]);
    expect(hub.hasListeners("pty:t1")).toBe(true);
  });
});
