/**
 * Improvised-melee rule for ranged weapons.
 *
 * A ranged weapon swung at an adjacent enemy (the bump-attack) is an
 * improvised club: power-1 dice (1d4 − 1) with a STR-based to-hit and
 * damage bonus, regardless of the weapon's authored power. The
 * weapon's real profile (1d6 + power, DEX to-hit) only applies when
 * it's actually fired — resolveThrow reads the Combatant's `dexMod`.
 */
import { describe, it, expect } from "vitest";
import { combatStatsFor, combatantFromMember, refreshCombatantGear } from "./CombatBridge";
import { resolveThrow } from "./CombatActions";
import type { PartyMember } from "../world/Party";
import type { Item } from "../world/Items";
import type { Combatant } from "./Combat";

function makeMember(over: Partial<PartyMember> = {}): PartyMember {
  return {
    id: "archer",
    name: "Archer",
    class: "ranger",
    race: "elf",
    gender: "f",
    level: 1,
    exp: 0,
    hp: 10,
    max_hp: 10,
    mp: 0,
    max_mp: 0,
    strength: 10,
    dexterity: 18, // +4 — makes DEX vs STR attribution unambiguous
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    equipped: { hands: null, body: null },
    equipped_durability: { hands: null, body: null },
    inventory: [],
    sprite: "",
    ...over,
  };
}

function makeItems(): Map<string, Item> {
  const items: Item[] = [
    {
      id: "long_bow",
      category: "weapons",
      name: "Long Bow",
      slots: ["hands"],
      character_can_equip: true,
      power: 7,
      ranged: true,
      ammo: "arrows",
    },
    {
      id: "sword",
      category: "weapons",
      name: "Sword",
      slots: ["hands"],
      character_can_equip: true,
      power: 5,
    },
  ];
  return new Map(items.map((it) => [it.id, it]));
}

describe("melee (bump) profile with a ranged weapon equipped", () => {
  it("treats the bow as an improvised power-1 club: 1d4 − 1 + STR", () => {
    const m = makeMember({ strength: 14, equipped: { hands: "long_bow", body: null } });
    const stats = combatStatsFor(m, makeItems());
    // STR 14 → +2; improvised tier is 1d4 with statMod − 1.
    expect(stats.damage).toEqual({ dice: 1, sides: 4, bonus: 1 });
    // To-hit is STR-based (+2), NOT the +4 DEX would give.
    expect(stats.attackBonus).toBe(2);
    // dexMod still rides along for the projectile flows.
    expect(stats.dexMod).toBe(4);
  });

  it("does not depend on the bow's authored power", () => {
    const items = makeItems();
    (items.get("long_bow") as Item).power = 20; // legendary bow
    const stats = combatStatsFor(makeMember({ equipped: { hands: "long_bow", body: null } }), items);
    expect(stats.damage).toEqual({ dice: 1, sides: 4, bonus: -1 }); // STR 10 → 0 − 1
  });

  it("leaves true melee weapons on the full power-tier ladder", () => {
    const m = makeMember({ strength: 14, equipped: { hands: "sword", body: null } });
    const stats = combatStatsFor(m, makeItems());
    expect(stats.damage).toEqual({ dice: 1, sides: 6, bonus: 2 }); // power 5 → 1d6 + STR
    expect(stats.attackBonus).toBe(2);
  });

  it("refreshCombatantGear applies the same rule on a mid-fight swap", () => {
    const items = makeItems();
    const m = makeMember({ strength: 14, equipped: { hands: "sword", body: null } });
    const c = combatantFromMember(m, items);
    m.equipped.hands = "long_bow";
    refreshCombatantGear(c, m, items);
    expect(c.damage).toEqual({ dice: 1, sides: 4, bonus: 1 });
    expect(c.attackBonus).toBe(2);
    expect(c.dexMod).toBe(4);
  });
});

describe("resolveThrow uses the DEX-based projectile profile", () => {
  /** Deterministic RNG (() => [0,1)): first call yields the wanted
   *  d20 face, every later call ~1 so damage dice roll their max. */
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

  function makeTarget(): Combatant {
    return {
      id: "t", name: "Target", side: "enemies", sprite: "",
      hp: 30, maxHp: 30, ac: 14, attackBonus: 0, dexMod: 0,
      damage: { dice: 1, sides: 4, bonus: 0 },
      position: { col: 1, row: 0 },
      strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10,
      moveRange: 4, weaponName: null,
    } as unknown as Combatant;
  }

  it("hits with DEX where the STR-based melee bonus would miss", () => {
    const items = makeItems();
    const m = makeMember({ equipped: { hands: "long_bow", body: null } }); // STR 10/DEX 18
    const archer = combatantFromMember(m, items);
    // d20 = 11: with DEX +4 → 15 vs AC 14 (hit). With the melee
    // bonus (STR +0) the same roll would have missed.
    expect(archer.attackBonus).toBe(0);
    const result = resolveThrow(archer, makeTarget(), items.get("long_bow")!, rng(11) as never);
    expect(result.hit).toBe(true);
    // Damage is the projectile profile: 1d6 (max 6) + power 7.
    expect(result.damage).toBe(13);
  });

  it("misses when DEX can't bridge the gap", () => {
    const items = makeItems();
    const m = makeMember({ dexterity: 10, equipped: { hands: "long_bow", body: null } });
    const archer = combatantFromMember(m, items);
    const result = resolveThrow(archer, makeTarget(), items.get("long_bow")!, rng(11) as never);
    expect(result.hit).toBe(false);
  });
});
