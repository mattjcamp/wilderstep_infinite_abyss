/**
 * Engine contract for the `consumed` ("swallowed whole") effect, now
 * running on the generic effect runtime (`effects/EffectRuntime.ts` +
 * `effects/consumedEffect.ts`).
 *
 * Two things are locked here:
 *   1. The mechanics survive the port — swallow on a failed STR save,
 *      off-board move, auto-resolving escape turn, event emission.
 *   2. The effect is DECOUPLED from monsters — `Combat.applyEffect` can
 *      inflict it from any applier (a spell/ability stand-in), not just a
 *      Man Eater on-hit. This is the whole point of the runtime layer.
 *
 * The CombatScene renders off this contract: a swallowed actor is moved
 * off the board, `isCurrentConsumed` routes their slot into the
 * auto-resolving tick, and `runControlledTurn` returns the events that
 * re-show / reposition the sprite.
 */

import { describe, it, expect } from "vitest";
import { Combat } from "./Combat";
import { consumedEffect, isConsumed } from "./effects/consumedEffect";
import { mulberry32 } from "../rng";
import type { Combatant } from "../types";

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

/** Man Eater that always lands its hit and always swallows: chance 100
 *  + an unbeatable save DC (even a nat-20 from a STR-3 victim fails),
 *  so the outcome is seed-independent. */
function swallowFixture(seed = 1) {
  const manEater = makeCombatant({
    id: "man_eater",
    name: "Man Eater",
    side: "enemies",
    attackBonus: 50, // guaranteed hit regardless of seed
    dexMod: 20, // win initiative so it's `current` for attack()
    strength: 18,
    onHitEffects: [
      { type: "consume", chance: 100, damage_per_turn: 1, save_dc: 25 },
    ],
  });
  const victim = makeCombatant({
    id: "victim",
    name: "Tarin",
    side: "party",
    ac: 0, // guaranteed hit
    strength: 3, // -4 mod; even a nat 20 (=16) can't clear DC 25
  });
  const combat = new Combat([victim], [manEater], mulberry32(seed));
  manEater.position = { col: 4, row: 4 };
  victim.position = { col: 5, row: 4 };
  return { combat, manEater, victim };
}

describe("Combat — consumed effect (Man Eater swallow, via on-hit)", () => {
  it("flags the victim consumed and moves them off-board on a failed save", () => {
    const { combat, victim } = swallowFixture();
    combat.attack("victim");

    const eff = consumedEffect(victim);
    expect(eff).toBeTruthy();
    expect(eff?.sourceId).toBe("man_eater");
    // Off-board sentinel — the scene relies on this to keep the
    // swallowed actor's ring/reach overlay off the arena.
    expect(victim.position.col).toBeLessThan(0);
    expect(victim.position.row).toBeLessThan(0);
    // The original cell is stashed (in handler state) for the release.
    expect(eff?.state.originalPosition).toEqual({ col: 5, row: 4 });
  });

  it("emits an `applied` consume event for the scene to flash", () => {
    const { combat } = swallowFixture();
    combat.attack("victim");
    const events = combat.popConsumeEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ targetId: "victim", kind: "applied" }),
    );
  });

  it("reports isCurrentConsumed once the swallowed actor's slot comes up", () => {
    const { combat, victim } = swallowFixture();
    combat.attack("victim");
    let guard = 0;
    while (combat.current.id !== victim.id && guard++ < 8) {
      combat.endTurn();
    }
    expect(combat.current.id).toBe(victim.id);
    expect(combat.isCurrentConsumed()).toBe(true);
  });

  it("runControlledTurn RETURNS the escape events and DRAINS the queue", () => {
    // The contract runConsumedTurn (scene) relies on: the auto-turn pops
    // its own events into the return value, so a caller that re-pops the
    // queue afterwards gets nothing.
    const { combat, victim } = swallowFixture();
    // Swallow the victim outright via the runtime (set up the effect
    // state directly), then make escape a certainty (high STR vs a
    // trivial DC) so the auto-turn yields a `saved`.
    victim.effects = [
      {
        effectId: "consumed",
        params: { save_dc: 5, damage_per_turn: 1 },
        sourceId: "man_eater",
        state: { originalPosition: { col: 5, row: 4 } },
      },
    ];
    victim.position = { col: -1, row: -1 };
    victim.strength = 20; // +5 mod — clears DC 5 on any d20 roll
    let guard = 0;
    while (combat.current.id !== victim.id && guard++ < 8) combat.endTurn();
    expect(combat.current.id).toBe(victim.id);

    const events = combat.runControlledTurn();
    expect(events).toContainEqual(
      expect.objectContaining({ targetId: "victim", kind: "saved" }),
    );
    // The auto-turn DRAINED the queue — re-popping returns nothing.
    expect(combat.popConsumeEvents()).toEqual([]);
    // Back on the board, no longer consumed.
    expect(isConsumed(victim)).toBe(false);
    expect(victim.position.col).toBeGreaterThanOrEqual(0);
    expect(victim.position.row).toBeGreaterThanOrEqual(0);
  });

  it("tumbles the victim free when the consumer is dead", () => {
    // Needs a reserve enemy so killing the Man Eater doesn't end the
    // encounter before the victim's auto-turn (the consumer-dead branch
    // of the handler's runTurn) gets a chance to release them.
    const manEater = makeCombatant({
      id: "man_eater", name: "Man Eater", side: "enemies",
      attackBonus: 50, dexMod: 20,
      onHitEffects: [{ type: "consume", chance: 100, damage_per_turn: 1, save_dc: 25 }],
    });
    const reserve = makeCombatant({ id: "reserve", name: "Reserve", side: "enemies" });
    const victim = makeCombatant({ id: "victim", name: "Tarin", ac: 0, strength: 3 });
    const combat = new Combat([victim], [manEater, reserve], mulberry32(1));
    manEater.position = { col: 4, row: 4 };
    victim.position = { col: 5, row: 4 };
    reserve.position = { col: 10, row: 10 };

    combat.attack("victim");
    expect(isConsumed(victim)).toBe(true);

    // Consumer dies (combat continues — reserve is alive).
    manEater.hp = 0;
    let guard = 0;
    while (combat.current.id !== victim.id && guard++ < 12) combat.endTurn();
    expect(combat.current.id).toBe(victim.id);
    combat.runControlledTurn();
    expect(isConsumed(victim)).toBe(false);
    expect(victim.position.col).toBeGreaterThanOrEqual(0);
  });
});

describe("Combat.applyEffect — consumed is applier-agnostic (decoupled)", () => {
  it("lets a non-monster applier inflict `consumed` directly", () => {
    // Simulates a spell/ability inflicting the swallow — no Man Eater
    // on-hit involved. This is the decoupling the runtime layer buys us.
    const caster = makeCombatant({ id: "caster", name: "Witch", side: "enemies" });
    const victim = makeCombatant({ id: "victim", name: "Tarin", strength: 3 });
    const combat = new Combat([victim], [caster], mulberry32(1));
    caster.position = { col: 1, row: 1 };
    victim.position = { col: 2, row: 1 };

    const eff = combat.applyEffect("victim", "consumed", {
      sourceId: "caster",
      params: { save_dc: 25, damage_per_turn: 2 }, // unbeatable → swallowed
    });

    expect(eff).toBeTruthy();
    expect(isConsumed(victim)).toBe(true);
    expect(consumedEffect(victim)?.sourceId).toBe("caster");
    expect(victim.position.col).toBeLessThan(0);
  });

  it("returns null and applies nothing for an unknown effect id", () => {
    const a = makeCombatant({ id: "a", name: "A", side: "enemies" });
    const victim = makeCombatant({ id: "victim", name: "Tarin" });
    const combat = new Combat([victim], [a], mulberry32(1));
    const eff = combat.applyEffect("victim", "no_such_effect");
    expect(eff).toBeNull();
    expect(victim.effects ?? []).toEqual([]);
  });
});
