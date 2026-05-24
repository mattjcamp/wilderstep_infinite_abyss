/**
 * Engine-side regression coverage for the `shadowStepped` flag on
 * AttackResult — set by `Combat.tryMove` after ANY bump-attack
 * (hit, miss, or kill) when the attacker passes `canShadowStep`
 * (level-7+ Thief). The flag tells the scene to start the post-
 * attack pulse on the thief's body and is paired with preserved
 * movement so the thief can step out of reach.
 *
 * The "kill required" gate was deliberately removed — the ability's
 * design intent is hit-and-run mobility, not a kill bonus. These
 * tests lock in the post-removal behaviour so a future refactor
 * doesn't accidentally re-add the kill check.
 *
 * Kept narrow: each test stands up the minimum Combat fixture
 * needed, with a seeded RNG so initiative and to-hit rolls are
 * reproducible. The pulse itself is a Phaser tween — not testable
 * here — so the tests focus on the FLAG that drives it.
 */

import { describe, it, expect } from "vitest";
import { Combat } from "./Combat";
import { mulberry32 } from "../rng";
import type { Combatant } from "../types";

/** Compact Combatant fixture — enough fields to satisfy the engine,
 *  knobs for the bits each test wants to vary. Mirrors the helper
 *  in the Nimble test file. */
function makeCombatant(over: Partial<Combatant> = {}): Combatant {
  return {
    id: "c?",
    name: "?",
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

/** Build a fixture where the attacker is parked one tile west of an
 *  enemy. Default attacker is a level-7 Thief; `attackerOver` can
 *  downgrade the class / level / weapon for the negative cases.
 *
 *  TWO enemies are seeded so a killing bump of the first doesn't
 *  end the encounter — the engine's Shadow Step branch gates on
 *  `!this.isOver` so we need at least one survivor in the wings
 *  for the flag to fire. The second goblin is parked far away
 *  (so it doesn't interfere with the bump itself) and is alive
 *  enough to keep combat going.
 */
function fightFixture(opts: {
  attackerOver?: Partial<Combatant>;
  /** Override the enemy's HP so the bump can be tuned hit-but-not-kill
   *  (high HP soaks the 1-damage strike) vs. kill (low HP). */
  enemyHp?: number;
}) {
  const attacker = makeCombatant({
    id: "thief",
    name: "Thief",
    side: "party",
    charClass: "thief",
    level: 7,
    weaponName: "Dagger",
    baseMoveRange: 6,
    dexMod: 5, // wins initiative
    attackBonus: 20, // guaranteed hit
    damage: { dice: 1, sides: 1, bonus: 0 }, // 1 damage per swing
    ...opts.attackerOver,
  });
  const enemy = makeCombatant({
    id: "goblin",
    name: "Goblin",
    side: "enemies",
    baseMoveRange: 3,
    hp: opts.enemyHp ?? 1,
    maxHp: 50,
    ac: 0, // any roll hits
    dexMod: 0,
  });
  const reserve = makeCombatant({
    id: "reserve_goblin",
    name: "Reserve Goblin",
    side: "enemies",
    hp: 20,
    maxHp: 20,
    ac: 0,
  });
  const combat = new Combat([attacker], [enemy, reserve], mulberry32(1));
  // Re-park to make the bump deterministic — attacker at (4,4),
  // primary enemy at (5,4) so a single "e" step lands the bump.
  // Reserve goblin parked in the corner so it can't accidentally
  // soak the bump or block movement.
  attacker.position = { col: 4, row: 4 };
  enemy.position = { col: 5, row: 4 };
  reserve.position = { col: 14, row: 1 };
  return { combat, attacker, enemy };
}

describe("Combat — shadowStepped flag", () => {
  it("flags a level-7 Thief's killing bump", () => {
    const { combat } = fightFixture({ enemyHp: 1 });
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    if (result.kind !== "attacked") return;
    expect(result.result.killed).toBe(true);
    expect(result.result.shadowStepped).toBe(true);
  });

  it("flags a non-killing hit too — Shadow Step is hit-and-run, not a kill bonus", () => {
    // Enemy has enough HP to soak the 1-damage strike. Pre-fix this
    // test asserted shadowStepped stayed false; the design intent
    // is that the thief still slips back out of reach after a swing
    // that didn't finish the target.
    const { combat } = fightFixture({ enemyHp: 50 });
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    if (result.kind !== "attacked") return;
    expect(result.result.killed).toBe(false);
    expect(result.result.shadowStepped).toBe(true);
  });

  it("doesn't flag a kill by a level-6 Thief (below the L7 gate)", () => {
    const { combat } = fightFixture({
      attackerOver: { level: 6 },
      enemyHp: 1,
    });
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    if (result.kind !== "attacked") return;
    expect(result.result.killed).toBe(true);
    expect(result.result.shadowStepped).toBeFalsy();
  });

  it("doesn't flag a kill by a non-Thief", () => {
    const { combat } = fightFixture({
      attackerOver: { charClass: "fighter" },
      enemyHp: 1,
    });
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    if (result.kind !== "attacked") return;
    expect(result.result.killed).toBe(true);
    expect(result.result.shadowStepped).toBeFalsy();
  });

  it("preserves the attacker's remaining movement on a kill bump", () => {
    // Sanity: the flag and the movement-preservation rule travel
    // together. If a future refactor split them apart, this would
    // catch it.
    const { combat } = fightFixture({ enemyHp: 1 });
    expect(combat.movePoints).toBe(6); // base move range
    combat.tryMove("e");
    expect(combat.movePoints).toBe(6);
  });

  it("preserves the attacker's remaining movement on a non-kill bump too", () => {
    // Mirror of the kill-bump check, but with a tougher target.
    // Shadow Step's whole point is letting the thief retreat after
    // *any* attack — without this the ability is silently gated on
    // a finishing blow in the movement path too.
    const { combat } = fightFixture({ enemyHp: 50 });
    expect(combat.movePoints).toBe(6);
    combat.tryMove("e");
    expect(combat.movePoints).toBe(6);
  });
});
