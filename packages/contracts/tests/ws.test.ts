import { describe, expect, it } from "vitest";
import { ChannelSchema, ClientMessageSchema, channels, runIdFromChannel } from "../src";

describe("channels", () => {
  it("accepts known channel shapes and rejects others", () => {
    expect(ChannelSchema.safeParse(channels.run("abc_1")).success).toBe(true);
    expect(ChannelSchema.safeParse("system").success).toBe(true);
    expect(ChannelSchema.safeParse("run:../etc").success).toBe(false);
    expect(ChannelSchema.safeParse("admin:1").success).toBe(false);
  });

  it("extracts run ids", () => {
    expect(runIdFromChannel("run:r1")).toBe("r1");
    expect(runIdFromChannel("task:t1")).toBeNull();
  });
});

describe("ClientMessageSchema", () => {
  it("parses subscribe with replay cursors", () => {
    const parsed = ClientMessageSchema.parse({
      v: 1,
      type: "subscribe",
      data: { channels: ["run:r1"], since: { "run:r1": 4 } },
    });
    expect(parsed.type).toBe("subscribe");
  });

  it("rejects unknown protocol versions", () => {
    expect(ClientMessageSchema.safeParse({ v: 2, type: "ping" }).success).toBe(false);
  });
});
