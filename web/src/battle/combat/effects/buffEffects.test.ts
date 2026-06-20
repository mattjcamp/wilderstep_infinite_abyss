/**
 * Characterization + unification tests for numeric buffs/debuffs, now
 * stored as `stat_modifier` effects in the unified `Combatant.effects`
 * list (was a separate `buffs` Map + `Buffs.ts` tick). The buff math had
 * no direct coverage before this refactor; these lock the behaviour
 * (effective attack / AC / damage / range, duration expiry, the
 * buffsFor / hasBuffFromSource views) so the move off the old store is
 * provably behaviour-preserving.
 */

import { describe, it, expect } from "vitest";
import { Combat } from "../Combat";
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

describe("buffs — effective stat math", () => {
  it("bless raises and curse lowers the effective attack bonus", () => {
    const { combat, hero } = fixture();
    expect(combat.effectiveAttackBonus(hero)).toBe(4);
    combat.addBuff("hero", { kind: "attack_bonus", value: 2, turnsLeft: 4, source: "Bless" });
    expect(combat.effectiveAttackBonus(hero)).toBe(6);
    combat.addBuff("hero", { kind: "attack_penalty", value: 1, turnsLeft: 4, source: "Curse" });
    expect(combat.effectiveAttackBonus(hero)).toBe(5);
  });

  it("shield raises and curse lowers the effective AC", () => {
    const { combat, hero } = fixture();
    expect(combat.effectiveAc(hero)).toBe(12);
    combat.addBuff("hero", { kind: "ac_bonus", value: 3, turnsLeft: 3, source: "Shield" });
    expect(combat.effectiveAc(hero)).toBe(15);
    combat.addBuff("hero", { kind: "ac_penalty", value: 2, turnsLeft: 3, source: "Curse" });
    expect(combat.effectiveAc(hero)).toBe(13);
  });

  it("sums damage_bonus buffs", () => {
    const { combat, hero } = fixture();
    expect(combat.effectiveDamageBonus(hero)).toBe(0);
    combat.addBuff("hero", { kind: "damage_bonus", value: 2, turnsLeft: 5, source: "Elixir of Strength" });
    expect(combat.effectiveDamageBonus(hero)).toBe(2);
  });

  it("folds range_bonus into the per-turn move budget", () => {
    const { combat } = fixture();
    combat.addBuff("hero", { kind: "range_bonus", value: 3, turnsLeft: 5, source: "Long Shanks" });
    // Advance a full round so Hero's turn refills with the buff active.
    combat.endTurn();
    combat.endTurn();
    expect(combat.current.id).toBe("hero");
    expect(combat.movePoints).toBe(4 + 3);
  });
});

describe("buffs — views + storage", () => {
  it("surfaces buffs through buffsFor and hasBuffFromSource", () => {
    const { combat } = fixture();
    combat.addBuff("hero", { kind: "attack_bonus", value: 2, turnsLeft: 4, source: "Bless" });
    const buffs = combat.buffsFor("hero");
    expect(buffs).toHaveLength(1);
    expect(buffs[0]).toMatchObject({ kind: "attack_bonus", value: 2, source: "Bless" });
    expect(combat.hasBuffFromSource("hero", "bless")).toBe(true);
    expect(combat.hasBuffFromSource("hero", "nonexistent")).toBe(false);
  });

  it("stores buffs as stat_modifier effects in the unified effects list", () => {
    const { combat, hero } = fixture();
    combat.addBuff("hero", { kind: "ac_bonus", value: 1, turnsLeft: 3, source: "Shield" });
    expect(hero.effects?.some((e) => e.effectId === "stat_modifier")).toBe(true);
  });
});

describe("buffs — duration", () => {
  it("expires after its turns run out, logs the flavour line, reverts the stat", () => {
    const { combat, hero } = fixture();
    combat.addBuff("hero", { kind: "attack_bonus", value: 2, turnsLeft: 1, source: "Bless" });
    expect(combat.effectiveAttackBonus(hero)).toBe(6);
    // One full round (2 combatants → 2 endTurns) ticks the buff to 0.
    combat.endTurn();
    combat.endTurn();
    expect(combat.effectiveAttackBonus(hero)).toBe(4);
    expect(combat.buffsFor("hero")).toHaveLength(0);
    expect(combat.log.some((l) => l.includes("blessing fades"))).toBe(true);
  });

  it("a two-round buff survives the first round and lapses on the second", () => {
    const { combat, hero } = fixture();
    combat.addBuff("hero", { kind: "ac_bonus", value: 2, turnsLeft: 2, source: "Shield" });
    combat.endTurn();
    combat.endTurn(); // round 1 — still active
    expect(combat.effectiveAc(hero)).toBe(14);
    combat.endTurn();
    combat.endTurn(); // round 2 — lapses
    expect(combat.effectiveAc(hero)).toBe(12);
  });
});
