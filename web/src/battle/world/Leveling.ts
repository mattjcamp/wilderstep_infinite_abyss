/**
 * XP awards & level-up logic.
 *
 *   - The XP curve uses a **rising increment**: the cost of the *next*
 *     level is `current_level × exp_per_level`, paid on top of all XP
 *     spent so far. Level 1→2 costs 1×exp_per_level, 2→3 costs
 *     2×exp_per_level, and so on — total XP to reach level N is the
 *     triangular sum `exp_per_level × N(N-1)/2`. This keeps pacing
 *     roughly flat in fights-per-level: monster XP awards grow with
 *     difficulty tier, and the per-level cost grows to match. (The
 *     older flat curve — a constant exp_per_level per level — made
 *     leveling accelerate sharply once the party reached high-XP
 *     encounters.)
 *   - `exp_per_level` comes from the class template (default 1500),
 *     with a possible race override (Humans = 1125 via Fast Learner —
 *     a proportional ~25% discount at every level).
 *   - Each level-up adds `hp_per_level + CON mod` HP (minimum +1).
 *     Constitution drives toughness for every class — Fighters with
 *     high CON see bigger HP swings than wizards on the same roll.
 *   - Casters also gain `mp_per_level + casting_stat mod` MP, where the
 *     casting stat is named by `mp_source.ability` (single-stat) or
 *     derived from `mp_source.abilities + mode` (dual-stat). Non-casters
 *     (mp_per_level === 0) get no MP gain.
 *   - Multiple level-ups in one award are processed sequentially —
 *     enough XP can carry a member through several thresholds at once.
 */

import type { PartyMember } from "./Party";
import type { ClassTemplate, RaceInfo } from "./Classes";
import type { Spell } from "./Spells";
import { classCanCast, minLevelFor } from "./Spells";

/** A class ability or spell that becomes available at this level-up. */
export interface UnlockedSpell {
  /** Spell name as the dialog should display it. */
  name: string;
  /** MP cost — surfaced in the dialog so casters know what it'll run them. */
  mpCost: number;
  description: string;
}

export interface UnlockedAbility {
  name: string;
  description: string;
}

export interface LevelUpEvent {
  name: string;
  newLevel: number;
  hpGain: number;
  mpGain: number;
  message: string;
  /** Spells the member learns at this exact level. Filtered against
   *  the class's `allowable_classes` + per-class min-level rules. */
  newSpells: UnlockedSpell[];
  /** Non-spell class abilities (Pick Locks, Turn Undead, …) whose
   *  `min_level` matches this level. */
  newAbilities: UnlockedAbility[];
}

/** D&D-style modifier (10 = 0, 18 = +4, 8 = -1, …). */
function abilityMod(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

function castingMod(member: PartyMember, tpl: ClassTemplate): number {
  const src = tpl.mp_source;
  if (!src) return 0;
  if (src.ability) {
    return abilityMod(member[src.ability]);
  }
  if (Array.isArray(src.abilities) && src.abilities.length > 0) {
    const vals = src.abilities.map((a) => member[a]);
    if (src.mode === "higher") return abilityMod(Math.max(...vals));
    if (src.mode === "average") {
      const avg = Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length);
      return abilityMod(avg);
    }
    return abilityMod(Math.min(...vals)); // Python default
  }
  return 0;
}

/**
 * Total (cumulative) XP required to *be* `level`, under the rising-
 * increment curve: each level L→L+1 costs `L × xpPer`, so the total
 * is the triangular sum `xpPer × level(level-1)/2`. Level 1 costs 0.
 */
export function xpTotalForLevel(level: number, xpPer: number): number {
  return (xpPer * level * (level - 1)) / 2;
}

/**
 * XP progress *within the current level* — the numbers driving the
 * party screen / character sheet XP bars. `exp` is cumulative across
 * the member's whole life (awardXp never resets it), so the bar must
 * subtract the current level's cumulative threshold to read as
 * "progress toward the next level".
 *
 *  - `into` — XP earned since reaching the current level. 0 the
 *    instant a member levels up; equals `needed` the instant they're
 *    about to level again.
 *  - `needed` — XP to earn during this level to cross into the next:
 *    `level × xpPer` under the rising-increment curve. Floored at 1
 *    so a 0-xpPer edge case can't divide-by-zero in bar fill math.
 *
 * Single source of truth — UI components should call this rather
 * than re-deriving thresholds, so curve changes land everywhere.
 */
export function xpProgressInLevel(
  level: number,
  exp: number,
  xpPer: number,
): { into: number; needed: number } {
  const prev = xpTotalForLevel(level, xpPer);
  const next = xpTotalForLevel(level + 1, xpPer);
  return {
    into: Math.max(0, exp - prev),
    needed: Math.max(1, next - prev),
  };
}

/** Cumulative XP threshold at which the member reaches `member.level + 1`. */
export function xpForNextLevel(
  member: PartyMember,
  tpl: ClassTemplate,
  race: RaceInfo | null,
): number {
  const xpPer = race?.exp_per_level ?? tpl.exp_per_level;
  return xpTotalForLevel(member.level + 1, xpPer);
}

/**
 * Spells the member's class learns at exactly `level`. Filters the
 * full catalog against the class's casting catalogs + per-class
 * level overrides. v2 derives eligibility from
 * `class.casting_type[]` matching `spell.casting_type`.
 *
 * Pure helper — exported so the same predicate can drive a "What's
 * next?" preview elsewhere in the UI.
 */
export function spellsUnlockedAt(
  klass: string,
  level: number,
  spells: ReadonlyArray<Spell>,
  classTemplate: ClassTemplate | null,
): UnlockedSpell[] {
  const out: UnlockedSpell[] = [];
  for (const s of spells) {
    if (!classCanCast(s, classTemplate)) continue;
    if (minLevelFor(s, klass) !== level) continue;
    out.push({
      name: s.name,
      mpCost: s.mp_cost,
      description: s.description,
    });
  }
  return out;
}

/** Class abilities (non-spell) whose `minLevel` matches `level`. */
export function abilitiesUnlockedAt(
  tpl: ClassTemplate,
  level: number,
): UnlockedAbility[] {
  // v2 stores class abilities as {ability_id, min_level} pairs;
  // name + description live on abilities.json. The level-up UI is
  // off the visual-test path right now, so this returns the
  // ability id as a placeholder name until the consumer threads
  // the abilities catalog through.
  return (tpl.abilities ?? [])
    .filter((a) => a.min_level === level)
    .map((a) => ({ name: a.ability_id, description: "" }));
}

/**
 * Add XP and apply any level-ups in place. Returns one event per
 * level gained so the caller can show messages / play sfx / animate.
 *
 * Mutates `member.exp`, `member.level`, `member.max_hp`, `member.hp`,
 * and (for casters) `member.max_mp`, `member.mp`. HP / MP are bumped
 * by the gain on each level so a wounded member partially heals on
 * level-up — same behaviour as the Python game.
 *
 * `spells` is the full spell catalog; pass `[]` (or omit) to skip
 * the spell-unlock diff. The class template's own `classAbilities`
 * already covers non-spell unlocks without needing extra data.
 */
export function awardXp(
  member: PartyMember,
  xp: number,
  tpl: ClassTemplate,
  race: RaceInfo | null,
  spells: ReadonlyArray<Spell> = [],
): LevelUpEvent[] {
  if (xp <= 0) return [];
  member.exp += xp;
  const events: LevelUpEvent[] = [];
  const xpPer = race?.exp_per_level ?? tpl.exp_per_level;
  while (member.exp >= xpTotalForLevel(member.level + 1, xpPer)) {
    member.level += 1;

    const hpGain = Math.max(1, tpl.hp_per_level + abilityMod(member.constitution));
    member.max_hp += hpGain;
    member.hp = Math.min(member.hp + hpGain, member.max_hp);

    let mpGain = 0;
    if (tpl.mp_per_level > 0) {
      mpGain = Math.max(0, tpl.mp_per_level + castingMod(member, tpl));
      if (mpGain > 0) {
        if (member.max_mp == null) member.max_mp = 0;
        if (member.mp == null) member.mp = 0;
        member.max_mp += mpGain;
        member.mp = Math.min(member.mp + mpGain, member.max_mp);
      }
    }

    // Diff against the *new* level — these are unlocks the player
    // didn't have a moment ago.
    const newSpells = spellsUnlockedAt(member.class, member.level, spells, tpl);
    const newAbilities = abilitiesUnlockedAt(tpl, member.level);

    let msg = `${member.name} reached Level ${member.level}! HP+${hpGain}`;
    if (mpGain > 0) msg += ` MP+${mpGain}`;
    events.push({
      name: member.name,
      newLevel: member.level,
      hpGain,
      mpGain,
      message: msg,
      newSpells,
      newAbilities,
    });
  }
  return events;
}
