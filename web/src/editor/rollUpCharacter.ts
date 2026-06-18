/**
 * rollUpCharacter — "level a character up to N" for the editor's
 * Character sheet.
 *
 * Purpose: generate a realistic character at a higher level so an
 * author can test mid/late-game balance or start an adventure with a
 * seasoned party, without hand-computing HP/MP/XP. Bumping a level-1
 * Wizard to 10 should produce the same stats the player would have if
 * they'd earned their way there.
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
 * The roll-up is additive from the character's CURRENT level — it
 * applies the gains for each level crossed and preserves whatever base
 * the record already carries. Rolling to a level at or below the
 * current one is a no-op (the control only rolls up).
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

export interface RollUpResult {
  /** The updated record (level / hp / mp / exp rewritten). Same object
   *  identity as the input when nothing changed. */
  character: CharacterRecord;
  /** Levels actually crossed (0 when the target ≤ current level). */
  levelsGained: number;
  /** Total HP added across the crossed levels. */
  hpGained: number;
  /** Total MP added across the crossed levels (0 for non-casters). */
  mpGained: number;
  /** Cumulative XP the character is credited with at the new level. */
  exp: number;
}

/**
 * Roll `char` up to `targetLevel`, applying the game's per-level HP/MP
 * gains and crediting the cumulative XP for that level. Pure — returns
 * a fresh record, never mutates the input. A target at or below the
 * current level (or a missing/unknown class) is a no-op.
 */
export function rollUpCharacterToLevel(
  char: CharacterRecord,
  rawClass: RawClass | null | undefined,
  targetLevel: number,
): RollUpResult {
  const tpl = rawClass ? classFromRaw(rawClass) : null;
  const target = Math.max(1, Math.floor(Number(targetLevel) || 1));
  const current = Math.max(1, Math.floor(char.level || 1));

  if (!tpl || target <= current) {
    return {
      character: char,
      levelsGained: 0,
      hpGained: 0,
      mpGained: 0,
      exp: char.exp,
    };
  }

  const conMod = abilityMod(char.constitution);
  const castMod = castingMod(tpl, char);
  const hpGainPer = Math.max(1, tpl.hp_per_level + conMod);
  const mpGainPer = tpl.mp_per_level > 0 ? Math.max(0, tpl.mp_per_level + castMod) : 0;

  const levelsGained = target - current;
  const hpGained = hpGainPer * levelsGained;
  const mpGained = mpGainPer * levelsGained;

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
      hp: char.hp + hpGained,
      mp: char.mp + mpGained,
      exp,
    },
    levelsGained,
    hpGained,
    mpGained,
    exp,
  };
}
