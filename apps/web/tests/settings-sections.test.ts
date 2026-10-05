import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_LINKS } from "@/lib/palette";
import {
  activeSection,
  QUEUE_SEARCH_THRESHOLD,
  SETTINGS_CARDS,
  SETTINGS_SECTIONS,
  sectionForAnchor,
  visibleBackups,
  visibleQueueProjects,
} from "@/lib/settings-sections";

const ROOT = join(import.meta.dirname, "..");

function project(id: string, name: string, ownLimit: number | null = null) {
  return { projectId: id, projectName: name, ownLimit };
}

describe("settings sections", () => {
  it("places every card in exactly one section", () => {
    const placed = SETTINGS_SECTIONS.flatMap((section) => section.cards);
    expect([...placed].sort()).toEqual([...SETTINGS_CARDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("keeps section ids apart from the card anchors", () => {
    for (const section of SETTINGS_SECTIONS)
      expect(SETTINGS_CARDS as readonly string[]).not.toContain(section.id);
  });

  it("keeps a card for every anchor other pages link to", () => {
    const cards = readdirSync(join(ROOT, "components", "settings"))
      .map((name) => readFileSync(join(ROOT, "components", "settings", name), "utf8"))
      .join("\n");
    for (const id of SETTINGS_CARDS) expect(cards).toContain(`<Card id="${id}"`);
    for (const link of SETTINGS_LINKS)
      expect(SETTINGS_CARDS as readonly string[]).toContain(link.id);
  });

  it("finds the section of a card anchor or a section anchor", () => {
    expect(sectionForAnchor("#queue")?.id).toBe("section-spending");
    expect(sectionForAnchor("git-identity")?.id).toBe("section-account");
    expect(sectionForAnchor("#section-maintenance")?.id).toBe("section-maintenance");
    expect(sectionForAnchor("#nowhere")).toBeNull();
    expect(sectionForAnchor("")).toBeNull();
  });

  it("marks the last section that scrolled past the offset", () => {
    const tops = [
      { id: "a", top: -400 },
      { id: "b", top: 90 },
      { id: "c", top: 600 },
    ];
    expect(activeSection(tops, 100)).toBe("b");
    expect(activeSection(tops, 50)).toBe("a");
    expect(activeSection([{ id: "a", top: 300 }], 100)).toBe("a");
    expect(activeSection([], 100)).toBeNull();
  });
});

describe("queue projects", () => {
  const projects = [
    project("1", "Onyx", 2),
    project("2", "Città"),
    project("3", "Backend API"),
    project("4", "Frontend", 1),
  ];

  it("shows only the projects with their own limit when collapsed", () => {
    expect(
      visibleQueueProjects(projects, { showAll: false, query: "" }).map((p) => p.projectId),
    ).toEqual(["1", "4"]);
  });

  it("keeps a project just changed back to the default in view", () => {
    expect(
      visibleQueueProjects(projects, { showAll: false, query: "", keep: new Set(["2"]) }).map(
        (p) => p.projectId,
      ),
    ).toEqual(["1", "2", "4"]);
  });

  it("shows every project and filters by name ignoring case and accents", () => {
    expect(visibleQueueProjects(projects, { showAll: true, query: "" })).toHaveLength(4);
    expect(
      visibleQueueProjects(projects, { showAll: true, query: "  citta " }).map((p) => p.projectId),
    ).toEqual(["2"]);
    expect(
      visibleQueueProjects(projects, { showAll: true, query: "END" }).map((p) => p.projectId),
    ).toEqual(["3", "4"]);
    expect(visibleQueueProjects(projects, { showAll: true, query: "zzz" })).toEqual([]);
  });

  it("offers the search only for long lists", () => {
    expect(QUEUE_SEARCH_THRESHOLD).toBe(10);
  });
});

describe("backups", () => {
  const items = [
    { name: "b", createdAt: "2026-10-02T03:00:00.000Z" },
    { name: "d", createdAt: "2026-10-04T03:00:00.000Z" },
    { name: "a", createdAt: "2026-10-01T03:00:00.000Z" },
    { name: "c", createdAt: "2026-10-03T03:00:00.000Z" },
  ];

  it("shows the latest three, newest first", () => {
    const { shown, hidden } = visibleBackups(items, false);
    expect(shown.map((item) => item.name)).toEqual(["d", "c", "b"]);
    expect(hidden).toBe(1);
  });

  it("shows all of them on request or when there are few", () => {
    expect(visibleBackups(items, true)).toEqual({
      shown: [items[1], items[3], items[0], items[2]],
      hidden: 0,
    });
    expect(visibleBackups(items.slice(0, 2), false).hidden).toBe(0);
    expect(visibleBackups([], false)).toEqual({ shown: [], hidden: 0 });
  });
});
