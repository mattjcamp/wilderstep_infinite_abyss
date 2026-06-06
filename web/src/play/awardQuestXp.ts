/**
 * Quest XP banking — pure helpers.
 *
 * Quest turn-in awards XP. Two entry points:
 *
 *   - `awardQuestXpToSavedMembers` — the original bank-only helper:
 *     adds XP to every alive member's saved `exp` and leaves `level`
 *     untouched (level-ups defer to the next combat's `awardXp`
 *     catch-up loop). Kept for callers without catalog access.
 *
 *   - `awardQuestXpWithLevelUps` — banks the XP AND runs the same
 *     level-up math combat uses (Leveling.ts `awardXp`: rising-
 *     increment curve, `hp_per_level + CON mod` HP, caster MP gains)
 *     against the saved members directly. This is what PlayHost's
 *     quest turn-in calls now, so a quest reward that crosses a
 *     threshold levels the member immediately instead of waiting
 *     for the next fight. Spell-unlock diffing is skipped (the
 *     catalog of battle Spell records isn't threaded through) —
 *     newly-eligible spells appear on the character sheet anyway,
 *     since the sheet derives spell lists from level + class at
 *     render time.
 *
 * XP distribution matches the combat reward semantics: every alive
 * member gets the FULL quest XP value, not a per-member split. The
 * dead don't get to brag.
 */

import type { SavedCharacterState } from "./saveTypes";
import { awardXp } from "@/battle/world/Leveling";
import {
  classFromRaw,
  type RawClass,
  type RaceInfo,
} from "@/battle/world/Classes";
import type { PartyMember } from "@/battle/world/Party";

export interface AwardQuestXpResult {
  /** Per-member result rows in input order. `nextMembers[i]` is the
   *  updated record for `members[i]` — never the same object reference
   *  even when no change applies, so callers can pass it straight
   *  into the next save commit. */
  nextMembers: SavedCharacterState[];
  /** True iff at least one member's `exp` actually changed. Callers
   *  use this to decide whether to commit a save (skipping the
   *  write when no XP was banked — e.g. a 0-XP quest or a wiped
   *  party). */
  changed: boolean;
}

/**
 * Bank `xpPerMember` XP into every alive member's `exp`, leaving
 * fallen members (hp <= 0) untouched. Returns the next members[]
 * + a `changed` flag so callers can short-circuit a no-op save
 * commit.
 *
 * Pure: input is not mutated; every returned member is a fresh
 * object whose `exp` field is incremented from the saved baseline
 * (defaulting absent `exp` to 0). `level` is intentionally NOT
 * touched here — see the module doc for why the level-up math
 * defers to the next combat.
 *
 * `xpPerMember <= 0` short-circuits to `{ nextMembers: members
 * spread, changed: false }`. The XP-zero case is common (a
 * "talk-only" quest with no reward bundle declared) and shouldn't
 * burn a save commit.
 */
export function awardQuestXpToSavedMembers(
  members: ReadonlyArray<SavedCharacterState>,
  xpPerMember: number,
): AwardQuestXpResult {
  if (!Number.isFinite(xpPerMember) || xpPerMember <= 0) {
    return { nextMembers: members.map((m) => ({ ...m })), changed: false };
  }
  let changed = false;
  const nextMembers = members.map((m) => {
    // Dead members don't bank XP — matches the combat path's
    // "alive only" gate.
    if (m.hp <= 0) return { ...m };
    changed = true;
    const baseline = typeof m.exp === "number" ? m.exp : 0;
    return { ...m, exp: baseline + xpPerMember };
  });
  return { nextMembers, changed };
}

/** Catalog character shape the level-up path needs: class + race
 *  to resolve the templates, ability scores for the CON / casting-
 *  stat modifiers, hp/mp as max-fallbacks for legacy saves that
 *  predate `max_hp` / `max_mp` backfill. All optional so thin
 *  fixtures still work (absent stats read as 10 = +0 mod). */
export interface QuestXpCharacterRef {
  id: string;
  name?: string;
  class?: string;
  race?: string;
  hp?: number;
  mp?: number;
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
}

/** Raw race record shape — only `exp_per_level` matters here
 *  (Humans level faster). Mirrors races.json. */
export interface QuestXpRaceRef {
  id?: string;
  name?: string;
  exp_per_level?: number | null;
}

/** One level gained at quest turn-in — feeds the host's log strip
 *  ("Aldric reached Level 3! HP+7 MP+8"). Mirrors the fields of
 *  Leveling's LevelUpEvent that the host surfaces. */
export interface QuestLevelUpEvent {
  memberId: string;
  name: string;
  newLevel: number;
  hpGain: number;
  mpGain: number;
  message: string;
}

export interface AwardQuestXpWithLevelUpsResult {
  nextMembers: SavedCharacterState[];
  changed: boolean;
  /** One entry per level gained, in member order (a member who
   *  crosses two thresholds contributes two entries). Empty when
   *  nobody levelled. */
  levelUps: QuestLevelUpEvent[];
}

/**
 * Bank `xpPerMember` into every alive member AND apply any level-ups
 * the new total crosses — same curve and gains as combat's `awardXp`
 * (it literally calls it on a synthetic member built from the saved
 * record + catalog character).
 *
 * Per member:
 *   - Resolve the catalog character by id; player-rolled custom
 *     members fall back to their saved `custom` blob (a full
 *     character record).
 *   - Resolve the class template from the raw character_classes
 *     records via `classFromRaw` (which seeds hp/mp/exp-per-level
 *     defaults v2's catalog doesn't carry), and the race's
 *     `exp_per_level` override.
 *   - No class info resolvable → bank-only for that member (exp
 *     accrues, level stays — the old behaviour — rather than
 *     guessing a curve).
 *
 * Pure: inputs are not mutated; every returned member is a fresh
 * object.
 */
export function awardQuestXpWithLevelUps(
  members: ReadonlyArray<SavedCharacterState>,
  xpPerMember: number,
  characters: ReadonlyArray<QuestXpCharacterRef>,
  rawClasses: ReadonlyArray<RawClass>,
  races: ReadonlyArray<QuestXpRaceRef>,
): AwardQuestXpWithLevelUpsResult {
  if (!Number.isFinite(xpPerMember) || xpPerMember <= 0) {
    return {
      nextMembers: members.map((m) => ({ ...m })),
      changed: false,
      levelUps: [],
    };
  }
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  const classById = new Map(
    rawClasses
      .filter((c): c is RawClass & { id: string } => typeof c.id === "string")
      .map((c) => [c.id.toLowerCase(), c] as const),
  );
  const raceById = new Map(
    races
      .filter((r): r is QuestXpRaceRef & { id: string } => typeof r.id === "string")
      .map((r) => [r.id.toLowerCase(), r] as const),
  );

  let changed = false;
  const levelUps: QuestLevelUpEvent[] = [];
  const nextMembers = members.map((m) => {
    // Dead members don't bank XP — matches the combat path's
    // "alive only" gate.
    if (m.hp <= 0) return { ...m };
    changed = true;

    const cat: QuestXpCharacterRef | null =
      charById.get(m.id) ?? (m.custom as QuestXpCharacterRef | null) ?? null;
    const klass = (cat?.class ?? "").toLowerCase();
    const rawClass = klass ? classById.get(klass) : undefined;
    // classFromRaw seeds the hp/mp/exp-per-level defaults; feed it a
    // minimal record when the class id isn't in the catalog so a
    // known-class-id member still levels on the default curve.
    const tpl = rawClass
      ? classFromRaw(rawClass)
      : klass
        ? classFromRaw({ id: klass, name: klass })
        : null;
    if (!tpl) {
      // No class info — bank only (the legacy deferral behaviour).
      const baseline = typeof m.exp === "number" ? m.exp : 0;
      return { ...m, exp: baseline + xpPerMember };
    }

    const rawRace = cat?.race ? raceById.get(cat.race.toLowerCase()) : undefined;
    const race: RaceInfo | null = rawRace
      ? {
          id: rawRace.id ?? "",
          name: rawRace.name ?? rawRace.id ?? "",
          exp_per_level:
            typeof rawRace.exp_per_level === "number"
              ? rawRace.exp_per_level
              : undefined,
        }
      : null;

    // Synthetic member carrying exactly the fields awardXp reads /
    // mutates (exp, level, hp/max_hp, mp/max_mp, ability scores,
    // class, name). Cast is safe: awardXp touches nothing else.
    const synth = {
      id: m.id,
      name: cat?.name ?? m.id,
      class: tpl.id,
      level: typeof m.level === "number" ? m.level : 1,
      exp: typeof m.exp === "number" ? m.exp : 0,
      hp: m.hp,
      max_hp: m.max_hp ?? cat?.hp ?? m.hp,
      mp: m.mp ?? 0,
      max_mp: m.max_mp ?? cat?.mp ?? m.mp ?? 0,
      strength: cat?.strength ?? 10,
      dexterity: cat?.dexterity ?? 10,
      constitution: cat?.constitution ?? 10,
      intelligence: cat?.intelligence ?? 10,
      wisdom: cat?.wisdom ?? 10,
    } as unknown as PartyMember;

    const events = awardXp(synth, xpPerMember, tpl, race, []);
    for (const ev of events) {
      levelUps.push({
        memberId: m.id,
        name: ev.name,
        newLevel: ev.newLevel,
        hpGain: ev.hpGain,
        mpGain: ev.mpGain,
        message: ev.message,
      });
    }

    return {
      ...m,
      exp: synth.exp,
      level: synth.level,
      hp: synth.hp,
      max_hp: synth.max_hp,
      mp: synth.mp,
      max_mp: synth.max_mp,
    };
  });
  return { nextMembers, changed, levelUps };
}
