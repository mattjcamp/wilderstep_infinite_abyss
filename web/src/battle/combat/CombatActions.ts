/**
 * Data-driven combat actions — Throw, Cast, ranged attack.
 *
 * Each function is pure: takes the actor / target / item-or-spell
 * data, returns an `AttackResult`-shaped record so the combat log,
 * floating damage text, and HP refresh paths can stay shared with
 * the existing bump-attack flow.
 *
 * Item definitions come from `data/items.json` (via `Items.ts`),
 * spell definitions from `data/spells.json` (via `Spells.ts`). The
 * scene picks the relevant entry, calls the helper, then animates
 * + logs the result.
 */

import type { Combatant, AttackResult } from "../types";
import type { Item } from "../world/Items";
import { isCombatUsable } from "../world/Items";
import { classCanCast, type Spell } from "../world/Spells";
import type { ClassTemplate } from "../world/Classes";
import type { PartyMember } from "../world/Party";
import { rollAttack, rollBonusDamage, rollDamage } from "./engine";
import type { RNG } from "../rng";
import { assetUrl, withBase } from "../world/Module";
import { spriteUrl } from "@/data_model/spriteUrl";
import type { Buff } from "./Buffs";

/**
 * Resolve a creature-sprite reference from a summon spell into a URL
 * Phaser can load. Mirrors the v2 monster catalog's `resolveSpriteUrl`
 * — bare keys like `"monster/skeleton2.png"` land under `/sprites/`,
 * already-rooted paths (`"/assets/..."` or full URLs) pass through.
 * Falls back to the legacy `/assets/monsters/skeleton.png` so older
 * spell data without a `sprite` field still renders a graphic instead
 * of the no-texture rectangle.
 */
function resolveSummonSpriteUrl(sprite: unknown): string {
  if (typeof sprite !== "string" || sprite.length === 0) {
    return assetUrl("/assets/monsters/skeleton.png");
  }
  if (sprite.startsWith("http://") || sprite.startsWith("https://")) {
    return sprite;
  }
  // Already-rooted paths (legacy "/assets/…", or a pre-resolved
  // "/sprites/…") pass through unchanged.
  if (sprite.startsWith("/")) return withBase(sprite);
  // Bare "monster/x.png" — route through spriteUrl so a hosted module's
  // custom summon art lands on the worker (stock stays on the origin).
  return spriteUrl(sprite);
}

/**
 * Throwable / ranged attack — used by the Throw action and by ranged
 * weapons like bows. Damage scales off `item.power` (from the item
 * catalog). The to-hit bonus is the attacker's DEX mod: the
 * Combatant's `attackBonus` is the MELEE (bump) profile — STR-based,
 * with ranged weapons treated as improvised clubs — so projectiles
 * read `dexMod` directly. This also fixes thrown items for melee
 * wielders, which previously rode the STR-based melee bonus.
 */
export function resolveThrow(
  attacker: Combatant,
  target: Combatant,
  item: Item,
  rng: RNG,
): AttackResult & { item: string } {
  if (target.hp <= 0) {
    return {
      attackerId: attacker.id, targetId: target.id,
      hit: false, roll: 0, total: 0, critical: false,
      damage: 0, killed: false, item: item.name,
    };
  }
  const roll = rollAttack(attacker.dexMod, target.ac, rng);
  let damage = 0;
  let bonusDamage = 0;
  // Use item.power as the dice bonus on a single d6 — mirrors the
  // Python combat_engine's throw resolution where a thrown item
  // does ~ 1d6 + power damage. Bows / crossbows have higher power.
  const power = item.power ?? 1;
  if (roll.hit) {
    damage = rollDamage(1, 6, power, roll.critical, rng);
    // Magic-weapon bonus damage on the RANGED/thrown path — Stormbolt
    // Crossbow's lightning 1d6, a thrown Rimefang Dagger's ice, etc.
    // The melee bump path (Combat.attack) applies this for melee
    // weapons; ranged weapons' elemental payload lands HERE so it
    // fires on the shot, not on a club-with-the-stock bump. Same
    // dice spec + crit-doubling as the melee bonus.
    if (item.bonus_damage != null) {
      bonusDamage = rollBonusDamage(item.bonus_damage, roll.critical, rng);
      damage += bonusDamage;
    }
    target.hp = Math.max(0, target.hp - damage);
  }
  return {
    attackerId: attacker.id,
    targetId: target.id,
    hit: roll.hit,
    roll: roll.roll,
    total: roll.total,
    critical: roll.critical,
    damage,
    bonusDamage,
    damageType: item.damage_type,
    killed: target.hp === 0 && roll.hit,
    item: item.name,
  };
}

/**
 * Single-target damage spell — used for Magic Dart, Lightning Bolt,
 * and other `effect_type: damage`/`undead_damage` spells in combat.
 *
 * Mirrors the Python combat resolution at `src/states/combat.py:2653`:
 *   damage = roll(dice_count d dice_sides) + caster's stat-mod bonus
 *
 * `effect_value.stat_bonus` names the ability ("intelligence",
 * "wisdom", …) — Magic Arrow scales with INT, future spells can pick
 * any stat. Without the bonus the web port shipped a flat dice roll
 * that ignored the caster's primary attribute entirely.
 */
export function resolveDamageSpell(
  caster: Combatant,
  target: Combatant,
  spell: Spell,
  rng: RNG,
): AttackResult & { spell: string } {
  if (target.hp <= 0) {
    return {
      attackerId: caster.id, targetId: target.id,
      hit: false, roll: 0, total: 0, critical: false,
      damage: 0, killed: false, spell: spell.name,
    };
  }
  // Damage spells generally hit unless the spell explicitly calls
  // for a saving throw — the data we ship doesn't include that
  // detail yet, so we treat them as auto-hit at full power. The
  // d20 + attackBonus check stays in the result for log parity.
  const roll = rollAttack(caster.attackBonus, target.ac, rng);
  let damage = rollSpellDamage(spell, caster, rng);
  // Holy / anti-undead spells (Divine Smite) hit the undead harder.
  // The multiplier only applies when the target carries the undead
  // flag; living foes take the base roll.
  const undeadMult = spell.effect_value?.vs_undead_multiplier;
  if (typeof undeadMult === "number" && undeadMult > 0 && target.undead) {
    damage = Math.max(1, Math.round(damage * undeadMult));
  }
  target.hp = Math.max(0, target.hp - damage);
  return {
    attackerId: caster.id,
    targetId: target.id,
    hit: true,
    roll: roll.roll,
    total: roll.total,
    critical: false,
    damage,
    killed: target.hp === 0,
    spell: spell.name,
  };
}

/**
 * Roll dice + stat_bonus for a damage spell. Pure helper so AOE /
 * directional / single-target paths all share one source of truth.
 */
export function rollSpellDamage(spell: Spell, caster: Combatant, rng: RNG): number {
  const ev = spell.effect_value ?? {};
  let dice = 0;
  if (typeof ev.dice_count === "number" && typeof ev.dice_sides === "number") {
    dice = rollDamage(ev.dice_count, ev.dice_sides, 0, false, rng);
  } else if (typeof ev.dice === "string") {
    const m = /^(\d+)d(\d+)$/.exec(ev.dice);
    if (m) dice = rollDamage(parseInt(m[1], 10), parseInt(m[2], 10), 0, false, rng);
  } else {
    // Fallback for spells without explicit dice — small chip damage.
    dice = rollDamage(1, 4, 0, false, rng);
  }
  const bonus = casterStatBonus(caster, ev.stat_bonus);
  return Math.max(1, dice + bonus);
}

/** Read the caster's modifier for the named ability, defaulting to 0
 *  when the spell omits a stat_bonus or the Combatant lacks the
 *  ability score (monsters before we port their stat blocks). */
function casterStatBonus(caster: Combatant, statName: unknown): number {
  if (typeof statName !== "string") return 0;
  const stat = readAbility(caster, statName);
  if (stat === undefined) return 0;
  return Math.floor((stat - 10) / 2);
}

function readAbility(c: Combatant, name: string): number | undefined {
  switch (name.toLowerCase()) {
    case "strength":     return c.strength;
    case "dexterity":    return c.dexterity;
    case "intelligence": return c.intelligence;
    case "wisdom":       return c.wisdom;
    default:             return undefined;
  }
}

/**
 * Single-target heal — used for `heal` / `major_heal` spells cast
 * during combat. Mutates the target's HP up to maxHp. Returns a
 * shared shape with `heal: amount`.
 *
 * Mirrors `Member.cast_heal_in_combat` at `src/states/combat.py:2977`:
 *   hp_amount > 0  → flat amount (overrides dice)
 *   else           → dice + stat_bonus mod (WIS for cleric heals)
 */
export function resolveHealSpell(
  caster: Combatant,
  target: Combatant,
  spell: Spell,
  rng: RNG,
): { attackerId: string; targetId: string; heal: number; spell: string } {
  const amount = rollSpellHeal(spell, caster, rng);
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  return {
    attackerId: caster.id,
    targetId: target.id,
    heal: target.hp - before,
    spell: spell.name,
  };
}

/** Roll dice + stat_bonus for a heal spell. Honours `hp_amount` as a
 *  flat-amount override (mirrors the out-of-combat `rollHeal` at
 *  `web/src/game/world/PartyActions.ts:718` plus the Python combat
 *  branch). Shared between single-target and mass-heal paths. */
export function rollSpellHeal(spell: Spell, caster: Combatant, rng: RNG): number {
  const ev = spell.effect_value ?? {};
  if (typeof ev.hp_amount === "number") return Math.max(1, ev.hp_amount);
  let amount = 0;
  if (typeof ev.dice_count === "number" && typeof ev.dice_sides === "number") {
    amount = rollDamage(ev.dice_count, ev.dice_sides, 0, false, rng);
  } else if (typeof ev.dice === "string") {
    const m = /^(\d+)d(\d+)$/.exec(ev.dice);
    if (m) amount = rollDamage(parseInt(m[1], 10), parseInt(m[2], 10), 0, false, rng);
  } else {
    const defaults: Record<string, [number, number]> = {
      heal:        [1, 8],
      major_heal:  [2, 8],
      mass_heal:   [1, 6],
    };
    const def = defaults[spell.effect_type];
    if (def) amount = rollDamage(def[0], def[1], 0, false, rng);
  }
  const bonus = casterStatBonus(caster, ev.stat_bonus);
  return Math.max(1, amount + bonus);
}

/**
 * Whether a spell is castable in combat by a class with `template`
 * as its class template. v2 derives eligibility from
 * `class.casting_type[]` matching `spell.casting_type`.
 */
export function spellIsCombatCastable(
  spell: Spell,
  template: ClassTemplate | null,
): boolean {
  if (!spell.usable_in.includes("battle")) return false;
  return classCanCast(spell, template);
}

/**
 * Combat-side cast classification — drives the targeting flow.
 *
 *   - self        — applies to the caster; no picker
 *   - pick-ally   — choose a single party member
 *   - pick-enemy  — choose a single enemy
 *   - pick-tile   — place an effect at a chosen arena tile
 *                   (Fireball / Misty Step / Animate Dead)
 *   - mass-ally   — every alive ally (no picker)
 *   - mass-enemy  — every alive enemy (no picker)
 *   - unsupported — known effect but no resolution wired yet
 *
 * Combines `effect_type` with `targeting`; the data uses both, and
 * we honour the more specific one when available.
 */
export type CombatCastKind =
  | "self" | "pick-ally" | "pick-enemy" | "pick-tile"
  | "pick-direction"
  | "mass-ally" | "mass-enemy" | "unsupported";

export function classifyCombatCast(spell: Spell): CombatCastKind {
  const t = (spell.targeting ?? "").toLowerCase();
  const e = spell.effect_type;
  const scope = (() => {
    const ev = spell.effect_value;
    if (ev && typeof ev === "object" && typeof ev.scope === "string") {
      return ev.scope;
    }
    return "";
  })();

  // Tile-targeted spells get a dedicated arena picker.
  if (t === "select_tile") return "pick-tile";
  if (e === "aoe_damage" || e === "teleport" || e === "summon") {
    return "pick-tile";
  }

  // Mass-effect spells. Two ways a spell can be mass-ally:
  //   1. action_params.scope === "all_allies" — the canonical
  //      v2 signal. Mass Heal and Restore both use this with
  //      targeting=self.
  //   2. Bless — declared self-targeted in the data but the
  //      Python game has always applied it party-wide.
  if (scope === "all_allies") return "mass-ally";
  if (e === "bless") return "mass-ally";

  // Auto-against-all-enemies: Turn Undead's auto_monster targeting.
  if (e === "undead_damage" || t === "auto_monster") return "mass-enemy";

  // Self-only buffs and recoveries.
  if (t === "self") return "self";

  // Picker-driven targeting.
  if (t === "select_ally" || t === "select_ally_or_self") return "pick-ally";
  if (t === "select_enemy") return "pick-enemy";
  // Directional projectiles (Magic Dart-style): the player picks a
  // cardinal direction and the spell flies in a straight line until
  // it hits the first creature, a wall, or its `range` cap. Distinct
  // from pick-enemy (Magic Arrow) which lets the player click any foe.
  if (t === "directional_projectile") return "pick-direction";

  // Fallback by effect_type when targeting is missing or odd.
  if (e === "heal" || e === "major_heal" || e === "ac_buff" || e === "bless"
      || e === "range_buff" || e === "cure_poison" || e === "invisibility") {
    return "pick-ally";
  }
  if (e === "damage" || e === "lightning_bolt" || e === "sleep" || e === "charm"
      || e === "curse") {
    return "pick-enemy";
  }
  return "unsupported";
}

// ── Spell side-effects we don't (yet) model with a status engine ──
//
// Sleep / charm / curse / bless / ac_buff / range_buff /
// invisibility / cure_poison / restore all want a per-combatant
// "for N turns" effect tracker, which we haven't built. For now the
// cast resolves with a clean log line so the spell flow is visibly
// wired end-to-end — when the status-effect system lands these will
// pick up actual mechanics without touching the scene.
//
// Returns the human-readable verb that ends up in the log.
export function describeStatusCast(
  caster: Combatant, target: Combatant, spell: Spell,
): string {
  const e = spell.effect_type;
  if (e === "sleep")        return `${target.name} drifts into a magical sleep.`;
  if (e === "charm")        return `${target.name} is charmed by ${caster.name}.`;
  if (e === "curse")        return `${target.name} is cursed.`;
  if (e === "bless")        return `${caster.name} is blessed (+attack).`;
  if (e === "ac_buff")      return `${target.name} gains a magical shield.`;
  if (e === "range_buff")   return `${target.name}'s movement is hastened.`;
  if (e === "invisibility") return `${caster.name} fades from view.`;
  if (e === "cure_poison")  return `${target.name} is purged of poison.`;
  if (e === "restore")      return `${caster.name} is fully restored.`;
  return `${spell.name} has no visible effect.`;
}

/**
 * Strictly filter a flat catalog of items for "throwable in combat".
 * Mirrors the items.json `throwable` flag — daggers, rocks, fire
 * oils, poison vials. Ranged weapons (bows, crossbows, slings) have
 * `ranged: true` but `throwable: false`; they belong to a separate
 * ranged-attack flow, not the Throw menu.
 */
export function isThrowable(item: Item): boolean {
  return !!item.throwable;
}

/**
 * True when the item is a fire-and-forget ranged weapon — bows,
 * crossbows, slings. `Rock` is both throwable AND ranged; we treat
 * it as ranged here (the Throw menu still picks it up via
 * isThrowable, so authors can use either action).
 */
export function isRanged(item: Item): boolean {
  return !!item.ranged;
}

/**
 * Max attack range (in tiles) for a ranged weapon. Mirrors what the
 * Python game's combat tables use — long bows reach further than
 * short bows, crossbows are mid-range, slings + rocks are short.
 *
 * Falls back to 8 for ranged items the catalog doesn't recognise so
 * the action stays usable when new weapon types are added.
 */
export function maxRangeFor(item: Item): number {
  // Authoritative source: the item's own `range`. Authors edit
  // ranges per-weapon in items.json without touching code.
  if (typeof item.range === "number" && Number.isFinite(item.range) && item.range > 0) {
    return item.range;
  }
  // Legacy fallback: derive from item_type for older catalogs that
  // haven't been updated with explicit ranges yet. New v2 data
  // should set `range` directly; this branch keeps existing tests
  // and pre-v2 saves from regressing.
  switch (item.item_type) {
    case "long_bow":  return 10;
    case "crossbow":  return 8;
    case "short_bow": return 6;
    case "sling":     return 6;
    case "rock":      return 4;
    default:
      return item.ranged ? 8 : 1;
  }
}

// ── Spell saving throws ─────────────────────────────────────────────
//
// Centralised "did the target resist the spell?" roll. Pulls the
// caster's spell-casting stat (INT for sorcerer-line, WIS for priest-
// line) and the defender's save stat (named on the spell's
// `save_dc_stat` action_param). When the defender carries real
// attribute scores — Combatants stamped from a PartyMember OR from a
// MonsterSpec with the new attribute fields — the save bonus reflects
// the actual ability modifier. When attributes are missing (legacy
// monsters without the v2 stat block), the save bonus falls back to a
// conservative heuristic so the call still resolves.

/** D&D-style modifier: 10 = +0, 18 = +4, 8 = -1. Exposed because
 *  multiple resolvers consume it. */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Which Combatant stat field the spell's casting type taps for the
 *  DC bonus. Sorcerer-line spells (Sleep, Magic Dart, Fireball) use
 *  INT; priest-line spells (Curse, Turn Undead) use WIS. Falls back
 *  to WIS for unknown casting types since most save-bearing legacy
 *  spells were priest-flavoured. */
function castingStatField(spell: Spell): "intelligence" | "wisdom" {
  return spell.casting_type === "sorcerer" ? "intelligence" : "wisdom";
}

/** Save-stat field on the defender. Reads `save_dc_stat` from the
 *  spell's action_params; defaults to wisdom so callers don't have
 *  to set the field explicitly for the legacy will-save case. */
function saveStatField(
  spell: Spell,
): "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" {
  const ev = (spell.effect_value ?? {}) as Record<string, unknown>;
  const s = typeof ev.save_dc_stat === "string" ? ev.save_dc_stat : "wisdom";
  if (s === "strength" || s === "dexterity" || s === "constitution" ||
      s === "intelligence" || s === "wisdom") {
    return s;
  }
  return "wisdom";
}

export interface SpellSaveResult {
  /** True when the defender resisted (d20 + bonus ≥ DC). */
  saved: boolean;
  /** Raw d20 roll. */
  roll: number;
  /** d20 + defender save bonus. */
  total: number;
  /** Difficulty class — `save_dc_base + caster casting-mod`. */
  dc: number;
  /** Defender's save-stat modifier. */
  bonus: number;
  /** Field name on the defender that was consulted, e.g. "intelligence". */
  saveStat: string;
}

/**
 * Roll a saving throw for `target` against `spell` cast by `caster`.
 *
 * Formula (matches the D&D-ish pattern the v1 game leaned on):
 *
 *   DC    = spell.action_params.save_dc_base + caster's casting-mod
 *   bonus = mod(target[save_dc_stat])
 *   total = d20 + bonus
 *   saved = total >= DC
 *
 * When `target` lacks the relevant ability score (legacy monsters
 * without v2 attributes), the bonus falls back to
 * `max(0, target.attackBonus - 2)` — the same heuristic
 * resolveTurnUndead used to compute saves with. Same for the
 * caster: missing attribute → +0 to the DC, no bonus from a
 * dimwit-cast spell.
 */
export function rollSpellSave(
  caster: Combatant,
  target: Combatant,
  spell: Spell,
  rng: RNG,
): SpellSaveResult {
  const ev = (spell.effect_value ?? {}) as Record<string, unknown>;
  const dcBase = typeof ev.save_dc_base === "number" ? (ev.save_dc_base as number) : 10;
  const casterStat = castingStatField(spell);
  const casterScore = caster[casterStat];
  const casterMod = typeof casterScore === "number" ? abilityMod(casterScore) : 0;
  const dc = dcBase + casterMod;

  const saveStat = saveStatField(spell);
  const targetScore = target[saveStat];
  const bonus =
    typeof targetScore === "number"
      ? abilityMod(targetScore)
      : Math.max(0, target.attackBonus - 2);

  const roll = 1 + Math.floor(rng() * 20);
  const total = roll + bonus;
  return {
    saved: total >= dc,
    roll,
    total,
    dc,
    bonus,
    saveStat,
  };
}

/**
 * Per-target outcome for Turn Undead — the scene needs both the dice
 * detail (for the log) and the resulting damage so it can flash/animate
 * the right combatant.
 */
export interface TurnUndeadOutcome {
  targetId: string;
  /** Raw d20. */
  saveRoll: number;
  /** d20 + saveBonus. */
  saveTotal: number;
  /** Computed difficulty class for this cast. */
  saveDc: number;
  /** False → failed the save; true → seared for hp_percent. */
  saved: boolean;
  /** Save bonus the target rolled with (WIS mod or legacy heuristic,
   *  plus turn_resistance). Carried so the scene's log line shows
   *  the real math instead of re-deriving it. */
  saveBonus: number;
  damage: number;
  killed: boolean;
  /** True when a failed save TURNED the creature instead of
   *  destroying it (elite undead with turn_resistance > 0). The
   *  creature flees/cowers for `turnedTurns` of its own turns. */
  turned: boolean;
  /** Number of turns the turned state lasts (1d4); 0 when not turned. */
  turnedTurns: number;
}

export interface TurnUndeadResult {
  /** Empty when there were no undead enemies on the field. */
  outcomes: TurnUndeadOutcome[];
  /** True iff the spell found at least one undead target. */
  hadTargets: boolean;
}

/**
 * Result of tracing a directional projectile (Magic Dart, Fireball-
 * direction) along a cardinal ray. Mirrors the Python game's
 * `_fire_fireball` ray walk:
 *
 *   - Step from origin in (dCol, dRow) up to `range` tiles.
 *   - Stop on the first wall (spell fizzles a tile short of the wall).
 *   - Stop on the first combatant (`hitId` is set; the caller decides
 *     friend or foe).
 *   - If nothing is in range, `fizzled` is true and `endCol/endRow`
 *     points to the last cell traversed.
 */
export interface DirectionalTrace {
  endCol: number;
  endRow: number;
  /** Combatant id of the first creature on the ray, or null. */
  hitId: string | null;
  /** True when the ray ran the full range without hitting anything. */
  fizzled: boolean;
}

/**
 * Walk one tile at a time from `origin` in `(dCol, dRow)` for up to
 * `range` steps. `isWallAt(c, r)` and `combatantAt(c, r)` are passed
 * in so this stays a pure function — the scene can wire it to the
 * arena helpers it already uses.
 */
export function traceDirectionalRay(
  origin: { col: number; row: number },
  delta: { dCol: number; dRow: number },
  range: number,
  isWallAt: (col: number, row: number) => boolean,
  combatantAt: (col: number, row: number) => Combatant | null,
): DirectionalTrace {
  let tc = origin.col + delta.dCol;
  let tr = origin.row + delta.dRow;
  let endCol = origin.col;
  let endRow = origin.row;
  for (let steps = 0; steps < range; steps++) {
    if (isWallAt(tc, tr)) {
      // Spell stops one tile short of the wall (stays on the last
      // open tile in the ray). If we hit a wall on the very first
      // step the ray didn't really travel — return the wall tile so
      // the projectile visual still has somewhere to land.
      return { endCol, endRow, hitId: null, fizzled: true };
    }
    const occ = combatantAt(tc, tr);
    if (occ) {
      return { endCol: tc, endRow: tr, hitId: occ.id, fizzled: false };
    }
    endCol = tc;
    endRow = tr;
    tc += delta.dCol;
    tr += delta.dRow;
  }
  // Ran out of range with nothing hit.
  return { endCol, endRow, hitId: null, fizzled: true };
}

export interface DirectionalPierceTrace {
  endCol: number;
  endRow: number;
  /** Ids of EVERY alive creature the ray passes through, in order from
   *  the caster outward. Empty when the bolt hits nothing. */
  hitIds: string[];
}

/**
 * Piercing variant of {@link traceDirectionalRay}: the bolt does NOT
 * stop at the first creature — it passes through every tile in the
 * cardinal line, collecting each alive combatant (friend or foe) it
 * crosses, and only halts at a wall / arena edge or the range cap.
 * Used by spells flagged `action_params.pierce` (Lightning Bolt), which
 * electrocute everything in their path. `endCol/endRow` is the last
 * open tile reached, so the projectile visual streaks the full line.
 */
export function traceDirectionalPierce(
  origin: { col: number; row: number },
  delta: { dCol: number; dRow: number },
  range: number,
  isWallAt: (col: number, row: number) => boolean,
  combatantAt: (col: number, row: number) => Combatant | null,
): DirectionalPierceTrace {
  let tc = origin.col + delta.dCol;
  let tr = origin.row + delta.dRow;
  let endCol = origin.col;
  let endRow = origin.row;
  const hitIds: string[] = [];
  for (let steps = 0; steps < range; steps++) {
    if (isWallAt(tc, tr)) break; // a wall / edge stops the bolt
    endCol = tc;
    endRow = tr;
    const occ = combatantAt(tc, tr);
    if (occ) hitIds.push(occ.id); // pass through — keep going
    tc += delta.dCol;
    tr += delta.dRow;
  }
  return { endCol, endRow, hitIds };
}

/**
 * Build a Combatant for a summoned skeleton from an Animate Dead-style
 * spell. Reads the `skeleton_*` keys out of `spell.effect_value` and
 * falls back to sensible Skeleton-monster defaults when fields are
 * missing — mirrors src/states/combat.py::_cast_animate_dead.
 *
 * `id` is the unique combat id (the scene generates it); `casterName`
 * is just used to flavour the combatant's display name. The position
 * comes from the tile picker and is stamped on by Combat.addCombatant
 * later, so we leave a placeholder here.
 */
export function makeSummonedSkeleton(
  spell: Spell,
  id: string,
  casterName: string,
): Combatant {
  // The summon spell now ships its creature stats under a nested
  // `creature` block (v2 schema) — { hp, ac, attack_bonus,
  // damage_dice, damage_sides, damage_bonus }. We also accept the
  // legacy flat `skeleton_*` shape so older saved data and tests
  // keep working until they're rewritten.
  const ev = (spell.effect_value ?? {}) as Record<string, unknown>;
  const creature =
    ev.creature && typeof ev.creature === "object"
      ? (ev.creature as Record<string, unknown>)
      : null;
  const pickNum = (newKey: string, legacyKey: string, dflt: number): number => {
    if (creature && typeof creature[newKey] === "number") {
      return creature[newKey] as number;
    }
    if (typeof ev[legacyKey] === "number") return ev[legacyKey] as number;
    return dflt;
  };
  // `creature.sprite` is the v2 hook so individual summon spells can
  // point at any monster art (skeleton, zombie, wolf, …) without
  // hard-coding the path in scene code. Falls back to the legacy
  // hand-drawn skeleton when omitted so older spell data still
  // renders.
  const spriteRef = creature && typeof creature.sprite === "string"
    ? creature.sprite
    : (typeof ev.sprite === "string" ? ev.sprite : undefined);
  return {
    id,
    name: `${casterName}'s Skeleton`,
    side: "party",
    maxHp:        pickNum("hp",            "skeleton_hp",       30),
    hp:           pickNum("hp",            "skeleton_hp",       30),
    ac:           pickNum("ac",            "skeleton_ac",       14),
    attackBonus:  pickNum("attack_bonus",  "skeleton_attack",    6),
    damage: {
      dice:  pickNum("damage_dice",  "skeleton_dmg_dice",  2),
      sides: pickNum("damage_sides", "skeleton_dmg_sides", 6),
      bonus: pickNum("damage_bonus", "skeleton_dmg_bonus", 3),
    },
    dexMod: 1,
    color: [200, 200, 180],
    sprite: resolveSummonSpriteUrl(spriteRef),
    baseMoveRange: 3,
    position: { col: 0, row: 0 }, // overwritten by Combat.addCombatant
    undead: true,
    aiControlled: true,
  };
}

/**
 * Turn Undead resolution — Cleric/Paladin holy blast. Invoked via
 * the v2 Abilities dispatcher (CombatScene's `Abilities` picker
 * routes ability id `turn_undead` here).
 *
 * Mirrors src/states/combat.py::_cast_turn_undead, with the elite-
 * undead extension:
 *   - Filters monsters to those flagged `undead: true` in the data.
 *   - Each undead rolls d20 + WIS mod (or the legacy
 *     max(0, attackBonus-2) heuristic) + `turn_resistance` vs
 *     save_dc (`save_dc_base + caster wisdom modifier`).
 *   - Failure, lesser undead (no turn_resistance) → HP set to 0
 *     (destroyed completely).
 *   - Failure, elite undead (turn_resistance > 0) → TURNED: takes
 *     hp_percent damage and flees/cowers for 1d4 of its own turns
 *     (`turnedTurns` on the combatant; the AI + endTurn handle it).
 *   - Success → max(1, floor(maxHp * hp_percent)) damage.
 *
 * `params` is the ability's raw config bag (`abilities.json`
 * `params`), read for `hp_percent`, `save_dc_base`, `save_dc_stat`.
 * Each falls back to sensible defaults so an ability authored with
 * a partial bag still resolves. Returns per-target dice + damage
 * so the scene can log and animate. `casterWisMod` lets the caller
 * pre-compute the modifier from PartyMember's wisdom score (or
 * pass 0 for monster casters).
 */
export function resolveTurnUndead(
  enemies: Combatant[],
  params: Record<string, unknown> | null | undefined,
  casterWisMod: number,
  rng: RNG,
): TurnUndeadResult {
  const ev = (params ?? {}) as Record<string, unknown>;
  const hpPct = typeof ev.hp_percent === "number" ? (ev.hp_percent as number) : 0.5;
  const dcBase = typeof ev.save_dc_base === "number" ? (ev.save_dc_base as number) : 10;
  const dcStat = typeof ev.save_dc_stat === "string" ? (ev.save_dc_stat as string) : "wisdom";

  const undeadTargets = enemies.filter((m) => m.hp > 0 && m.undead);
  if (undeadTargets.length === 0) {
    return { outcomes: [], hadTargets: false };
  }

  // Default to Wisdom — the data only ships wisdom/intelligence today.
  const saveDc = dcBase + (dcStat === "intelligence" ? 0 : casterWisMod);

  const outcomes: TurnUndeadOutcome[] = [];
  for (const t of undeadTargets) {
    const saveRoll = Math.floor(rng() * 20) + 1;
    // Real WIS-mod when the monster has the new attribute block;
    // legacy "max(0, attackBonus - 2)" heuristic when it doesn't,
    // so v1-data monsters still resolve cleanly. Elite undead add
    // their `turn_resistance` on top (vampire +4, lich +6, …) so
    // high-tier undead usually shrug the holy blast off.
    const wisScore =
      dcStat === "intelligence" ? t.intelligence : t.wisdom;
    const resistance = Math.max(0, t.turnResistance ?? 0);
    const saveBonus =
      (typeof wisScore === "number"
        ? abilityMod(wisScore)
        : Math.max(0, t.attackBonus - 2)) + resistance;
    const saveTotal = saveRoll + saveBonus;
    if (saveTotal < saveDc) {
      if (resistance > 0) {
        // Elite undead are too powerful to destroy outright. A
        // failed save TURNS them instead: they take the same
        // hp_percent searing a successful save would, and flee /
        // cower for 1d4 of their own turns (Combat's AI reads
        // `turnedTurns`; endTurn ticks it down).
        const damage = Math.max(1, Math.floor(t.maxHp * hpPct));
        t.hp = Math.max(0, t.hp - damage);
        const turnedTurns = Math.floor(rng() * 4) + 1;
        if (t.hp > 0) t.turnedTurns = turnedTurns;
        outcomes.push({
          targetId: t.id, saveRoll, saveTotal, saveDc, saveBonus,
          saved: false, damage, killed: t.hp === 0,
          turned: t.hp > 0, turnedTurns: t.hp > 0 ? turnedTurns : 0,
        });
      } else {
        const damage = t.hp;
        t.hp = 0;
        outcomes.push({
          targetId: t.id, saveRoll, saveTotal, saveDc, saveBonus,
          saved: false, damage, killed: true,
          turned: false, turnedTurns: 0,
        });
      }
    } else {
      const damage = Math.max(1, Math.floor(t.maxHp * hpPct));
      t.hp = Math.max(0, t.hp - damage);
      outcomes.push({
        targetId: t.id, saveRoll, saveTotal, saveDc, saveBonus,
        saved: true, damage, killed: t.hp === 0,
        turned: false, turnedTurns: 0,
      });
    }
  }
  return { outcomes, hadTargets: true };
}

// ── Combat-usable consumables (Healing Potion, Antidote, Fire Oil…) ──
//
// Mirrors src/states/combat.py::_apply_use_item — same effect tags,
// same dice rolls, same "drink ends the turn" cadence. Pure helper:
// mutates the caster's hp / member's mp / enemy hp in place, returns a
// result the scene logs and animates. Item consumption (splice from
// personal or shared stash) stays in the scene, mirroring how the
// Throw action works — that way the rest of this file stays free of
// inventory bookkeeping.

/** Per-enemy damage outcome for a `combat_only` mass-damage item. */
export interface UseItemEnemyHit {
  id: string;
  damage: number;
  killed: boolean;
}

export interface UseItemOutcome {
  /** `false` when the item is unusable (no effect, not combat-usable),
   *  the relevant resource is already topped up, or the supporting
   *  member data is missing for an MP heal. The scene re-uses the
   *  message either way; on `false` it should NOT consume the item. */
  ok: boolean;
  /** The item's `effect` tag, echoed back so the scene can pick a VFX. */
  effect: string;
  message: string;
  /** HP or MP restored on the caster (`heal_hp` / `heal_mp`). */
  amount?: number;
  /** Per-enemy damage outcomes for `combat_only` (Fire Oil etc.). */
  enemyHits?: UseItemEnemyHit[];
  /** Whether the item use should advance the turn. True for every
   *  successful use; false on refusal so the player can pick something
   *  else without forfeiting their turn. */
  endsTurn: boolean;
}

/**
 * Optional hooks the scene wires up so this pure helper can stage
 * combat buffs without depending on the `Combat` controller. Tests
 * can pass stubs that record the calls; the real call site forwards
 * to `combat.addBuff` / `combat.hasBuffFromSource`.
 *
 * Both are optional: when omitted, the buff branches refuse politely
 * just like they did before the buff system landed (so anyone calling
 * `useCombatItem` from a non-combat path still gets sane behaviour).
 */
export interface UseItemBuffHooks {
  addBuff(combatantId: string, buff: Buff): void;
  /** True when a buff with this `source` (item name) is already active
   *  on the combatant — used to refuse a second Elixir of Strength
   *  rather than letting them stack indefinitely. */
  hasBuffFromSource(combatantId: string, source: string): boolean;
}

/**
 * Apply a usable item's effect during combat. The CombatScene calls
 * this after the player has picked an item from the Use picker.
 *
 *   - `caster`: the active Combatant (mutated for HP heals).
 *   - `member`: the matching PartyMember row (needed for `heal_mp` —
 *     Combatants don't carry an MP pool). Nullable so monster summons
 *     and AI-controlled allies can still call this for HP heals; an
 *     `heal_mp` on a null member refuses politely.
 *   - `enemies`: alive + dead enemy combatants for `combat_only`
 *     throws; dead targets are filtered out before damage rolls.
 *   - `item`: the catalog entry (must satisfy `isCombatUsable`).
 *   - `rng`: injected RNG so tests can pin outcomes.
 *   - `buffs`: optional buff hooks for Elixir-style consumables.
 *     Without them the strength/ac branches still refuse politely.
 */
export function useCombatItem(
  caster: Combatant,
  member: PartyMember | null,
  enemies: Combatant[],
  item: Item,
  rng: RNG,
  buffs?: UseItemBuffHooks,
): UseItemOutcome {
  // Defense in depth: the picker filters by `isCombatUsable` already,
  // but a stale picker entry or a future caller might still pass an
  // item that shouldn't apply. Refuse cleanly instead of trusting the
  // call site.
  if (!isCombatUsable(item)) {
    return {
      ok: false,
      effect: item.effect ?? "",
      message: `${item.name} can't be used in combat.`,
      endsTurn: false,
    };
  }
  const effect = item.effect ?? "";
  const power = item.power ?? 0;

  switch (effect) {
    case "heal_hp": {
      if (caster.hp >= caster.maxHp) {
        return {
          ok: false,
          effect,
          message: `${caster.name} is already at full HP.`,
          endsTurn: false,
        };
      }
      // Mirrors Python: heal = power + 1d6, clamp to maxHp.
      const dice = rollDamage(1, 6, 0, false, rng);
      const heal = Math.max(1, power + dice);
      const before = caster.hp;
      caster.hp = Math.min(caster.maxHp, caster.hp + heal);
      const actual = caster.hp - before;
      return {
        ok: true,
        effect,
        amount: actual,
        message: `${caster.name} uses ${item.name}! (+${actual} HP)`,
        endsTurn: true,
      };
    }
    case "heal_mp": {
      if (!member || member.max_mp <= 0) {
        return {
          ok: false,
          effect,
          message: `${caster.name} has no magic to restore.`,
          endsTurn: false,
        };
      }
      const cur = member.mp;
      if (cur >= member.max_mp) {
        return {
          ok: false,
          effect,
          message: `${caster.name}'s magic reserves are already full.`,
          endsTurn: false,
        };
      }
      // Python: restore = power + 1d4.
      const dice = rollDamage(1, 4, 0, false, rng);
      const restore = Math.max(1, power + dice);
      const next = Math.min(member.max_mp, cur + restore);
      const actual = next - cur;
      member.mp = next;
      return {
        ok: true,
        effect,
        amount: actual,
        message: `${caster.name} uses ${item.name}! (+${actual} MP)`,
        endsTurn: true,
      };
    }
    case "cure_poison": {
      // Poison status isn't modelled on Combatant in the web port yet
      // (mirroring the gap on PartyMember). Refuse without consuming
      // the item so the player isn't billed for a no-op. When the
      // status engine lands this branch can scan + clear flags.
      return {
        ok: false,
        effect,
        message: `${caster.name} isn't poisoned.`,
        endsTurn: false,
      };
    }
    case "buff_strength": {
      // Elixir of Strength: bumps STR for the rest of combat, which
      // in the Python game feeds both attack-bonus and damage. We
      // model that as two parallel buff entries — `attack_bonus` so
      // the d20 hit roll picks it up, and `damage_bonus` so the
      // post-dice total also gets the swing. `power` is the per-
      // potion magnitude from items.json (default 2).
      if (!buffs) {
        return {
          ok: false,
          effect,
          message: `${item.name} can't be applied right now.`,
          endsTurn: false,
        };
      }
      if (buffs.hasBuffFromSource(caster.id, item.name)) {
        return {
          ok: false,
          effect,
          message: `${caster.name} is already feeling the surge from ${item.name}.`,
          endsTurn: false,
        };
      }
      const value = power > 0 ? power : 2;
      // Long turnsLeft so the buff stays for the rest of the
      // encounter — the Python `potion_buffs` dict has no expiry,
      // and we wipe combatant buffs at encounter end anyway.
      const turnsLeft = 99;
      buffs.addBuff(caster.id, {
        kind: "attack_bonus", value, turnsLeft, source: item.name,
      });
      buffs.addBuff(caster.id, {
        kind: "damage_bonus", value, turnsLeft, source: item.name,
      });
      return {
        ok: true,
        effect,
        amount: value,
        message: `${caster.name} drinks ${item.name}! (+${value} STR)`,
        endsTurn: true,
      };
    }
    case "buff_ac": {
      // Elixir of Warding: AC bonus for the rest of the encounter.
      if (!buffs) {
        return {
          ok: false,
          effect,
          message: `${item.name} can't be applied right now.`,
          endsTurn: false,
        };
      }
      if (buffs.hasBuffFromSource(caster.id, item.name)) {
        return {
          ok: false,
          effect,
          message: `${caster.name} is already shielded by ${item.name}.`,
          endsTurn: false,
        };
      }
      const value = power > 0 ? power : 2;
      buffs.addBuff(caster.id, {
        kind: "ac_bonus", value, turnsLeft: 99, source: item.name,
      });
      return {
        ok: true,
        effect,
        amount: value,
        message: `${caster.name} drinks ${item.name}! (+${value} AC)`,
        endsTurn: true,
      };
    }
    case "combat_only": {
      // Throwables like Fire Oil — splash damage to every alive enemy.
      // Mirrors Python: each target takes `power + 1d6`, capped at 0.
      const alive = enemies.filter((e) => e.hp > 0);
      if (alive.length === 0) {
        return {
          ok: false,
          effect,
          message: `No enemies left to target with ${item.name}.`,
          endsTurn: false,
        };
      }
      const hits: UseItemEnemyHit[] = [];
      let total = 0;
      for (const e of alive) {
        const dice = rollDamage(1, 6, 0, false, rng);
        const dmg = Math.max(1, power + dice);
        const before = e.hp;
        e.hp = Math.max(0, e.hp - dmg);
        const dealt = before - e.hp;
        total += dealt;
        hits.push({ id: e.id, damage: dealt, killed: e.hp === 0 });
      }
      return {
        ok: true,
        effect,
        message: `${caster.name} hurls ${item.name}! Splash damage hits everyone! (${total} total)`,
        enemyHits: hits,
        endsTurn: true,
      };
    }
    default: {
      // Unknown effect tag — consume the item but log generically so a
      // future items.json entry doesn't crash combat.
      return {
        ok: true,
        effect,
        message: `${caster.name} uses ${item.name}.`,
        endsTurn: true,
      };
    }
  }
}
