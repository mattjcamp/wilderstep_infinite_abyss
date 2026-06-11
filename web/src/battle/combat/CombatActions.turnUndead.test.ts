/**
 * Turn Undead vs elite undead (`turn_resistance`).
 *
 * Balance rules under test:
 *   1. Lesser undead (no turn_resistance) that fail the save are
 *      destroyed outright — unchanged legacy behaviour.
 *   2. turn_resistance is added to the save roll, so elites save
 *      far more often.
 *   3. An elite that FAILS the save is never destroyed: it takes the
 *      same hp_percent searing a successful save deals, and is
 *      TURNED — `turnedTurns` (1d4) is stamped on the combatant so
 *      the AI flees / cowers instead of acting.
 *   4. If that searing damage itself drops the elite, it dies
 *      normally (killed: true) and no turned state is left behind.
 */

import { describe, it, expect } from "vitest";
import { resolveTurnUndead } from "./CombatActions";
import type { Combatant } from "../types";

/** Queue-based RNG — each call shifts the next value. Values are the
 *  raw [0,1) floats resolveTurnUndead feeds to Math.floor(x*N)+1. */
function rngQueue(...values: number[]) {
  const q = [...values];
  return () => q.shift() ?? 0.999;
}

/** Raw d20 face → the [0,1) float that produces it. */
const d20 = (face: number) => (face - 0.5) / 20;
/** Raw d4 face → the [0,1) float that produces it. */
const d4 = (face: number) => (face - 0.5) / 4;

function undead(over: Partial<Combatant>): Combatant {
  const base = {
    id: "u", name: "Undead", side: "enemies", sprite: "",
    hp: 60, maxHp: 60, ac: 12, attackBonus: 4, dexMod: 0,
    damage: { dice: 1, sides: 6, bonus: 0 },
    position: { col: 5, row: 5 },
    wisdom: 10,
    undead: true,
    color: [0, 0, 0],
    baseMoveRange: 3,
  } as unknown as Combatant;
  return { ...base, ...over };
}

// caster WIS mod +4 → save DC 14 with the default base of 10.
const params = { hp_percent: 0.5, save_dc_base: 10 };

describe("resolveTurnUndead — turn_resistance", () => {
  it("destroys a lesser undead (no resistance) on a failed save", () => {
    const skeleton = undead({ id: "sk", name: "Skeleton" });
    // d20 = 10, +0 WIS mod → 10 < DC 14 → destroyed.
    const r = resolveTurnUndead([skeleton], params, 4, rngQueue(d20(10)));
    const o = r.outcomes[0];
    expect(o.saved).toBe(false);
    expect(o.turned).toBe(false);
    expect(o.killed).toBe(true);
    expect(skeleton.hp).toBe(0);
  });

  it("adds turn_resistance to the save roll so the same dice now save", () => {
    const vampire = undead({ id: "v", name: "Vampire", turnResistance: 4 });
    // d20 = 10, +0 WIS mod, +4 resistance → 14 ≥ DC 14 → saved.
    const r = resolveTurnUndead([vampire], params, 4, rngQueue(d20(10)));
    const o = r.outcomes[0];
    expect(o.saved).toBe(true);
    expect(o.saveBonus).toBe(4);
    expect(o.saveTotal).toBe(14);
    // Saved → 50% maxHp searing, alive.
    expect(o.damage).toBe(30);
    expect(vampire.hp).toBe(30);
  });

  it("TURNS a resistant elite on a failed save instead of destroying it", () => {
    const vampire = undead({ id: "v", name: "Vampire", turnResistance: 4 });
    // d20 = 5 → 5+4 = 9 < DC 14 → failed, but resistance > 0 → turned.
    // Second rng value drives the 1d4 turned duration (face 3).
    const r = resolveTurnUndead(
      [vampire], params, 4, rngQueue(d20(5), d4(3)),
    );
    const o = r.outcomes[0];
    expect(o.saved).toBe(false);
    expect(o.killed).toBe(false);
    expect(o.turned).toBe(true);
    expect(o.turnedTurns).toBe(3);
    // Same searing as a successful save — NOT instant destruction.
    expect(o.damage).toBe(30);
    expect(vampire.hp).toBe(30);
    expect(vampire.turnedTurns).toBe(3);
  });

  it("lets the searing kill an already-wounded elite (no turned state on a corpse)", () => {
    const vampire = undead({
      id: "v", name: "Vampire", turnResistance: 4, hp: 10,
    });
    // d20 = 5 → fail. 50% of 60 = 30 damage ≥ 10 hp → dead.
    const r = resolveTurnUndead(
      [vampire], params, 4, rngQueue(d20(5), d4(2)),
    );
    const o = r.outcomes[0];
    expect(o.killed).toBe(true);
    expect(o.turned).toBe(false);
    expect(o.turnedTurns).toBe(0);
    expect(vampire.hp).toBe(0);
    expect(vampire.turnedTurns).toBeUndefined();
  });

  it("still destroys a lesser undead even when an elite stands beside it", () => {
    const skeleton = undead({ id: "sk", name: "Skeleton" });
    const vampire = undead({ id: "v", name: "Vampire", turnResistance: 6 });
    // Both roll d20 = 5 → both fail (5 < 14; 5+6 = 11 < 14).
    const r = resolveTurnUndead(
      [skeleton, vampire], params, 4, rngQueue(d20(5), d20(5), d4(1)),
    );
    const oSk = r.outcomes.find((o) => o.targetId === "sk")!;
    const oV = r.outcomes.find((o) => o.targetId === "v")!;
    expect(oSk.killed).toBe(true);
    expect(skeleton.hp).toBe(0);
    expect(oV.turned).toBe(true);
    expect(vampire.hp).toBe(30);
    expect(vampire.turnedTurns).toBe(1);
  });
});
