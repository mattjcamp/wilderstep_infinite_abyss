/**
 * Spell → buff definitions + the engine's applySpellBuffs door. These
 * lock the mapping that used to be hardcoded in the scene's cast
 * branches (bless → attack_bonus, curse → two penalties, …), now
 * centralized in `spellBuffs.ts` and applied through the unified buff
 * store.
 */

import { describe, it, expect } from "vitest";
import { Combat } from "../Combat";
import { spellBuffsFor, isSpellBuff } from "./spellBuffs";
import { mulberry32 } from "../../rng";
import type { Combatant } from "../../types";

function makeCombatant(over: Partial<Combatant> = {}): Combatant {
  return {
    id: "c?",
    name: "Hero",
    side: "party",
    maxHp: 20,
    hp: 20,
    ac: 12,
    attackBonus: 4,
    damage: { dice: 1, sides: 6, bonus: 2 },
    dexMod: 1,
    strength: 12,
    dexterity: 12,
    constitution: 12,
    intelligence: 10,
    wisdom: 10,
    color: [100, 100, 100],
    baseMoveRange: 4,
    position: { col: 0, row: 0 },
    ...over,
  };
}

function fixture(seed = 1) {
  const hero = makeCombatant({ id: "hero", name: "Hero", dexMod: 20 });
  const foe = makeCombatant({ id: "foe", name: "Foe", side: "enemies" });
  const combat = new Combat([hero], [foe], mulberry32(seed));
  hero.position = { col: 1, row: 1 };
  foe.position = { col: 8, row: 8 };
  return { combat, hero, foe };
}

describe("spellBuffsFor — the definitions table", () => {
  it("maps each status spell to its buff kind(s) + source + defaults", () => {
    expect(spellBuffsFor("bless", undefined, undefined)).toEqual([
      { kind: "attack_bonus", value: 2, turnsLeft: 4, source: "Bless" },
    ]);
    expect(spellBuffsFor("ac_buff", undefined, undefined)).toEqual([
      { kind: "ac_bonus", value: 1, turnsLeft: 3, source: "Shield" },
    ]);
    expect(spellBuffsFor("curse", undefined, undefined)).toEqual([
      { kind: "attack_penalty", value: 2, turnsLeft: 4, source: "Curse" },
      { kind: "ac_penalty", value: 2, turnsLeft: 4, source: "Curse" },
    ]);
    expect(spellBuffsFor("range_buff", undefined, undefined)).toEqual([
      { kind: "range_bonus", value: 4, turnsLeft: 3, source: "Long Shanks" },
    ]);
    expect(spellBuffsFor("invisibility", undefined, undefined)).toEqual([
      { kind: "ac_bonus", value: 6, turnsLeft: 3, source: "Invisibility" },
    ]);
  });

  it("reads magnitudes off effect_value and honours an explicit duration", () => {
    expect(spellBuffsFor("bless", { attack_bonus: 5 }, 7)).toEqual([
      { kind: "attack_bonus", value: 5, turnsLeft: 7, source: "Bless" },
    ]);
  });

  it("falls back to the default duration for a non-numeric duration", () => {
    // spell.duration can be "permanent" / "instant" — fall back.
    expect(spellBuffsFor("ac_buff", undefined, "permanent")[0].turnsLeft).toBe(3);
  });

  it("returns [] for an unrecognised effect type", () => {
    expect(spellBuffsFor("not_a_buff", undefined, undefined)).toEqual([]);
    expect(isSpellBuff("not_a_buff")).toBe(false);
    expect(isSpellBuff("bless")).toBe(true);
  });
});

describe("Combat.applySpellBuffs — applied through the unified store", () => {
  it("bless raises the effective attack bonus", () => {
    const { combat, hero } = fixture();
    combat.applySpellBuffs("hero", "bless", { attack_bonus: 3 }, 4);
    expect(combat.effectiveAttackBonus(hero)).toBe(7);
    expect(combat.hasBuffFromSource("hero", "Bless")).toBe(true);
  });

  it("shield raises the effective AC", () => {
    const { combat, hero } = fixture();
    combat.applySpellBuffs("hero", "ac_buff", { ac_bonus: 2 }, 3);
    expect(combat.effectiveAc(hero)).toBe(14);
  });

  it("curse lowers both attack and AC of the target", () => {
    const { combat, foe } = fixture();
    combat.applySpellBuffs("foe", "curse", undefined, 4);
    expect(combat.effectiveAttackBonus(foe)).toBe(foe.attackBonus - 2);
    expect(combat.effectiveAc(foe)).toBe(foe.ac - 2);
  });

  it("long shanks adds to the move budget on refill", () => {
    const { combat } = fixture();
    combat.applySpellBuffs("hero", "range_buff", { range_bonus: 3 }, 5);
    combat.endTurn();
    combat.endTurn();
    expect(combat.current.id).toBe("hero");
    expect(combat.movePoints).toBe(4 + 3);
  });

  it("invisibility hardens AC and tags the source for the scene", () => {
    const { combat, hero } = fixture();
    const applied = combat.applySpellBuffs("hero", "invisibility", undefined, undefined);
    expect(applied).toHaveLength(1);
    expect(combat.effectiveAc(hero)).toBe(12 + 6);
    expect(combat.hasBuffFromSource("hero", "Invisibility")).toBe(true);
  });

  it("is a no-op for an unrecognised effect type", () => {
    const { combat, hero } = fixture();
    expect(combat.applySpellBuffs("hero", "nope", undefined, undefined)).toEqual([]);
    expect(combat.buffsFor("hero")).toHaveLength(0);
  });
});
