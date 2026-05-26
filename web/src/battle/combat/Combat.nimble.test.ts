/**
 * Engine-side regression coverage for the Nimble race ability —
 * specifically the two places `Combat.ts` consumes the per-combatant
 * movement fields the bridge stamps on:
 *
 *   - `refillMovePoints` now adds `extraMoveRange` to `baseMoveRange`
 *     at the start of each turn (Nimble grants +3).
 *   - `tryMove`'s bump-attack branch consults `postAttackMove` when
 *     Shadow Step doesn't apply, replacing the legacy zero-out with
 *     the actor's per-attack allowance (Nimble grants 2).
 *
 * Kept narrow: each test stands up the minimum Combat fixture needed
 * to exercise the behaviour under inspection, with a seeded RNG so
 * initiative and to-hit rolls are reproducible.
 */

import { describe, it, expect } from "vitest";
import { Combat } from "./Combat";
import { mulberry32 } from "../rng";
import type { Combatant } from "../types";

/** Compact Combatant fixture — enough fields to satisfy the engine,
 *  knobs for the bits each test wants to vary. */
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

describe("Combat — refillMovePoints includes extraMoveRange", () => {
  it("adds Nimble's +3 to the per-turn movement budget", () => {
    // A single Elf party member (Nimble grants +3 / +2) vs a stand-in
    // enemy. The constructor runs `refillMovePoints` for whoever wins
    // initiative — with a seeded RNG and a +DEX advantage on the
    // party member we can pin the assertion to the Elf's first turn.
    const elf = makeCombatant({
      id: "elf",
      name: "Elf",
      side: "party",
      baseMoveRange: 4,
      extraMoveRange: 3, // Nimble
      dexMod: 5, // wins initiative
    });
    const goblin = makeCombatant({
      id: "goblin",
      name: "Goblin",
      side: "enemies",
      baseMoveRange: 3,
      dexMod: 0,
    });
    const combat = new Combat([elf], [goblin], mulberry32(1));
    expect(combat.current.id).toBe("elf");
    expect(combat.movePoints).toBe(4 + 3); // base + Nimble
  });

  it("leaves movement intact for non-Elves (no extraMoveRange)", () => {
    // Same fixture without the Nimble field — confirms the new code
    // path is opt-in via the field's presence, not an unconditional
    // bonus that would silently buff every combatant.
    const human = makeCombatant({
      id: "human",
      name: "Human",
      baseMoveRange: 4,
      dexMod: 5,
    });
    const goblin = makeCombatant({
      id: "goblin",
      name: "Goblin",
      side: "enemies",
      baseMoveRange: 3,
      dexMod: 0,
    });
    const combat = new Combat([human], [goblin], mulberry32(1));
    expect(combat.current.id).toBe("human");
    expect(combat.movePoints).toBe(4);
  });
});

describe("Combat — bump-attack preserves postAttackMove", () => {
  /** Build a fixture where the Elf is guaranteed to act first and
   *  there's an enemy parked Chebyshev-adjacent to them for the
   *  bump test. Constructor lays out party + enemies on opposite
   *  bands of the arena, so we manually rewrite positions after
   *  construction. */
  function fightFixture(elfOver: Partial<Combatant> = {}) {
    const elf = makeCombatant({
      id: "elf",
      name: "Elf",
      side: "party",
      baseMoveRange: 4,
      extraMoveRange: 3,
      postAttackMove: 2,
      dexMod: 5,
      attackBonus: 20, // guaranteed hit
      damage: { dice: 1, sides: 1, bonus: 0 }, // 1 damage per swing
      ...elfOver,
    });
    const goblin = makeCombatant({
      id: "goblin",
      name: "Goblin",
      side: "enemies",
      baseMoveRange: 3,
      hp: 50,
      maxHp: 50, // soaks a 1-damage bump
      ac: 0, // any roll hits
      dexMod: 0,
    });
    const combat = new Combat([elf], [goblin], mulberry32(1));
    // Re-park the combatants so the Elf is at (4, 4) and the
    // Goblin at (5, 4) — Chebyshev-adjacent, west bump works.
    elf.position = { col: 4, row: 4 };
    goblin.position = { col: 5, row: 4 };
    return { combat, elf, goblin };
  }

  it("caps the attacker's movement at postAttackMove instead of zeroing", () => {
    const { combat } = fightFixture();
    expect(combat.current.id).toBe("elf");
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    // Default zero-out would leave 0; Nimble preserves 2.
    expect(combat.movePoints).toBe(2);
  });

  it("REPLACES remaining moves rather than adding to them", () => {
    // If the elf had 7 moves before attacking, post-attack is still 2.
    // (Replacing, not adding — see the doc on `tryMove`.)
    const { combat } = fightFixture();
    // Burn three tiles before the bump so we can tell add-vs-replace.
    combat.tryMove("n");
    combat.tryMove("n");
    combat.tryMove("n");
    // Walk east to land Chebyshev-adjacent to the goblin (we moved
    // the elf to col=4, row=4 originally; three north steps put them
    // at col=4, row=1). Reposition the goblin to col=5, row=1 so the
    // bump still lands.
    combat.combatants.find((c) => c.id === "goblin")!.position = {
      col: 5,
      row: 1,
    };
    const movesBefore = combat.movePoints; // 7 - 3 = 4
    expect(movesBefore).toBe(4);
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    expect(combat.movePoints).toBe(2); // replaced, not added
  });

  it("zeroes movement when postAttackMove is absent (legacy behaviour)", () => {
    const { combat } = fightFixture({
      // No Nimble — the elf turns into a plain combatant for this
      // assertion.
      extraMoveRange: undefined,
      postAttackMove: undefined,
    });
    const result = combat.tryMove("e");
    expect(result.kind).toBe("attacked");
    expect(combat.movePoints).toBe(0);
  });

  it("blocks a second bump-attack the same turn (no infinite Nimble chain)", () => {
    // Regression for the "Nimble can attack indefinitely" bug.
    // Park TWO goblins flanking the elf so the post-attack movement
    // bonus could, in principle, carry the elf into a second swing:
    //
    //   . G1 .       elf at (4,4)
    //   .  E . G2    G1 west-of-elf at (3,4), G2 east-of-elf at (5,4)
    //
    // Pre-fix: tryMove("e") attacks G2, refills movePoints to 2,
    // then tryMove("w") would attack G1, refill to 2 again — etc.
    // Post-fix: the second bump is blocked, but the elf still has
    // their `postAttackMove` budget to disengage onto empty tiles.
    const elf = makeCombatant({
      id: "elf",
      name: "Elf",
      side: "party",
      baseMoveRange: 4,
      extraMoveRange: 3,
      postAttackMove: 2,
      dexMod: 5,
      attackBonus: 20,
      damage: { dice: 1, sides: 1, bonus: 0 },
    });
    const g1 = makeCombatant({
      id: "g1",
      name: "Goblin 1",
      side: "enemies",
      hp: 50,
      maxHp: 50,
      ac: 0,
      dexMod: 0,
    });
    const g2 = makeCombatant({
      id: "g2",
      name: "Goblin 2",
      side: "enemies",
      hp: 50,
      maxHp: 50,
      ac: 0,
      dexMod: 0,
    });
    const combat = new Combat([elf], [g1, g2], mulberry32(1));
    elf.position = { col: 4, row: 4 };
    g1.position = { col: 3, row: 4 };
    g2.position = { col: 5, row: 4 };

    // First swing — east into G2.
    const first = combat.tryMove("e");
    expect(first.kind).toBe("attacked");
    expect(combat.movePoints).toBe(2);

    // Second swing attempt — west into G1. Must be blocked with the
    // new "already-attacked" reason, NOT resolve as another attack.
    const second = combat.tryMove("w");
    expect(second.kind).toBe("blocked");
    if (second.kind === "blocked") {
      expect(second.reason).toBe("already-attacked");
    }
    // Movement budget is untouched by the blocked attempt — the elf
    // can still spend it on empty tiles to disengage.
    expect(combat.movePoints).toBe(2);

    // Step north onto an empty tile to prove disengagement still works.
    const retreat = combat.tryMove("n");
    expect(retreat.kind).toBe("moved");
    expect(combat.movePoints).toBe(1);
  });

  it("reopens the bump-attack gate on the next turn", () => {
    // Sanity: the per-turn lock resets so the elf can attack again
    // after their turn ends and comes back around.
    const { combat } = fightFixture();
    expect(combat.current.id).toBe("elf");
    combat.tryMove("e"); // first swing — locks the gate
    const blocked = combat.tryMove("e"); // goblin still adjacent? no — it took 1 dmg but still parked at (5,4)
    // The goblin survived (HP 50), so it's still at (5,4). A second
    // east step should now report "already-attacked" rather than
    // resolving another bump.
    expect(blocked.kind).toBe("blocked");

    // Hand the turn to the goblin and back to the elf — gate reopens.
    combat.endTurn(); // goblin's turn
    combat.endTurn(); // back to elf
    expect(combat.current.id).toBe("elf");
    const second = combat.tryMove("e");
    expect(second.kind).toBe("attacked");
  });
});
