/**
 * Monster status spells (Venom Bite, Web, Hex): the saving throw is
 * d20 + stat modifier vs the spell's save_dc, meeting the DC resists,
 * and the log states the outcome plainly — never "resists" followed by
 * the status landing anyway.
 */

import { describe, expect, it } from "vitest";
import { Combat } from "./Combat";
import { findEffect } from "./effects/EffectRuntime";
import type { Combatant } from "../types";

function mk(over: Partial<Combatant>): Combatant {
  return {
    id: "x",
    name: "X",
    side: "party",
    maxHp: 30,
    hp: 30,
    ac: 12,
    attackBonus: 2,
    damage: { dice: 1, sides: 6, bonus: 0 },
    dexMod: 0,
    color: [1, 1, 1],
    baseMoveRange: 4,
    position: { col: 1, row: 1 },
    ...over,
  };
}

const VENOM = {
  type: "poison",
  name: "Venom Bite",
  range: 1,
  cast_chance: 100,
  save_dc: 12,
  damage_per_turn: 3,
  duration: 3,
};

/** Combat with the spider as the active actor and the d20 pinned. */
function setup(d20: number, con = 10, spellOver: Record<string, unknown> = {}, heroOver: Partial<Combatant> = {}) {
  const hero = mk({ id: "hero", name: "Cameron", constitution: con, wisdom: con, ...heroOver });
  const spider = mk({
    id: "spider",
    name: "Giant Spider",
    side: "enemies",
    monsterSpells: [{ ...VENOM, ...spellOver } as never],
  });
  const combat = new Combat([hero], [spider]);
  const c = combat as unknown as {
    rng: () => number;
    cursor: number;
    initiativeOrder: Array<{ combatantId: string }>;
  };
  c.cursor = c.initiativeOrder.findIndex((r) => r.combatantId === "spider");
  // rng() → d20 = floor(rng*20)+1, so (d20-1)/20 rolls exactly d20.
  c.rng = () => (d20 - 1) / 20;
  const before = combat.log.length;
  combat.castMonsterSpell(0, "hero");
  return { hero, lines: combat.log.slice(before) };
}

describe("monster status spell saving throws", () => {
  it("a failed save says so, then the poison lands", () => {
    const { hero, lines } = setup(7, 12); // 7 + 1 = 8 < 12
    expect(lines).toEqual([
      "Giant Spider casts Venom Bite at Cameron!",
      "Cameron fails to resist the Venom Bite. (CON save 7+1=8 vs DC 12)",
      "Cameron is poisoned!",
    ]);
    expect(findEffect(hero, "poisoned")).toBeDefined();
  });

  it("meeting the DC resists and no poison lands", () => {
    const { hero, lines } = setup(11, 12); // 11 + 1 = 12 >= 12
    expect(lines).toEqual([
      "Giant Spider casts Venom Bite at Cameron!",
      "Cameron resists the Venom Bite! (CON save 11+1=12 vs DC 12)",
    ]);
    expect(findEffect(hero, "poisoned")).toBeUndefined();
  });

  it("a negative modifier is shown and counts", () => {
    const { hero, lines } = setup(12, 8); // 12 - 1 = 11 < 12
    expect(lines[1]).toBe("Cameron fails to resist the Venom Bite. (CON save 12-1=11 vs DC 12)");
    expect(findEffect(hero, "poisoned")).toBeDefined();
  });

  it("sleep spells save on WIS", () => {
    const { hero, lines } = setup(15, 10, { type: "sleep", name: "Web", max_target_hp: 99 });
    expect(lines[1]).toBe("Cameron resists the Web! (WIS save 15+0=15 vs DC 12)");
    expect(findEffect(hero, "sleep")).toBeUndefined();
  });

  it("poison-immune targets don't roll", () => {
    const { lines } = setup(1, 10, {}, { passives: [{ type: "poison_immunity" } as never] });
    expect(lines).toEqual([
      "Giant Spider casts Venom Bite at Cameron!",
      "Cameron is immune to poison.",
    ]);
  });
});
