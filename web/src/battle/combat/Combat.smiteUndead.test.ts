/**
 * Engine-side regression coverage for the Paladin's Smite Undead.
 * The ability is a passive: every Paladin attack against an undead
 * target deals 2x the rolled damage. Mirrors the abilities.json
 * record (id: smite_undead, min_level: 1 on paladin).
 *
 * Layered like Backstab / Shadow Step:
 *   - `canSmiteUndead(attacker)` gates on Paladin + level >= 1.
 *   - `target.undead` gates on the victim's type flag.
 *   - When both pass and the attack lands, the rolled damage is
 *     doubled BEFORE HP application, and `smiteUndead: true` rides
 *     back on the AttackResult so the scene can paint the cue.
 *
 * Damage tests use a paired-attack pattern (same seed, paladin vs
 * fighter) so the 2x multiplier is verified independently of the
 * underlying d20 / dice-roll outcome — that avoids brittle exact-
 * damage asserts when the seed happens to roll a nat-20 (auto-crit
 * doubles dice on top of the smite). The flag tests live separately
 * so a regression that breaks the flag without breaking the math
 * (or vice versa) gets caught with a precise failure line.
 */

import { describe, it, expect } from "vitest";
import { Combat, canSmiteUndead } from "./Combat";
import { mulberry32 } from "../rng";
import type { Combatant } from "../types";

/** Compact Combatant fixture — same shape used by the Backstab /
 *  Shadow Step / Nimble tests. */
function makeCombatant(over: Partial<Combatant> = {}): Combatant {
  return {
    id: "c?",
    name: "?",
    side: "party",
    maxHp: 30,
    hp: 30,
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

/** Build a Paladin-vs-Skeleton fixture. The Paladin is parked one
 *  tile west of the target. Default attacker is a level-5 Paladin
 *  wielding a mid-dice weapon so the rolled damage has enough range
 *  that a 2x multiplier is visible. */
function fightFixture(opts: {
  attackerOver?: Partial<Combatant>;
  targetOver?: Partial<Combatant>;
  seed?: number;
}) {
  const attacker = makeCombatant({
    id: "paladin",
    name: "Aldric",
    side: "party",
    charClass: "paladin",
    level: 5,
    weaponName: "Mace",
    baseMoveRange: 4,
    damage: { dice: 2, sides: 6, bonus: 3 },
    attackBonus: 20, // guaranteed hit (unless nat-1 forces a miss)
    dexMod: 500, // impossibly high so the Paladin always wins
                // initiative — mirrors the Backstab test fixtures'
                // approach for seed-independence.
    ...opts.attackerOver,
  });
  const target = makeCombatant({
    id: "skeleton",
    name: "Skeleton",
    side: "enemies",
    hp: 200, // soak so the test target survives even a crit-smite
    maxHp: 200,
    ac: 0,
    dexMod: 0,
    undead: true,
    ...opts.targetOver,
  });
  // Reserve enemy keeps isOver false so post-kill engine hooks stay
  // honest — same pattern Shadow Step + Backstab tests use.
  const reserve = makeCombatant({
    id: "reserve",
    name: "Reserve",
    side: "enemies",
    hp: 20,
    maxHp: 20,
    ac: 0,
  });
  const combat = new Combat(
    [attacker],
    [target, reserve],
    mulberry32(opts.seed ?? 1),
  );
  attacker.position = { col: 4, row: 4 };
  target.position = { col: 5, row: 4 };
  reserve.position = { col: 14, row: 1 };
  return { combat, attacker, target };
}

// ── Gate predicate ───────────────────────────────────────────────────

describe("canSmiteUndead — gate predicate", () => {
  it("true for an alive Paladin at level 1+", () => {
    const c = makeCombatant({ charClass: "paladin", level: 1 });
    expect(canSmiteUndead(c)).toBe(true);
  });

  it("false for a non-Paladin", () => {
    const c = makeCombatant({ charClass: "fighter", level: 10 });
    expect(canSmiteUndead(c)).toBe(false);
  });

  it("case-insensitive on class id", () => {
    const c = makeCombatant({ charClass: "Paladin", level: 1 });
    expect(canSmiteUndead(c)).toBe(true);
  });

  it("false when the Paladin is down", () => {
    const c = makeCombatant({ charClass: "paladin", level: 5, hp: 0 });
    expect(canSmiteUndead(c)).toBe(false);
  });
});

// ── Flag plumbing on AttackResult ────────────────────────────────────

describe("Combat.attack — smiteUndead flag", () => {
  it("flags when a Paladin lands on an undead target", () => {
    const { combat } = fightFixture({});
    const r = combat.attack("skeleton");
    expect(r.hit).toBe(true);
    expect(r.smiteUndead).toBe(true);
  });

  it("does NOT flag against a living target", () => {
    const { combat } = fightFixture({
      targetOver: { id: "goblin", name: "Goblin", undead: false },
    });
    const r = combat.attack("goblin");
    expect(r.hit).toBe(true);
    expect(r.smiteUndead).toBeFalsy();
  });

  it("does NOT flag when the attacker is not a Paladin", () => {
    // Preserve the high dexMod so the fighter still wins initiative
    // and `attack()` doesn't throw "cannot attack ally" because the
    // skeleton's turn came up first.
    const { combat } = fightFixture({
      attackerOver: { charClass: "fighter", dexMod: 50 },
    });
    const r = combat.attack("skeleton");
    expect(r.hit).toBe(true);
    expect(r.smiteUndead).toBeFalsy();
  });
});

// ── Damage doubling (paired-attack, seed-independent) ─────────────────

describe("Combat.attack — Smite Undead damage multiplier", () => {
  it("doubles the rolled damage against an undead target", () => {
    // Paired-attack pattern: same seed + identical attacker stats
    // (including dexMod so initiative goes the same way), only the
    // class differs. Smite -> doubled damage; identical roll
    // sequence -> identical dice -> exact 2x ratio.
    const seed = 42;
    const smiter = fightFixture({ seed }).combat;
    const baseline = fightFixture({
      seed,
      // Preserve dexMod so initiative still favours the attacker
      // (without it the skeleton wins and attack() throws "cannot
      // attack ally").
      attackerOver: { charClass: "fighter", dexMod: 50 },
    }).combat;
    const smiteResult = smiter.attack("skeleton");
    const baselineResult = baseline.attack("skeleton");
    expect(smiteResult.hit).toBe(true);
    expect(baselineResult.hit).toBe(true);
    expect(smiteResult.smiteUndead).toBe(true);
    expect(baselineResult.smiteUndead).toBeFalsy();
    // Smite is post-bonus, post-crit — it's a multiplier on the
    // FINAL damage number, so the comparison is a clean 2x.
    expect(smiteResult.damage).toBe(baselineResult.damage * 2);
  });

  it("does NOT double damage against a living target", () => {
    const seed = 42;
    const a = fightFixture({
      seed,
      targetOver: { id: "goblin", name: "Goblin", undead: false },
    }).combat;
    const b = fightFixture({
      seed,
      attackerOver: { charClass: "fighter", dexMod: 50 },
      targetOver: { id: "goblin", name: "Goblin", undead: false },
    }).combat;
    const aResult = a.attack("goblin");
    const bResult = b.attack("goblin");
    // Same dice, no smite either way -> identical damage.
    expect(aResult.damage).toBe(bResult.damage);
    expect(aResult.smiteUndead).toBeFalsy();
  });

  it("includes the Sun Sword bonus in the doubling (everything-doubles flavour)", () => {
    // Sun Sword's `weaponBonusDamage` adds 1d6 fire on top of the
    // weapon dice. Smite multiplies the *total* (base + bonus), so
    // a Paladin with a Sun Sword striking a Lich doubles BOTH parts
    // — the ability flavour is "divine wrath through your weapon,"
    // not "the holy bit, separately."
    const seed = 99;
    const attackerOver: Partial<Combatant> = {
      weaponBonusDamage: "1d6",
      weaponDamageType: "fire",
    };
    const smiter = fightFixture({ seed, attackerOver }).combat;
    const baseline = fightFixture({
      seed,
      attackerOver: { ...attackerOver, charClass: "fighter", dexMod: 50 },
    }).combat;
    const sR = smiter.attack("skeleton");
    const bR = baseline.attack("skeleton");
    expect(sR.smiteUndead).toBe(true);
    expect(sR.damage).toBe(bR.damage * 2);
  });
});

// ── Negative path: misses don't smite ─────────────────────────────────

describe("Combat.attack — Smite Undead miss", () => {
  it("does NOT flag smite on a miss, even against undead", () => {
    // attackBonus far below the target's AC + an AC high enough to
    // close the nat-20 auto-hit window via target ac. A nat-20 still
    // hits per d20 rules, but with an undead target that just means
    // a *hit* on the auto-crit; the case we care about is the
    // non-auto-crit miss path, so we run a few seeds and assert
    // that whenever a miss lands, the flag stays clear.
    let sawMiss = false;
    for (let seed = 1; seed <= 20; seed++) {
      const { combat } = fightFixture({
        seed,
        // Preserve high dexMod so the Paladin still wins initiative
        // even after the attack-bonus crater.
        attackerOver: { attackBonus: -50, dexMod: 50 },
      });
      const r = combat.attack("skeleton");
      if (!r.hit) {
        sawMiss = true;
        expect(r.damage).toBe(0);
        expect(r.smiteUndead).toBeFalsy();
      }
    }
    // Sanity: at least one of the 20 seeds didn't roll a nat-20.
    expect(sawMiss).toBe(true);
  });
});
