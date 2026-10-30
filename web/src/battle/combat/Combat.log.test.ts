/**
 * Battle log content — the log records only what combatants DO
 * (moves, attacks, …) with basic details; no opening banner and no
 * "-- X's turn --" announcements.
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

function fixture(fighterOver: Partial<Combatant> = {}) {
  const fighter = makeCombatant({
    id: "fighter",
    name: "Borin",
    charClass: "fighter",
    dexMod: 20, // always acts first
    ...fighterOver,
  });
  const goblin = makeCombatant({ id: "goblin", name: "Goblin", side: "enemies", dexMod: 0, hp: 50, maxHp: 50 });
  const reserve = makeCombatant({ id: "reserve", name: "Reserve", side: "enemies", dexMod: 0 });
  const combat = new Combat([fighter], [goblin, reserve], mulberry32(7));
  fighter.position = { col: 4, row: 4 };
  goblin.position = { col: 8, row: 4 };
  reserve.position = { col: 14, row: 1 };
  return { combat, fighter, goblin };
}

describe("battle log", () => {
  it("opens empty — no banner, no turn announcement", () => {
    const { combat } = fixture();
    expect(combat.log).toEqual([]);
  });

  it("folds consecutive steps into one 'moves N tiles' line", () => {
    const { combat } = fixture();
    combat.tryMove("e");
    expect(combat.log).toEqual(["Borin moves 1 tile."]);
    combat.tryMove("e");
    combat.tryMove("e");
    expect(combat.log).toEqual(["Borin moves 3 tiles."]);
  });

  it("logs a hit with attacker, target and damage — no dice math", () => {
    const { combat, goblin } = fixture({ attackBonus: 50 });
    goblin.position = { col: 5, row: 4 };
    const r = combat.attack("goblin");
    expect(r.hit).toBe(true);
    const line = combat.log[combat.log.length - 1];
    expect(line).toMatch(/^Borin (hits|crits) Goblin for \d+ damage\.$/);
    expect(line).not.toMatch(/d20|AC/);
  });

  it("logs a miss as 'X misses Y.'", () => {
    const { combat, goblin } = fixture({ attackBonus: -50 });
    goblin.position = { col: 5, row: 4 };
    const r = combat.attack("goblin");
    if (!r.hit) expect(combat.log[combat.log.length - 1]).toBe("Borin misses Goblin.");
  });

  it("starts a new move line after another action", () => {
    const { combat, goblin } = fixture({ attackBonus: 50 });
    goblin.position = { col: 6, row: 4 };
    combat.tryMove("e"); // step next to the goblin
    combat.tryMove("e"); // bump → attack
    expect(combat.log[0]).toBe("Borin moves 1 tile.");
    expect(combat.log[1]).toMatch(/^Borin (hits|crits|misses) Goblin/);
  });
});
