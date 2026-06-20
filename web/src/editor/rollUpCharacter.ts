/**
 * rollCharacterToLevel — "roll a character to level N" for the editor's
 * Character sheet.
 *
 * Purpose: generate a realistic character at an arbitrary level so an
 * author can test balance at any point in the curve — mid/late-game,
 * or back down to an earlier level — without hand-computing HP/MP/XP.
 * Setting a level-1 Wizard to 10 produces the same stats the player
 * would have if they'd earned their way there; setting that same
 * Wizard back to 5 reverses exactly the gains for those levels.
 *
 * Fidelity: the per-level gains mirror `awardXp` in
 * `battle/world/Leveling.ts` exactly —
 *
 *   hpGain = max(1, hp_per_level + CON mod)
 *   mpGain = max(0, mp_per_level + casting-stat mod)   (casters only)
 *
 * — and the credited XP is the cumulative threshold the level curve
 * puts that level at (`xpTotalForLevel`). The class's per-level
 * numbers + casting stat are resolved through `classFromRaw`, so the
 * same defaults the game applies (1500 XP/level, casting stat by class)
 * are used here too.
 *
 * Because the per-level gain is constant (it depends only on the class
 * and the character's CON / casting stat, not on the level), the roll
 * is fully symmetric: it applies `(target - current)` levels' worth of
 * gains to whatever base the record already carries. A positive delta
 * rolls up, a negative delta rolls down, and rolling down then back up
 * round-trips to the same stats. HP is floored at 1 and MP at 0 so a
 * roll-down can never produce a non-positive pool. Rolling to the
 * current level (or with a missing/unknown class) is a no-op.
 */

import { classFromRaw, type ClassTemplate, type RawClass } from "@/battle/world/Classes";
import { xpTotalForLevel } from "@/battle/world/Leveling";
import type { CharacterRecord } from "./CharacterSheet";

/** D&D-style ability modifier — floor((stat - 10) / 2). Matches
 *  `abilityMod` in Leveling.ts. */
function abilityMod(stat: unknown): number {
  const n = typeof stat === "number" ? stat : 10;
  return Math.floor((n - 10) / 2);
}

/** Casting-stat modifier for MP gain, mirroring `castingMod` in
 *  Leveling.ts — reads the class's `mp_source` (single ability, or a
 *  dual-ability higher/average/lower blend) against the character's
 *  own stats. Returns 0 for non-casters / unconfigured sources. */
function castingMod(tpl: ClassTemplate, char: CharacterRecord): number {
  const src = tpl.mp_source;
  if (!src) return 0;
  const stat = (k: string): number => abilityMod((char as Record<string, unknown>)[k]);
  if (src.ability) return stat(src.ability);
  if (Array.isArray(src.abilities) && src.abilities.length > 0) {
    const vals = src.abilities.map((a) => Number((char as Record<string, unknown>)[a] ?? 10));
    if (src.mode === "higher") return abilityMod(Math.max(...vals));
    if (src.mode === "average") {
      return abilityMod(Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length));
    }
    return abilityMod(Math.min(...vals));
  }
  return 0;
}

export interface RollResult {
  /** The updated record (level / hp / mp / exp rewritten). Same object
   *  identity as the input when nothing changed. */
  character: CharacterRecord;
  /** Levels actually crossed — signed. Positive when rolling up,
   *  negative when rolling down, 0 when the target is the current
   *  level (or the class is unknown). */
  levelDelta: number;
  /** HP actually added (or removed, when negative) by the roll, after
   *  the floor-at-1 clamp. */
  hpDelta: number;
  /** MP actually added (or removed, when negative) by the roll, after
   *  the floor-at-0 clamp. 0 for non-casters. */
  mpDelta: number;
  /** Cumulative XP the character is credited with at the new level. */
  exp: number;
}

/**
 * Roll `char` to `targetLevel`, applying the game's per-level HP/MP
 * gains for each level crossed (in either direction) and crediting the
 * cumulative XP for that level. Pure — returns a fresh record, never
 * mutates the input. A target equal to the current level (or a
 * missing/unknown class) is a no-op.
 */
export function rollCharacterToLevel(
  char: CharacterRecord,
  rawClass: RawClass | null | undefined,
  targetLevel: number,
): RollResult {
  const tpl = rawClass ? classFromRaw(rawClass) : null;
  const target = Math.max(1, Math.floor(Number(targetLevel) || 1));
  const current = Math.max(1, Math.floor(char.level || 1));

  if (!tpl || target === current) {
    return {
      character: char,
      levelDelta: 0,
      hpDelta: 0,
      mpDelta: 0,
      exp: char.exp,
    };
  }

  const conMod = abilityMod(char.constitution);
  const castMod = castingMod(tpl, char);
  const hpGainPer = Math.max(1, tpl.hp_per_level + conMod);
  const mpGainPer = tpl.mp_per_level > 0 ? Math.max(0, tpl.mp_per_level + castMod) : 0;

  // Signed level delta — drives both up- and down-rolls. The per-level
  // gain is constant, so the raw HP/MP change is just the gain times the
  // delta; we then clamp the resulting pools so a down-roll can't drop
  // HP below 1 or MP below 0, and report the *applied* delta after the
  // clamp so the preview stays honest.
  const levelDelta = target - current;

  const newHp = Math.max(1, char.hp + hpGainPer * levelDelta);
  const newMp = Math.max(0, char.mp + mpGainPer * levelDelta);
  const hpDelta = newHp - char.hp;
  const mpDelta = newMp - char.mp;

  // Guard the XP-per-level against a non-positive / missing curve value
  // so the credited XP can never be NaN; the engine default is 1500.
  const xpPer =
    typeof tpl.exp_per_level === "number" && tpl.exp_per_level > 0
      ? tpl.exp_per_level
      : 1500;
  const exp = xpTotalForLevel(target, xpPer);

  return {
    character: {
      ...char,
      level: target,
      hp: newHp,
      mp: newMp,
      exp,
    },
    levelDelta,
    hpDelta,
    mpDelta,
    exp,
  };
}
