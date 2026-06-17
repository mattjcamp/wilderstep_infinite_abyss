/**
 * Divine Smite's anti-undead multiplier (`vs_undead_multiplier`).
 *
 * resolveDamageSpell rolls dice + stat bonus, then — for spells that
 * carry `vs_undead_multiplier` — multiplies the total when the target
 * is undead. Living targets take the base roll.
 *
 * The fixtures use d1 dice (`dice_sides: 1`) so each die is always 1
 * and the rolled damage is deterministic (= dice_count), isolating the
 * multiplier from RNG.
 */

import { describe, it, expect } from "vitest";
import { resolveDamageSpell } from "./CombatActions";
import type { Combatant } from "../types";
import type { Spell } from "../world/Spells";

function rngQueue(...values: number[]) {
  const q = [...values];
  return () => q.shift() ?? 0.999;
}

function combatant(over: Partial<Combatant>): Combatant {
  const base = {
    id: "c", name: "Target", side: "enemies", sprite: "",
    hp: 100, maxHp: 100, ac: 5, attackBonus: 0, dexMod: 0,
    damage: { dice: 1, sides: 6, bonus: 0 },
    position: { col: 0, row: 0 },
    intelligence: 10, wisdom: 10,
    color: [0, 0, 0], baseMoveRange: 3,
  } as unknown as Combatant;
  return { ...base, ...over };
}

/** Smite: 10 × d1 (= 10 flat) radiant, 1.5× vs undead. */
function smiteSpell(): Spell {
  return {
    id: "divine_smite",
    name: "Divine Smite",
    description: "",
    casting_type: "priest",
    min_level: 9,
    mp_cost: 45,
    duration: "instant",
    action: "damage",
    usable_in: ["battle"],
    effect_type: "damage",
    effect_value: {
      dice_count: 10,
      dice_sides: 1,
      min_damage: 1,
      vs_undead_multiplier: 1.5,
    },
  } as Spell;
}

describe("resolveDamageSpell — vs_undead_multiplier (Divine Smite)", () => {
  it("deals base damage to a living target", () => {
    const caster = combatant({ id: "priest", side: "party" });
    const orc = combatant({ id: "orc", undead: false, hp: 100 });
    const r = resolveDamageSpell(caster, orc, smiteSpell(), rngQueue());
    expect(r.damage).toBe(10);
    expect(orc.hp).toBe(90);
  });

  it("deals 1.5× damage to an undead target", () => {
    const caster = combatant({ id: "priest", side: "party" });
    const skeleton = combatant({ id: "sk", undead: true, hp: 100 });
    const r = resolveDamageSpell(caster, skeleton, smiteSpell(), rngQueue());
    // 10 × 1.5 = 15.
    expect(r.damage).toBe(15);
    expect(skeleton.hp).toBe(85);
  });

  it("ignores the multiplier for spells that omit it (e.g. Void Orb)", () => {
    const voidOrb = smiteSpell();
    voidOrb.effect_value = { dice_count: 10, dice_sides: 1, min_damage: 1 };
    const caster = combatant({ id: "sorc", side: "party" });
    const lich = combatant({ id: "lich", undead: true, hp: 100 });
    const r = resolveDamageSpell(caster, lich, voidOrb, rngQueue());
    expect(r.damage).toBe(10);
    expect(lich.hp).toBe(90);
  });
});
