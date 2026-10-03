import { describe, expect, it } from "vitest";
import { resolveWsUrl } from "@/lib/ws/client";

const lan = { protocol: "http:", hostname: "192.168.1.50", host: "192.168.1.50:3000" };

describe("resolveWsUrl", () => {
  it("uses the same origin behind a reverse proxy", () => {
    expect(resolveWsUrl({ protocol: "https:", hostname: "onyx.lan", host: "onyx.lan" }, {})).toBe(
      "wss://onyx.lan/ws",
    );
  });

  it("targets the API port on the host the browser used", () => {
    expect(resolveWsUrl(lan, { port: "4000" })).toBe("ws://192.168.1.50:4000/ws");
    expect(
      resolveWsUrl(
        { protocol: "http:", hostname: "onyx.local", host: "onyx.local:3000" },
        { port: "4000" },
      ),
    ).toBe("ws://onyx.local:4000/ws");
  });

  it("honours an explicit URL with a hostname placeholder", () => {
    expect(resolveWsUrl(lan, { url: "ws://{hostname}:9000/ws", port: "4000" })).toBe(
      "ws://192.168.1.50:9000/ws",
    );
  });
});
