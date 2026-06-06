/**
 * Elemental ranged weapons (Stormbolt Crossbow & friends).
 *
 * Two rules under test:
 *   1. A weapon's magic `bonus_damage` (e.g. the crossbow's lightning
 *      1d6) fires on the RANGED shot — resolveThrow rolls it on top of
 *      the base projectile damage and surfaces it on the result.
 *   2. That same bonus does NOT fire on a melee bump: the engine's
 *      `attack()` skips `weaponBonusDamage` when the equipped weapon is
 *      ranged (`weaponRanged: true`). Melee weapons keep their bonus.
 */

import { describe, it, expect } from "vitest";
import { Combat } from "./Combat";
import { resolveThrow } from "./CombatActions";
import { combatantFromMember } from "./CombatBridge";
import { mulberry32 } from "../rng";
import type { Combatant } from "../types";
import type { PartyMember } from "../world/Party";
import type { Item } from "../world/Items";

// ── resolveThrow: ranged bonus damage ────────────────────────────────

describe("resolveThrow — magic bonus_damage on the shot", () => {
  /** Deterministic RNG: first call yields the wanted d20 face, every
   *  later call ~1 so all damage dice roll their max. Mirrors the
   *  improvised-melee test's helper. */
  function rng(d20: number) {
    let first = true;
    return () => {
      if (first) {
        first = false;
        return (d20 - 0.5) / 20;
      }
      return 0.999;
    };
  }

  function attacker(): Combatant {
    return {
      id: "a", name: "Archer", side: "party", sprite: "",
      hp: 10, maxHp: 10, ac: 12, attackBonus: 0, dexMod: 0,
      damage: { dice: 1, sides: 4, bonus: 0 },
      position: { col: 0, row: 0 },
      strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10,
      moveRange: 4, weaponName: null,
    } as unknown as Combatant;
  }
  function target(): Combatant {
    return {
      id: "t", name: "Target", side: "enemies", sprite: "",
      hp: 50, maxHp: 50, ac: 5, attackBonus: 0, dexMod: 0,
      damage: { dice: 1, sides: 4, bonus: 0 },
      position: { col: 1, row: 0 },
      strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10,
      moveRange: 4, weaponName: null,
    } as unknown as Combatant;
  }

  const crossbow: Item = {
    id: "stormbolt_crossbow",
    category: "weapons",
    name: "Stormbolt Crossbow",
    slots: ["hands"],
    character_can_equip: true,
    power: 9,
    ranged: true,
    ammo: "bolts",
    bonus_damage: "1d6",
    damage_type: "lightning",
  };

  it("adds the weapon's bonus_damage on top of base projectile damage", () => {
    // d20 = 15 vs AC 5 → hit, not a crit. Max dice afterward:
    // base 1d6(6) + power 9 = 15, bonus 1d6(6) = 6 → 21 total.
    const r = resolveThrow(attacker(), target(), crossbow, rng(15) as never);
    expect(r.hit).toBe(true);
    expect(r.bonusDamage).toBe(6);
    expect(r.damage).toBe(21);
    expect(r.damageType).toBe("lightning");
  });

  it("reports no bonus for a plain ranged weapon", () => {
    const plainBow: Item = {
      id: "long_bow", category: "weapons", name: "Long Bow",
      slots: ["hands"], character_can_equip: true, power: 7, ranged: true,
      ammo: "arrows",
    };
    const r = resolveThrow(attacker(), target(), plainBow, rng(15) as never);
    expect(r.hit).toBe(true);
    expect(r.bonusDamage).toBe(0);
    expect(r.damageType).toBeUndefined();
  });

  it("does not add bonus damage on a miss", () => {
    // d20 = 1 vs AC 5 → miss.
    const r = resolveThrow(attacker(), target(), crossbow, rng(1) as never);
    expect(r.hit).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.bonusDamage).toBe(0);
  });
});

// ── attack(): melee gate for ranged weapons ──────────────────────────

describe("Combat.attack — ranged weapon bonus does NOT apply on a melee bump", () => {
  function makeCombatant(over: Partial<Combatant> = {}): Combatant {
    return {
      id: "c?", name: "?", side: "party", maxHp: 30, hp: 30, ac: 12,
      attackBonus: 20, // guaranteed hit
      damage: { dice: 1, sides: 6, bonus: 2 },
      dexMod: 500, // win initiative
      strength: 12, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 10,
      color: [100, 100, 100], baseMoveRange: 4, position: { col: 0, row: 0 },
      ...over,
    } as Combatant;
  }

  function fixture(attackerOver: Partial<Combatant>, seed: number) {
    const a = makeCombatant({ id: "hero", name: "Hero", side: "party", ...attackerOver });
    const t = makeCombatant({
      id: "orc", name: "Orc", side: "enemies", hp: 500, maxHp: 500, ac: 0, dexMod: 0,
    });
    const reserve = makeCombatant({ id: "rsv", name: "Rsv", side: "enemies", hp: 20, maxHp: 20, ac: 0, dexMod: 0 });
    const combat = new Combat([a], [t, reserve], mulberry32(seed));
    a.position = { col: 4, row: 4 };
    t.position = { col: 5, row: 4 };
    reserve.position = { col: 14, row: 1 };
    return combat;
  }

  it("a ranged weapon's bonus is skipped in melee; an identical melee weapon's is not", () => {
    // Paired attack, same seed + stats — only weaponRanged differs.
    // The melee weapon adds its 1d6 bonus, the ranged one doesn't, so
    // the melee total is strictly higher (bonus is min 1 on a hit's
    // dice → always ≥1 extra).
    const seed = 7;
    const ranged = fixture(
      { weaponBonusDamage: "1d6", weaponDamageType: "lightning", weaponRanged: true },
      seed,
    ).attack("orc");
    const melee = fixture(
      { weaponBonusDamage: "1d6", weaponDamageType: "fire", weaponRanged: false },
      seed,
    ).attack("orc");
    expect(ranged.hit).toBe(true);
    expect(melee.hit).toBe(true);
    // Same seed → same base roll; melee adds a ≥1 bonus the ranged
    // weapon withholds.
    expect(melee.damage).toBeGreaterThan(ranged.damage);
  });

  it("a plain melee weapon (no bonus) matches a ranged weapon's withheld bonus", () => {
    const seed = 7;
    const ranged = fixture(
      { weaponBonusDamage: "1d6", weaponRanged: true },
      seed,
    ).attack("orc");
    const plain = fixture({ weaponRanged: false }, seed).attack("orc");
    // The ranged weapon withholds its bonus in melee, so its melee
    // damage equals a bonus-less weapon's on the same seed.
    expect(ranged.damage).toBe(plain.damage);
  });
});

// ── CombatBridge: weaponRanged flag plumbing ─────────────────────────

describe("CombatBridge — weaponRanged flag", () => {
  function makeMember(over: Partial<PartyMember> = {}): PartyMember {
    return {
      id: "m", name: "M", class: "ranger", race: "elf", gender: "f",
      level: 1, exp: 0, hp: 10, max_hp: 10, mp: 0, max_mp: 0,
      strength: 10, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 10,
      equipped: { hands: null, body: null },
      equipped_durability: { hands: null, body: null },
      inventory: [], sprite: "", ...over,
    } as PartyMember;
  }
  const items = new Map<string, Item>([
    ["stormbolt_crossbow", {
      id: "stormbolt_crossbow", category: "weapons", name: "Stormbolt Crossbow",
      slots: ["hands"], character_can_equip: true, power: 9, ranged: true,
      ammo: "bolts", bonus_damage: "1d6", damage_type: "lightning",
    }],
    ["sun_sword", {
      id: "sun_sword", category: "weapons", name: "Sun Sword",
      slots: ["hands"], character_can_equip: true, power: 20,
      bonus_damage: "1d6", damage_type: "fire",
    }],
  ]);

  it("is true for a ranged weapon and false for a melee weapon", () => {
    const ranged = combatantFromMember(
      makeMember({ equipped: { hands: "stormbolt_crossbow", body: null } }), items,
    );
    const melee = combatantFromMember(
      makeMember({ equipped: { hands: "sun_sword", body: null } }), items,
    );
    expect(ranged.weaponRanged).toBe(true);
    expect(melee.weaponRanged).toBe(false);
  });
});
