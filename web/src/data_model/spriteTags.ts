/**
 * Tag categories derived from a sprite's file name.
 *
 * Person art follows `<race>_<gender>[_<role>[_<detail>…]]`
 * (elf_male_villager_wealthy, person_female_musician_lute) and animals
 * `animal_<kind>`. Each descriptor word lands in one category:
 *
 *   Race    human (file prefix "person"), elf, dwarf, gnome, halfling, …
 *   Gender  male | female
 *   Role    the word after race/gender — a class (ranger, wizard…),
 *           villager, musician — "commoner" when there is none, or
 *           "animal" for animal_* sprites
 *   Detail  everything after the role (noble, wealthy, lute, goat…)
 *
 * Names without a gender word (item icons, map tiles, monster/orc…)
 * get no tags, so the categories never fill with noise. Used
 * by the NPC browse table (filters + Tags column) and the sprite
 * picker's tag filter bar.
 */

export const SPRITE_TAG_CATEGORIES = ["Race", "Gender", "Role", "Detail"] as const;
export type SpriteTagCategory = (typeof SPRITE_TAG_CATEGORIES)[number];

export interface SpriteTag {
  category: SpriteTagCategory;
  /** Title-cased display value, e.g. "Elf", "Villager", "Noble". */
  value: string;
}

/** File-name word → race display name. "person" is the Human race. */
const RACES: Record<string, string> = {
  person: "Human",
  human: "Human",
  elf: "Elf",
  dwarf: "Dwarf",
  gnome: "Gnome",
  halfling: "Halfling",
  orc: "Orc",
  halforc: "Half-Orc",
  goblin: "Goblin",
};
const GENDERS = new Set(["male", "female"]);

function title(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

/** Tags for one sprite path ("person/elf_male_wizard.png") or bare
 *  file name / stem. Empty array when the name carries no descriptors. */
export function spriteTags(pathOrFile: string | null | undefined): SpriteTag[] {
  const raw = String(pathOrFile ?? "").trim();
  if (!raw) return [];
  const file = raw.slice(raw.lastIndexOf("/") + 1);
  const words = file
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
  if (words.length === 0) return [];

  if (words[0] === "animal") {
    return [
      { category: "Role", value: "Animal" },
      ...words.slice(1).map((w) => ({ category: "Detail" as const, value: title(w) })),
    ];
  }

  const tags: SpriteTag[] = [];
  const rest: string[] = [];
  for (const w of words) {
    if (RACES[w] && !tags.some((t) => t.category === "Race")) {
      tags.push({ category: "Race", value: RACES[w] });
    } else if (GENDERS.has(w) && !tags.some((t) => t.category === "Gender")) {
      tags.push({ category: "Gender", value: title(w) });
    } else {
      rest.push(w);
    }
  }
  // Person art always names a gender; without one (monster/orc.png,
  // item icons…) the words aren't descriptors, so no tags.
  if (!tags.some((t) => t.category === "Gender")) return [];
  const [role, ...details] = rest;
  tags.push({ category: "Role", value: role ? title(role) : "Commoner" });
  for (const d of details) tags.push({ category: "Detail", value: title(d) });
  return tags;
}

/** "Category: Value" — the same nesting convention record tags use. */
export function formatSpriteTag(t: SpriteTag): string {
  return `${t.category}: ${t.value}`;
}

/** Parse a "Category: Value" string back into a tag when its category
 *  is one of ours (so hand-added NPC tags like "Role: Guard" join the
 *  category filters). Anything else → null. */
export function parseCategoryTag(s: string): SpriteTag | null {
  const m = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/.exec(s);
  if (!m) return null;
  const cat = SPRITE_TAG_CATEGORIES.find(
    (c) => c.toLowerCase() === m[1].toLowerCase(),
  );
  return cat ? { category: cat, value: m[2] } : null;
}

/** Compact one-line summary: "Elf · Male · Villager · Noble". */
export function spriteTagSummary(pathOrFile: string | null | undefined): string {
  return spriteTags(pathOrFile).map((t) => t.value).join(" · ");
}

/** Readable name for a sprite tile: "Villager (Noble)" with a second
 *  line "Elf · Male"; non-descriptive names fall back to the stem with
 *  underscores as spaces so long names can wrap instead of truncating. */
export function spriteDisplayName(pathOrFile: string): {
  label: string;
  sublabel: string;
} {
  const file = pathOrFile.slice(pathOrFile.lastIndexOf("/") + 1);
  const stem = file.replace(/\.[a-z0-9]+$/i, "");
  const tags = spriteTags(file);
  if (tags.length === 0) {
    return { label: stem.replace(/[_\-]+/g, " "), sublabel: "" };
  }
  const of = (c: SpriteTagCategory) =>
    tags.filter((t) => t.category === c).map((t) => t.value);
  const role = of("Role")[0] ?? "";
  const details = of("Detail");
  const label = details.length ? `${role} (${details.join(" ")})` : role;
  const sublabel = [...of("Race"), ...of("Gender")].join(" · ");
  return { label, sublabel };
}
