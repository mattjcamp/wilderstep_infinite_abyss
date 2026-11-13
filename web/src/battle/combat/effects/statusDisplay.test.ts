import { describe, expect, it } from "vitest";
import {
  badgeChipText,
  describeStatus,
  savedStatusBadges,
  statusBadgesFor,
} from "./statusDisplay";
import type { Combatant } from "../../types";

const mk = (over: Partial<Combatant>): Combatant =>
  ({
    id: "x", name: "X", side: "party", maxHp: 10, hp: 10, ac: 12, attackBonus: 0,
    damage: { dice: 1, sides: 6, bonus: 0 }, dexMod: 0, color: [1, 1, 1],
    baseMoveRange: 4, position: { col: 0, row: 0 }, ...over,
  }) as Combatant;

describe("statusBadgesFor", () => {
  it("lists statuses with turns, harmful first", () => {
    const c = mk({
      effects: [
        { effectId: "stat_modifier", params: { kind: "attack_bonus", value: 2 }, state: { turnsLeft: 4, source: "Bless" } },
        { effectId: "poisoned", params: {}, state: { turnsLeft: 3 } },
        { effectId: "stat_modifier", params: { kind: "ac_penalty", value: 3 }, state: { turnsLeft: 2, source: "Curse" } },
        { effectId: "stat_modifier", params: { kind: "attack_penalty", value: 3 }, state: { turnsLeft: 2, source: "Curse" } },
      ],
    });
    const b = statusBadgesFor(c);
    expect(b.map((x) => x.label)).toEqual(["Poisoned", "Cursed", "Blessed"]);
    expect(b.map(badgeChipText)).toEqual(["PSN 3", "CRS 2", "BLS 4"]);
    expect(describeStatus(b[1])).toBe("Cursed −3 AC, −3 ATK (2 turns)");
  });

  it("includes turned and nothing for a clean combatant", () => {
    expect(statusBadgesFor(mk({}))).toEqual([]);
    expect(statusBadgesFor(mk({ turnedTurns: 1 })).map(describeStatus)).toEqual(["Turned (1 turn)"]);
  });
});

describe("savedStatusBadges", () => {
  it("uses steps for carried statuses", () => {
    const b = savedStatusBadges([{ id: "poisoned", duration: 40 }, { id: "odd_thing", duration: "permanent" }]);
    expect(describeStatus(b[0])).toBe("Poisoned (40 steps)");
    expect(b[0].color).toBe("#7be36a");
    expect(describeStatus(b[1])).toBe("Odd Thing (permanent)");
  });
});
