import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/lib/glossary";
import { CREATE_LINKS, GLOSSARY_LINKS, PROJECT_PAGES, SETTINGS_LINKS } from "@/lib/palette";

const ROOT = join(import.meta.dirname, "..");

describe("palette actions", () => {
  it("link every settings entry to a card on the settings page", () => {
    const cards = readdirSync(join(ROOT, "components", "settings"))
      .map((name) => readFileSync(join(ROOT, "components", "settings", name), "utf8"))
      .join("\n");
    for (const link of SETTINGS_LINKS) {
      expect(link.href).toBe(`/settings#${link.id}`);
      expect(cards).toContain(`<Card id="${link.id}"`);
    }
  });

  it("open existing pages", () => {
    expect(CREATE_LINKS.map((link) => link.href)).toEqual([
      "/projects?new=local",
      "/projects?new=github",
    ]);
    const projectPages = readdirSync(join(ROOT, "app", "(console)", "projects", "[projectId]"));
    for (const page of PROJECT_PAGES) expect(projectPages).toContain(page.suffix.slice(1));
  });

  it("open every glossary term on its anchor in the guide", () => {
    expect(GLOSSARY_LINKS.map((link) => link.id)).toEqual(GLOSSARY.map((entry) => entry.id));
    for (const link of GLOSSARY_LINKS) expect(link.href).toBe(`/help#${link.id}`);
    const glossary = readFileSync(join(ROOT, "components", "help", "glossary-list.tsx"), "utf8");
    expect(glossary).toContain("id={entry.id}");
    expect(readdirSync(join(ROOT, "app", "(console)"))).toContain("help");
  });
});
