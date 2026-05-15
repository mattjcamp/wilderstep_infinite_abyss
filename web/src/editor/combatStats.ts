/**
 * Shared combat-stat math — port of v1's CombatBridge so the battle
 * controller and the CharacterSheetSim preview agree on the numbers.
 *
 *   AC          = 10 + DEX_mod + floor((armor.evasion - 50) / 5) + Σ ac_bonus
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
  const armorBonus = Math.floor((evasion - 50) / 5);
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
  if (!weapon || typeof weapon.power !== "number") {
    return { dice: 0, sides: 0, bonus: 1 };
  }
  const wp = weapon.power;
  if (wp <= 0) return { dice: 0, sides: 0, bonus: 1 };
  if (wp === 1) return { dice: 1, sides: 4, bonus: statMod - 1 };
  if (wp <= 3) return { dice: 1, sides: 4, bonus: statMod };
  if (wp <= 5) return { dice: 1, sides: 6, bonus: statMod };
  if (wp <= 8) return { dice: 1, sides: 8, bonus: statMod };
  return { dice: 1, sides: 10, bonus: statMod };
}
