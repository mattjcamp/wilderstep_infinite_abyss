import { describe, expect, it } from "vitest";
import {
  DEFAULT_LORE_XP,
  filterLore,
  journalEntries,
  loreTags,
  markLoreRead,
  normalizeLore,
} from "./lore";

describe("normalizeLore", () => {
  it("parses the envelope, defaults xp to 25, and cleans fields", () => {
    const out = normalizeLore({
      lore: [
        {
          id: " founding ",
          name: "The Founding",
          tags: ["History", " History", "", 4],
          paragraphs: ["First.", "  ", "Second."],
        },
        { id: "no_name", xp: 0, text: "One.\n\nTwo.\n  \nThree." },
        { name: "missing id" },
        { id: "bad_xp", xp: "lots" },
        { id: "neg", xp: -5 },
      ],
    });
    expect(out.map((l) => l.id)).toEqual(["founding", "no_name", "bad_xp", "neg"]);
    expect(out[0]).toEqual({
      id: "founding",
      name: "The Founding",
      tags: ["History"],
      xp: DEFAULT_LORE_XP,
      paragraphs: ["First.", "Second."],
    });
    expect(out[1].name).toBe("no_name");
    expect(out[1].xp).toBe(0);
    expect(out[1].paragraphs).toEqual(["One.", "Two.", "Three."]);
    expect(out[2].xp).toBe(DEFAULT_LORE_XP);
    expect(out[3].xp).toBe(0);
    expect(DEFAULT_LORE_XP).toBe(25);
  });

  it("accepts a bare array and ignores junk", () => {
    expect(normalizeLore([{ id: "a" }]).length).toBe(1);
    expect(normalizeLore(null)).toEqual([]);
    expect(normalizeLore({ lore: "nope" })).toEqual([]);
  });
});

describe("markLoreRead", () => {
  it("is a first read once, then not", () => {
    const a = markLoreRead(undefined, "x");
    expect(a).toEqual({ firstTime: true, next: ["x"] });
    const b = markLoreRead(a.next, "x");
    expect(b.firstTime).toBe(false);
    expect(b.next).toEqual(["x"]);
  });
});

describe("journal", () => {
  const catalog = normalizeLore([
    { id: "a", name: "Alpha", tags: ["History"], paragraphs: ["The old kings."] },
    { id: "b", name: "Beta", tags: ["legends", "Orcs"], paragraphs: ["A dragon slept."] },
    { id: "c", name: "Gamma", tags: ["history"], paragraphs: ["Ruins."] },
  ]);

  it("lists read lore newest first and skips removed records", () => {
    expect(journalEntries(catalog, ["a", "gone", "b"]).map((l) => l.id)).toEqual([
      "b",
      "a",
    ]);
    expect(journalEntries(catalog, undefined)).toEqual([]);
  });

  it("collects tags case-insensitively, sorted", () => {
    expect(loreTags(catalog)).toEqual(["History", "legends", "Orcs"]);
  });

  it("filters by tag (case-insensitive) and search text", () => {
    expect(filterLore(catalog, "HISTORY").map((l) => l.id)).toEqual(["a", "c"]);
    expect(filterLore(catalog, null, "dragon").map((l) => l.id)).toEqual(["b"]);
    expect(filterLore(catalog, "History", "ruins").map((l) => l.id)).toEqual(["c"]);
    expect(filterLore(catalog, null).length).toBe(3);
  });
});
