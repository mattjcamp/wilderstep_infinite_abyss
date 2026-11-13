import { describe, expect, it } from "vitest";
import { statusVisualsFor } from "./statusAuras";
import type { Combatant } from "../types";

const base = { id: "x", name: "X", side: "party", hp: 5, maxHp: 5 } as unknown as Combatant;
const mod = (kind: string, source: string) => ({
  effectId: "stat_modifier",
  params: { kind, value: 1 },
  state: { turnsLeft: 2, source },
});

describe("statusVisualsFor", () => {
  it("maps each effect to its look", () => {
    const c = {
      ...base,
      effects: [
        { effectId: "poisoned", params: {}, state: {} },
        { effectId: "sleep", params: {}, state: {} },
        { effectId: "charm", params: {}, state: {} },
        { effectId: "slowed", params: {}, state: {} },
        mod("attack_penalty", "Curse"),
        mod("ac_penalty", "Curse"),
        mod("attack_bonus", "Bless"),
        mod("ac_bonus", "Shield"),
        mod("range_bonus", "Long Shanks"),
        mod("ac_bonus", "Invisibility"),
        mod("damage_bonus", "Elixir of Strength"),
      ],
      passives: [{ type: "regen" }],
    } as unknown as Combatant;
    expect(statusVisualsFor(c)).toEqual([
      "poison", "sleep", "charm", "slow", "curse", "bless", "shield",
      "haste", "invisible", "empower", "regen",
    ]);
  });
  it("is empty with no effects", () => {
    expect(statusVisualsFor(base)).toEqual([]);
  });
});
