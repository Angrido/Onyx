import { describe, expect, it } from "vitest";
import {
  createOriginPolicy,
  hostnameFromHostHeader,
  isNetworkLocalHostname,
} from "../../src/http/origin-policy";

const machines = ["onyx", "onyx.local"];
const policy = createOriginPolicy([], machines);

describe("hostnameFromHostHeader", () => {
  it.each([
    ["192.168.1.50:3000", "192.168.1.50"],
    ["onyx.local", "onyx.local"],
    ["[fd00::5]:4000", "fd00::5"],
    ["ONYX.LAN.", "onyx.lan"],
  ])("%s → %s", (header, expected) => {
    expect(hostnameFromHostHeader(header)).toBe(expected);
  });
});

describe("isNetworkLocalHostname", () => {
  const names = new Set(machines);
  it.each([
    "10.0.0.7",
    "192.168.1.50",
    "192.0.2.2",
    "fd00::5",
    "localhost",
    "onyx",
    "nas.lan",
    "onyx.local",
    "box.home.arpa",
  ])("accepts %s", (hostname) => {
    expect(isNetworkLocalHostname(hostname, names)).toBe(true);
  });

  it.each(["evil.example", "onyx.example.com", "attacker.io"])("rejects %s", (hostname) => {
    expect(isNetworkLocalHostname(hostname, names)).toBe(false);
  });
});

describe("createOriginPolicy", () => {
  it("accepts same-host requests from any LAN address, port included or not", () => {
    expect(policy.isAllowed("http://192.168.1.50", "192.168.1.50")).toBe(true);
    expect(policy.isAllowed("http://192.168.1.50:3000", "192.168.1.50:3000")).toBe(true);
    expect(policy.isAllowed("http://192.168.1.50:3000", "192.168.1.50:4000")).toBe(true);
    expect(policy.isAllowed("http://onyx.local", "onyx.local")).toBe(true);
    expect(policy.isAllowed("http://[fd00::5]:3000", "[fd00::5]:4000")).toBe(true);
  });

  it("rejects cross-site requests", () => {
    expect(policy.isAllowed("http://evil.example", "192.168.1.50:3000")).toBe(false);
    expect(policy.isAllowed("http://10.0.0.9:3000", "192.168.1.50:3000")).toBe(false);
  });

  it("rejects DNS rebinding through public domain names", () => {
    expect(policy.isAllowed("http://rebind.attacker.io", "rebind.attacker.io")).toBe(false);
  });

  it("accepts explicitly configured public origins", () => {
    const configured = createOriginPolicy(["https://onyx.example.com"], machines);
    expect(configured.isAllowed("https://onyx.example.com", "onyx.example.com")).toBe(true);
    expect(configured.isAllowed("https://onyx.example.com", "anything")).toBe(true);
  });

  it("rejects malformed and non-http origins", () => {
    expect(policy.isAllowed("null", "192.168.1.50")).toBe(false);
    expect(policy.isAllowed("file://192.168.1.50", "192.168.1.50")).toBe(false);
    expect(policy.isAllowed("http://192.168.1.50", undefined)).toBe(false);
  });
});
