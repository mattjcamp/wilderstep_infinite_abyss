/**
 * Human-readable item stat derivations — turn the abstract authoring
 * fields (`power`, `evasion`) into the stats the game actually uses,
 * so the editor and manual can show "Base Damage 2d8" / "Base AC 15"
 * instead of "Power 20" / "Evasion 60" (which players don't intuit).
 *
 * These are the single source of truth for the *display* mapping.
 * They mirror the combat math:
 *   - weapon damage tiers  → `damageForWeapon` in battle/combat/CombatBridge.ts
 *   - ranged shot damage   → `resolveThrow` in battle/combat/CombatActions.ts
 *   - armor AC             → `combatStatsFor` in battle/combat/CombatBridge.ts
 * If those formulas change, update here too (and `build_items.py`, the
 * Python twin used by the manual generator).
 *
 * "Base" deliberately excludes the character's STR/DEX modifier — that
 * varies per wielder, so it isn't an intrinsic property of the item.
 * The weapon's magic `bonus_damage` is also kept separate (it has its
 * own column), so Base Damage is purely the weapon's own dice.
 */

/** Minimal shape these helpers read. Accepts any item-like record. */
export interface ItemStatLike {
  category?: string;
  power?: number;
  ranged?: boolean;
  evasion?: number;
  ac_bonus?: number;
}

/**
 * The weapon's base damage dice as a string ("1d8", "2d8", "1d6+9").
 * Empty string for non-weapons.
 *
 * Melee weapons map `power` onto a rising dice ladder (matches
 * `damageForWeapon`). Ranged weapons fire `1d6 + power` (matches
 * `resolveThrow`), so their base reads as e.g. "1d6+9". `power` 0
 * (fists) is a flat 1.
 */
export function baseDamageLabel(item: ItemStatLike): string {
  if (item.category !== "weapons") return "";
  const p = typeof item.power === "number" ? item.power : 0;
  if (item.ranged) {
    return p > 0 ? `1d6+${p}` : "1d6";
  }
  if (p <= 0) return "1";
  if (p === 1) return "1d4-1";
  if (p <= 3) return "1d4";
  if (p <= 5) return "1d6";
  if (p <= 8) return "1d8";
  if (p <= 11) return "1d10";
  if (p <= 14) return "1d12";
  if (p <= 19) return "2d6";
  return "2d8";
}

/**
 * The armor's base Armor Class as a string — the AC a typical
 * 10-DEX wearer has in it: `10 + floor((evasion - 50) / 2) + ac_bonus`.
 * Empty string for non-armor. Matches the `combatStatsFor` AC formula
 * with the DEX modifier set to 0.
 */
export function baseAcLabel(item: ItemStatLike): string {
  if (item.category !== "armors") return "";
  const evasion = typeof item.evasion === "number" ? item.evasion : 50;
  const acBonus = typeof item.ac_bonus === "number" ? item.ac_bonus : 0;
  const ac = 10 + Math.floor((evasion - 50) / 2) + acBonus;
  return String(ac);
}
