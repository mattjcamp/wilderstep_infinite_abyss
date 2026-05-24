/**
 * Bridge from `PartyMember` (the data model used by the Party screen
 * + save/load) to `Combatant` (the data model the combat engine
 * runs on). The combat layer was originally fed a hand-built sample
 * party; this lets it instead read the real roster from
 * `data/party.json` so encounters use whoever the player actually
 * has — with their actual level, equipped weapon, HP/MP, sprite.
 *
 * Stat derivation is deliberately simple — it covers what combat
 * needs today (hit / damage / AC / initiative) without trying to
 * replicate every tweak the Python game's class tables apply. Once
 * we port the class JSON files we can layer richer maths on top.
 */

import type { Combatant, DamageRoll } from "../types";
import type { MonsterPassive } from "../data/monsters";
import type { PartyMember, Party, EquipmentSlots } from "../world/Party";
import type { Item } from "../world/Items";
import type { ClassTemplate } from "../world/Classes";
import { activeMembers } from "../world/Party";

/** Map a `wielder_passives` id (declared on an item) to the
 *  monster-side passive shape the combat engine already consumes.
 *  Returns null for unknown ids — that lets a future Item carry a
 *  passive the engine hasn't taught itself to honour yet without
 *  hard-failing the equip flow. Today the engine understands:
 *
 *   - `"fire_resistance"`: halves fire-typed spell damage (see
 *     `Combat.rollMonsterSpellDamage` → `hasPassive`).
 *   - `"poison_immunity"`: reserved; engine reads the flag but the
 *     poison branch isn't wired yet.
 *
 *  `"regen"` is intentionally absent — it carries an `amount`
 *  parameter that the data model doesn't yet let an item declare
 *  through `wielder_passives` (the field is a flat string[]). When
 *  we want item-driven regen, this map will grow to honour an
 *  object form like `{ id: "regen", amount: 2 }`.
 */
function passiveFromWielderId(id: string): MonsterPassive | null {
  if (id === "fire_resistance") return { type: "fire_resistance" };
  if (id === "poison_immunity") return { type: "poison_immunity" };
  return null;
}

/** Collect every passive an item's `wielder_passives` declares
 *  across the supplied slots, dedupe by `type`, and return them in
 *  the shape `Combatant.passives` expects. Pure: takes the equipped
 *  map + items catalog by reference, returns a fresh array. Returns
 *  `undefined` (not `[]`) when nothing applies so the assignment in
 *  `combatantFromMember` leaves the field absent for ordinary gear —
 *  the engine treats absent and empty identically, but absence keeps
 *  the snapshot tight in debugger views. */
function collectWielderPassives(
  equipped: EquipmentSlots,
  items: Map<string, Item>,
): MonsterPassive[] | undefined {
  const seen = new Set<MonsterPassive["type"]>();
  const out: MonsterPassive[] = [];
  const slots: Array<keyof EquipmentSlots> = ["hands", "body"];
  for (const slot of slots) {
    const id = equipped[slot];
    if (!id) continue;
    const it = items.get(id);
    const declared = it?.wielder_passives;
    if (!Array.isArray(declared)) continue;
    for (const passiveId of declared) {
      const p = passiveFromWielderId(passiveId);
      if (!p) continue;
      if (seen.has(p.type)) continue;
      seen.add(p.type);
      out.push(p);
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Fall-back tile movement budget when no class template is available
 *  (tests that don't pass a classes map, or a class file failed to
 *  load). Picked to match the prior hardcoded value so callers that
 *  don't opt in see no behaviour change. */
const DEFAULT_MOVE_RANGE = 4;

/** D&D-style modifier (10 = 0, 18 = +4, 8 = -1, …). */
export function abilityMod(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

/** Internal alias kept short for the bridge's existing callers. */
function mod(stat: number): number { return abilityMod(stat); }

/**
 * Sum the `ac_bonus` field across every equipped item the member is
 * currently wearing. Mundane gear has no `ac_bonus`, so this is a
 * no-op for the starter party — the field is honoured for magic
 * gear (Mystic Sword, Sun Sword, Bracers of Defence, etc.).
 */
function totalAcBonus(equipped: EquipmentSlots, items: Map<string, Item>): number {
  let total = 0;
  const slots: Array<keyof EquipmentSlots> = ["hands", "body"];
  for (const slot of slots) {
    const name = equipped[slot];
    if (!name) continue;
    const it = items.get(name);
    if (it?.ac_bonus) total += it.ac_bonus;
  }
  return total;
}

/**
 * Power-tier damage dice — direct port of `Member.get_damage_dice()`
 * in `src/party.py:956`. Power tier sets the die size; the wielder's
 * STR mod (or DEX mod for ranged weapons) is added as a bonus, and
 * power-1 weapons get an extra `-1` to round to roughly d3.
 */
function damageForWeapon(member: PartyMember, weapon: Item | null): DamageRoll {
  if (!weapon || typeof weapon.power !== "number") {
    // Bare fists / no weapon — flat 1 damage, matches Python's `power 0` path.
    return { dice: 0, sides: 0, bonus: 1 };
  }
  // Python keys off only `ranged` (a bow / sling / crossbow) — a
  // throwable melee weapon (Dagger) defaults to STR until the player
  // explicitly throws it. Matches `Member.get_damage_dice` at
  // `src/party.py:973`.
  const isRanged = !!weapon.ranged;
  const statMod = isRanged ? mod(member.dexterity) : mod(member.strength);
  const wp = weapon.power;
  if (wp <= 0) return { dice: 0, sides: 0, bonus: 1 };
  if (wp === 1) return { dice: 1, sides: 4, bonus: statMod - 1 };
  if (wp <= 3)  return { dice: 1, sides: 4, bonus: statMod };
  if (wp <= 5)  return { dice: 1, sides: 6, bonus: statMod };
  if (wp <= 8)  return { dice: 1, sides: 8, bonus: statMod };
  return         { dice: 1, sides: 10, bonus: statMod };
}

/**
 * Derived combat stats from a PartyMember's current gear — AC, the
 * to-hit bonus, the damage roll, plus the equipped weapon name so
 * the character sheet can show "Damage 1d6 +4 (Sword)" rather than
 * a context-free "1d6 +4". Pure: depends only on the member + the
 * items catalog.
 *
 *   AC          = 10 + DEX_mod + (armor_evasion - 50)/5 + Σ acBonus
 *   atk bonus   = STR_mod (melee) or DEX_mod (ranged/thrown)
 *   damage      = power-tier dice + STR_mod (or DEX_mod for ranged)
 *
 * Used by `combatantFromMember` when staging a fight, and by the
 * Party screen so the player can see at a glance how their numbers
 * change when they swap gear.
 */
export interface CombatStats {
  ac: number;
  attackBonus: number;
  damage: DamageRoll;
  /** Equipped weapon name, or `null` if both hands are empty. Surfaced
   *  so the character sheet can render "1d6 +4 (Sword)". */
  weaponName: string | null;
  /** DEX modifier — handy for displaying alongside AC and as a
   *  cheap shortcut for `mod(member.dexterity)` for callers that
   *  already have the stats object. */
  dexMod: number;
}

export function combatStatsFor(
  member: PartyMember,
  items: Map<string, Item>,
): CombatStats {
  const weapon = member.equipped.hands
    ? items.get(member.equipped.hands) ?? null
    : null;
  const armor = member.equipped.body
    ? items.get(member.equipped.body) ?? null
    : null;
  const dexMod = mod(member.dexterity);
  const evasion = armor && typeof armor.evasion === "number" ? armor.evasion : 50;
  const armorBonus = Math.floor((evasion - 50) / 5);
  const ac = 10 + dexMod + armorBonus + totalAcBonus(member.equipped, items);
  const isRanged = !!(weapon && weapon.ranged);
  const attackBonus = isRanged ? dexMod : mod(member.strength);
  const damage = damageForWeapon(member, weapon);
  return {
    ac,
    attackBonus,
    damage,
    weaponName: weapon ? weapon.name : null,
    dexMod,
  };
}

/**
 * Derive combat stats from a PartyMember + the catalog of items.
 * Mirrors `Member.get_ac()`, `Member.get_attack_bonus()`, and
 * `Member.get_damage_dice()` from `src/party.py`. Wraps
 * `combatStatsFor` for the gear math and stamps in HP / sprite /
 * ability scores / move range so the result is a full Combatant.
 *
 * The full ability block also rides along on the Combatant so spell
 * damage helpers can read INT (Magic Arrow) and WIS (Heal) without
 * having to re-look-up the underlying PartyMember.
 *
 * - HP / maxHP: from the member directly so HP carries between
 *   encounters when combat finishes.
 * - move range: from the member's class template (Wizards 2,
 *   Fighters 4, Thieves 6 in the shipped data). Falls back to 4 when
 *   `classes` isn't supplied or the class file failed to load.
 */
export function combatantFromMember(
  member: PartyMember,
  items: Map<string, Item>,
  classes?: Map<string, ClassTemplate>,
): Combatant {
  const stats = combatStatsFor(member, items);
  const tpl = classes?.get(member.class.toLowerCase());
  const baseMoveRange = tpl ? tpl.range : DEFAULT_MOVE_RANGE;
  // Pull the magic-item bonus damage / damage type straight from the
  // equipped weapon. Mirrors the Python game's `bonus_damage` +
  // `damage_type` read inside `_apply_weapon_damage`. Sun Sword shows
  // up here as `{ weaponBonusDamage: "1d6", weaponDamageType: "fire" }`.
  const equippedWeapon = member.equipped.hands
    ? items.get(member.equipped.hands) ?? null
    : null;
  // Magic-gear passives — Sun Sword's `wielder_passives: ["fire_resistance"]`
  // turns into a real `passives: [{ type: "fire_resistance" }]` entry
  // on the Combatant here, which the combat engine's existing
  // `hasPassive` check picks up when the dragon breathes fire.
  // Walks BOTH equipped slots so future passive-granting armor
  // (Bracers of Poison Immunity, etc.) folds in automatically.
  const wielderPassives = collectWielderPassives(member.equipped, items);
  // Relic-tier render hint — drives the persistent gold halo around
  // the wielder in CombatScene. Absent for mundane weapons; only
  // populated when the equipped weapon declares a `combat_aura` block.
  const wieldAuraColor =
    typeof equippedWeapon?.combat_aura?.color === "number"
      ? equippedWeapon.combat_aura.color
      : undefined;
  return {
    id: `pm:${member.id}`,
    name: member.name,
    side: "party",
    maxHp: member.max_hp,
    hp: member.hp,
    ac: stats.ac,
    attackBonus: stats.attackBonus,
    damage: stats.damage,
    dexMod: stats.dexMod,
    strength: member.strength,
    dexterity: member.dexterity,
    constitution: member.constitution,
    intelligence: member.intelligence,
    wisdom: member.wisdom,
    color: [200, 200, 200],
    sprite: member.sprite,
    baseMoveRange,
    position: { col: 0, row: 0 },
    // Class-ability inputs — Backstab reads class + level + weapon,
    // Shadow Step reads class + level. Stamped here so the Combat
    // engine doesn't have to reach back into the PartyMember.
    charClass: member.class,
    race: member.race,
    level: member.level,
    weaponName: stats.weaponName,
    weaponBonusDamage: equippedWeapon?.bonus_damage,
    weaponDamageType: equippedWeapon?.damage_type,
    passives: wielderPassives,
    wieldAuraColor,
  };
}

/** Convert the active four PartyMembers into Combatants for the
 *  combat engine. Pass `classes` (lowercased class name → template)
 *  to honour per-class movement ranges; without it everyone defaults
 *  to the legacy 4-tile budget. */
export function combatantsFromParty(
  party: Party,
  items: Map<string, Item>,
  classes?: Map<string, ClassTemplate>,
): Combatant[] {
  return activeMembers(party).map((m) => combatantFromMember(m, items, classes));
}

/**
 * Recompute the gear-derived fields on an existing Combatant — `ac`,
 * `attackBonus`, `damage` — using the live `member.equipped` and the
 * items catalog. Used when a party member equips or unequips a slot
 * mid-combat so their next attack uses the new weapon/armor stats.
 *
 * Deliberately narrow: HP, position, sprite, buffs, summons, undead
 * flag, and every other non-gear field are left untouched. Stamping
 * the result onto the existing Combatant via Object.assign would
 * stomp those — this helper writes only the four gear fields.
 */
export function refreshCombatantGear(
  c: Combatant,
  member: PartyMember,
  items: Map<string, Item>,
): void {
  const weapon = member.equipped.hands
    ? items.get(member.equipped.hands) ?? null
    : null;
  const armor = member.equipped.body
    ? items.get(member.equipped.body) ?? null
    : null;
  const dexMod = mod(member.dexterity);
  const evasion = armor && typeof armor.evasion === "number" ? armor.evasion : 50;
  const armorBonus = Math.floor((evasion - 50) / 5);
  c.ac = 10 + dexMod + armorBonus + totalAcBonus(member.equipped, items);
  const isRanged = !!(weapon && weapon.ranged);
  c.attackBonus = isRanged ? dexMod : mod(member.strength);
  c.dexMod = dexMod;
  c.damage = damageForWeapon(member, weapon);
  // Keep weaponName in sync so the Backstab gate sees the new weapon
  // after a mid-combat swap (Thief draws a dagger for a stab, then
  // swaps back to a sword — each attack honours the current pick).
  c.weaponName = weapon ? weapon.name : null;
  // Refresh magic-item bonus damage + type — equipping Sun Sword
  // mid-fight should immediately add its 1d6 fire to subsequent
  // swings (and dropping back to a Sword should stop it).
  c.weaponBonusDamage = weapon?.bonus_damage;
  c.weaponDamageType = weapon?.damage_type;
  // Refresh magic-item passives + aura — sheathing the Sun Sword
  // drops fire_resistance on the next round, drawing it again
  // restores it. The CombatScene watches `wieldAuraColor` to add
  // or destroy the persistent halo so the visual matches the
  // mechanical state.
  c.passives = collectWielderPassives(member.equipped, items);
  c.wieldAuraColor =
    typeof weapon?.combat_aura?.color === "number"
      ? weapon.combat_aura.color
      : undefined;
}

/**
 * Write combat HP back into the party data after the encounter
 * resolves. The combat layer mutates Combatant.hp during the fight;
 * this propagates the result so HP carries across the overworld.
 */
export function syncCombatHpBack(
  party: Party,
  combatants: Combatant[],
): void {
  const byName = new Map(combatants.filter((c) => c.side === "party")
                                   .map((c) => [c.name, c]));
  for (const m of party.roster) {
    const c = byName.get(m.name);
    if (c) m.hp = c.hp;
  }
}
