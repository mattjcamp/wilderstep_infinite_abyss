/**
 * Engine contract for the Man Eater "swallow whole" (consume) on-hit
 * effect. The CombatScene renders off this contract: a swallowed actor
 * is moved OFF the board and flagged `consumed`, and `isCurrentConsumed`
 * routes their initiative slot into the auto-resolving STR-save tick
 * instead of a player/AI turn.
 *
 * This locks the invariants the scene's overlay guards rely on — if a
 * swallowed actor's `position` ever stayed on-board, the scene's
 * selection ring + movement-reach overlay would paint at a real cell
 * and the swallowed character would look present + movable (the bug
 * these guards fix).
 */

import { describe, it, expect } from "vitest";
import { Combat } from "./Combat";
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

describe("Combat — Man Eater consume (swallow)", () => {
  it("flags the victim consumed and moves them off-board on a failed save", () => {
    const { combat, victim } = swallowFixture();
    combat.attack("victim");

    expect(victim.consumed).toBeTruthy();
    expect(victim.consumed?.consumerId).toBe("man_eater");
    // Off-board sentinel — the scene relies on this to keep the
    // swallowed actor's ring/reach overlay off the arena.
    expect(victim.position.col).toBeLessThan(0);
    expect(victim.position.row).toBeLessThan(0);
    // The original cell is stashed for the later release.
    expect(victim.consumed?.originalPosition).toEqual({ col: 5, row: 4 });
  });

  it("emits an `applied` consume event for the scene to flash", () => {
    const { combat, victim } = swallowFixture();
    combat.attack("victim");
    const events = combat.popConsumeEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ targetId: "victim", kind: "applied" }),
    );
  });

  it("reports isCurrentConsumed once the swallowed actor's slot comes up", () => {
    const { combat, victim } = swallowFixture();
    combat.attack("victim");
    // Walk initiative until the swallowed victim is the active actor;
    // their slot must report as consumed so the scene auto-resolves it
    // instead of handing the player control.
    let guard = 0;
    while (combat.current.id !== victim.id && guard++ < 8) {
      combat.endTurn();
    }
    expect(combat.current.id).toBe(victim.id);
    expect(combat.isCurrentConsumed()).toBe(true);
  });

  it("runConsumedAutoTurn RETURNS the escape events and DRAINS the queue", () => {
    // This is the contract the scene's runConsumedTurn relies on: the
    // auto-turn pops its own events into the return value, so a caller
    // that re-pops the queue afterwards gets nothing. (The freed
    // character's `saved` event — which re-shows + repositions the
    // sprite — was being lost exactly because of a re-pop.)
    const { combat, victim } = swallowFixture();
    // Swallow the victim outright, then make escape a certainty
    // (high STR vs a trivial DC) so the auto-turn yields a `saved`.
    victim.consumed = {
      damagePerTurn: 1,
      saveDc: 5,
      consumerId: "man_eater",
      originalPosition: { col: 5, row: 4 },
    };
    victim.position = { col: -1, row: -1 };
    victim.strength = 20; // +5 mod — clears DC 5 on any d20 roll
    let guard = 0;
    while (combat.current.id !== victim.id && guard++ < 8) combat.endTurn();
    expect(combat.current.id).toBe(victim.id);

    const events = combat.runConsumedAutoTurn();
    // The auto-turn produced the escape event...
    expect(events).toContainEqual(
      expect.objectContaining({ targetId: "victim", kind: "saved" }),
    );
    // ...and DRAINED the queue — re-popping (what the buggy scene did)
    // returns nothing, which is why those events must be flashed from
    // the return value.
    expect(combat.popConsumeEvents()).toEqual([]);
    // Engine state after escape: back on the board, no longer consumed.
    expect(victim.consumed).toBeUndefined();
    expect(victim.position.col).toBeGreaterThanOrEqual(0);
    expect(victim.position.row).toBeGreaterThanOrEqual(0);
  });
});
