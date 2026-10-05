import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/lib/glossary";
import { filterGlossary, glossaryMatches, normalizeSearch, sortGlossary } from "@/lib/help";
import { english, translator } from "@/lib/i18n/core";

const italian = translator("it");

describe("glossary search", () => {
  it("normalizes case, accents and spaces", () => {
    expect(normalizeSearch("  Perché   TOKEN ")).toBe("perche token");
  });

  it("shows every term with an empty query", () => {
    expect(filterGlossary(GLOSSARY, "  ", italian)).toHaveLength(GLOSSARY.length);
  });

  it("finds terms in Italian and in English, by name or definition", () => {
    const ids = (query: string) => filterGlossary(GLOSSARY, query, italian).map((e) => e.id);
    expect(ids("recinto")).toContain("fence");
    expect(ids("fence")).toContain("fence");
    expect(ids("guardia")).toContain("guard");
    expect(ids("worktree")[0]).toBe("worktree");
    expect(ids("cache")[0]).toBe("cache");
    expect(ids("nothing-like-this")).toEqual([]);
  });

  it("needs every word of the query", () => {
    const cache = GLOSSARY.find((entry) => entry.id === "cache");
    expect(cache).toBeDefined();
    if (!cache) return;
    expect(glossaryMatches(cache, "prezzo minuti", italian)).toBe(true);
    expect(glossaryMatches(cache, "prezzo branch", italian)).toBe(false);
    expect(glossaryMatches(cache, "price minutes", english)).toBe(true);
  });

  it("sorts by the translated term", () => {
    const terms = sortGlossary(GLOSSARY, italian).map((entry) =>
      normalizeSearch(italian(entry.term)),
    );
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
    expect(new Set(GLOSSARY.map((entry) => entry.id)).size).toBe(GLOSSARY.length);
  });
});
