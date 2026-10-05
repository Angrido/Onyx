import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVALS_HREF,
  HELP_HREF,
  MOBILE_TABS,
  NAV_ITEMS,
  NAV_SECTIONS,
  badgeText,
  inMore,
  isActive,
  mobileTabs,
  moreItems,
  navSections,
} from "@/lib/nav";

const CONSOLE = join(import.meta.dirname, "..", "app", "(console)");

describe("navigation model", () => {
  it("groups every page under work, analysis and system in order", () => {
    expect(NAV_SECTIONS.map((section) => section.id)).toEqual(["work", "analysis", "system"]);
    expect(
      navSections().map(({ section, items }) => [section.id, items.map((item) => item.href)]),
    ).toEqual([
      ["work", ["/", "/projects", "/agents", APPROVALS_HREF]],
      ["analysis", ["/savings", "/telemetry", "/router"]],
      ["system", ["/logs", "/settings", HELP_HREF]],
    ]);
  });

  it("links only to pages that exist", () => {
    for (const item of NAV_ITEMS) {
      const page = item.href === "/" ? "page.tsx" : join(item.href.slice(1), "page.tsx");
      expect(existsSync(join(CONSOLE, page)), item.href).toBe(true);
      expect(item.description.length).toBeGreaterThan(0);
    }
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(NAV_ITEMS.length);
  });

  it("splits the pages between the mobile tabs and the More sheet", () => {
    expect(mobileTabs().map((item) => item.href)).toEqual([...MOBILE_TABS]);
    expect(MOBILE_TABS).toContain(APPROVALS_HREF);
    const more = moreItems().map((item) => item.href);
    expect(more).toEqual(["/savings", "/telemetry", "/router", "/logs", "/settings", HELP_HREF]);
    expect(navSections(moreItems()).map(({ section }) => section.id)).toEqual([
      "analysis",
      "system",
    ]);
  });

  it("marks the active page, including nested routes", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/projects", "/")).toBe(false);
    expect(isActive("/projects/abc/graph", "/projects")).toBe(true);
    expect(isActive("/projectsx", "/projects")).toBe(false);
    expect(inMore("/settings")).toBe(true);
    expect(inMore("/help")).toBe(true);
    expect(inMore("/approvals")).toBe(false);
    expect(inMore("/")).toBe(false);
  });

  it("caps the badge at 99+", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(120)).toBe("99+");
  });
});
