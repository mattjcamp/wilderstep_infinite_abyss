/**
 * Shared combat-stat math — port of v1's CombatBridge so the battle
 * controller and the CharacterSheetSim preview agree on the numbers.
 *
 *   AC          = 10 + DEX_mod + floor((armor.evasion - 50) / 2) + Σ ac_bonus
 *   atk bonus   = STR_mod (melee) or DEX_mod (ranged)
 *   damage      = power-tier dice + statMod (Club power 1 → 1d4 + STR − 1)
 *
 * Pure, no React/Phaser deps. Hosts that need different formulas can
 * skip this module entirely.
 */

import type { PartyCharacterRef } from "./PartyScreen";
import type { SheetItemRef } from "./CharacterSheetSim";

export function abilityMod(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

export interface DerivedCombatStats {
  ac: number;
  attackBonus: number;
  damage: { dice: number; sides: number; bonus: number };
  weaponName: string | null;
}

export function combatStatsFor(
  m: PartyCharacterRef,
  itemById: ReadonlyMap<string, SheetItemRef>,
): DerivedCombatStats {
  const equipped = (m.equipped ?? {}) as Record<string, string>;
  const handsId = equipped.hands;
  const bodyId = equipped.body;
  const weapon =
    handsId && itemById.get(handsId)?.category === "weapons"
      ? itemById.get(handsId) ?? null
      : null;
  const body = bodyId ? itemById.get(bodyId) ?? null : null;
  const dex = m.dexterity ?? 10;
  const dexMod = abilityMod(dex);
  const evasion = body && typeof body.evasion === "number" ? body.evasion : 50;
  // /2 (was /5) so the evasion field's authored range (50–67) maps
  // to a meaningful AC spread (0–8) instead of collapsing every
  // armor into a +0/+1/+2/+3 bucket. Must stay in lockstep with
  // the engine-side formula in `web/src/battle/combat/CombatBridge.ts`
  // — the Party screen's at-a-glance AC and the combat math both
  // read this function.
  const armorBonus = Math.floor((evasion - 50) / 2);
  let acBonus = 0;
  for (const slotId of Object.values(equipped)) {
    const it = slotId ? itemById.get(slotId) ?? null : null;
    if (it?.ac_bonus) acBonus += it.ac_bonus;
  }
  const ac = 10 + dexMod + armorBonus + acBonus;
  const isRanged = !!weapon?.ranged;
  const stat = isRanged ? m.dexterity ?? 10 : m.strength ?? 10;
  const statMod = abilityMod(stat);
  const damage = damageForWeapon(weapon, statMod);
  return { ac, attackBonus: statMod, damage, weaponName: weapon?.name ?? null };
}

export function damageForWeapon(
  weapon: SheetItemRef | null,
  statMod: number,
): { dice: number; sides: number; bonus: number } {
  // Must stay in lockstep with the engine-side ladder in
  // `web/src/battle/combat/CombatBridge.ts`. The original ladder
  // capped at 1d10 for any power >= 9, which made Sun Sword
  // (power 20) look identical on the sheet to a Halberd (power 9).
  // The extended tiers (1d12 / 2d6 / 2d8) make legendary weapons
  // visibly better in the at-a-glance damage column.
  if (!weapon || typeof weapon.power !== "number") {
    return { dice: 0, sides: 0, bonus: 1 };
  }
  const wp = weapon.power;
  if (wp <= 0)  return { dice: 0, sides: 0, bonus: 1 };
  if (wp === 1) return { dice: 1, sides: 4, bonus: statMod - 1 };
  if (wp <= 3)  return { dice: 1, sides: 4, bonus: statMod };
  if (wp <= 5)  return { dice: 1, sides: 6, bonus: statMod };
  if (wp <= 8)  return { dice: 1, sides: 8, bonus: statMod };
  if (wp <= 11) return { dice: 1, sides: 10, bonus: statMod };
  if (wp <= 14) return { dice: 1, sides: 12, bonus: statMod };
  if (wp <= 19) return { dice: 2, sides: 6, bonus: statMod };
  return         { dice: 2, sides: 8, bonus: statMod };
}
