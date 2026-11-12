/**
 * Human-readable labels for `sprites/person/*.png`, parsed from the
 * file-name convention:
 *
 *   <race>_<gender>[_<role>]          person_male_ranger, gnome_female
 *   <race>_<gender>_villager_<tier>   dwarf_male_villager_noble
 *   <race>_<gender>_musician_<instr>  person_female_musician_fiddle
 *   animal_<kind>                     animal_goat
 *
 * `person` is the Human race. A sprite with no role is the plain body
 * ("Commoner"). Anything that doesn't fit is kept as kind "other" with
 * its file stem as the label, so new art never disappears from the
 * picker.
 */

export type PersonSpriteKind =
  | "class"
  | "commoner"
  | "villager"
  | "musician"
  | "animal"
  | "other";

export interface PersonSpriteInfo {
  /** Path under sprites/, e.g. "person/person_male_ranger.png". */
  path: string;
  stem: string;
  kind: PersonSpriteKind;
  /** Race id ("human", "dwarf", …) — null for animals / other. */
  race: string | null;
  /** "male" | "female" — null for animals / other. */
  gender: "male" | "female" | null;
  /** Class id for kind "class" (ranger, wizard, …), else null. */
  classId: string | null;
  /** Main label: "Ranger", "Villager (Noble)", "Musician (Lute)", "Goat". */
  label: string;
  /** Second line: "Human · Male" (empty for animals). */
  sublabel: string;
}

const RACE_ALIASES: Record<string, string> = { person: "human" };

export function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function parsePersonSprite(
  file: string,
  raceName: (id: string) => string = titleCase,
): PersonSpriteInfo {
  const stem = file.replace(/\.[a-z0-9]+$/i, "");
  const path = `person/${file}`;
  const parts = stem.split("_");
  const base = { path, stem };

  if (parts[0] === "animal" && parts.length >= 2) {
    return {
      ...base,
      kind: "animal",
      race: null,
      gender: null,
      classId: null,
      label: titleCase(parts.slice(1).join("_")),
      sublabel: "Animal",
    };
  }
  const gender: "male" | "female" | null =
    parts[1] === "male" || parts[1] === "female" ? parts[1] : null;
  if (parts.length < 2 || !gender) {
    return {
      ...base,
      kind: "other",
      race: null,
      gender: null,
      classId: null,
      label: titleCase(stem),
      sublabel: "",
    };
  }
  const race = RACE_ALIASES[parts[0]] ?? parts[0];
  const sublabel = `${raceName(race)} · ${titleCase(gender)}`;
  const rest = parts.slice(2);
  const common = { ...base, race, gender, sublabel };
  if (rest.length === 0) {
    return { ...common, kind: "commoner", classId: null, label: "Commoner" };
  }
  if (rest[0] === "villager" || rest[0] === "musician") {
    const what = rest.slice(1).join("_");
    return {
      ...common,
      kind: rest[0],
      classId: null,
      label: what
        ? `${titleCase(rest[0])} (${titleCase(what)})`
        : titleCase(rest[0]),
    };
  }
  const role = rest.join("_");
  return { ...common, kind: "class", classId: role, label: titleCase(role) };
}

/**
 * The sprite the character creator pre-selects (and badges
 * "Suggested") for a race + gender + class. `files` are the file
 * names under sprites/person/; returns a "person/<file>" path, or the
 * class's authored `default_sprite`, or "" when there's no art at all.
 *
 * Best match first:
 *   1. exact race + gender + class   (elf_female_ranger)
 *   2. same class + gender, any race (Human first)
 *   3. the class's `default_sprite`
 *   4. race + gender commoner, then any race + gender sprite
 *   5. any person sprite of that gender, then any non-animal sprite
 */
export function recommendedPersonSprite(
  files: ReadonlyArray<string>,
  opts: {
    raceId: string;
    gender: string;
    classId: string;
    classDefault?: string;
  },
): string {
  const gender = opts.gender.toLowerCase();
  const all = files.map((f) => parsePersonSprite(f));
  const pick = (pred: (s: PersonSpriteInfo) => boolean) =>
    all.find(pred)?.path;
  const byHumanFirst = [...all].sort(
    (a, b) => Number(b.race === "human") - Number(a.race === "human"),
  );
  const classDefault = (opts.classDefault ?? "").trim();
  return (
    pick(
      (s) =>
        s.kind === "class" &&
        s.race === opts.raceId &&
        s.gender === gender &&
        s.classId === opts.classId,
    ) ??
    byHumanFirst.find(
      (s) => s.kind === "class" && s.gender === gender && s.classId === opts.classId,
    )?.path ??
    (classDefault || undefined) ??
    pick((s) => s.kind === "commoner" && s.race === opts.raceId && s.gender === gender) ??
    pick((s) => s.race === opts.raceId && s.gender === gender) ??
    pick((s) => s.gender === gender) ??
    pick((s) => s.kind !== "animal") ??
    ""
  );
}
