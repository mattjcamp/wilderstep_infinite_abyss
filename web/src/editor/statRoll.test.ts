import { describe, it, expect } from "vitest";
import { classStatWeights, keyStatsFor, rollStats, ROLL_STAT_KEYS } from "./statRoll";

const RULES = { min: 8, max: 18, bonus: 15 };

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("rollStats", () => {
  it("always spends exactly the bonus within min/max", () => {
    for (let s = 1; s < 200; s++) {
      const r = rollStats(classStatWeights({ id: "fighter" }), RULES, seeded(s));
      const sum = ROLL_STAT_KEYS.reduce((n, k) => n + r[k], 0);
      expect(sum).toBe(8 * 5 + 15);
      for (const k of ROLL_STAT_KEYS) {
        expect(r[k]).toBeGreaterThanOrEqual(8);
        expect(r[k]).toBeLessThanOrEqual(18);
      }
    }
  });

  it("leans toward the class's key stats on average", () => {
    const avg = (id: string, k: (typeof ROLL_STAT_KEYS)[number]) => {
      let n = 0;
      for (let s = 1; s <= 300; s++) n += rollStats(classStatWeights({ id }), RULES, seeded(s))[k];
      return n / 300;
    };
    expect(avg("fighter", "strength")).toBeGreaterThan(avg("fighter", "intelligence") + 3);
    expect(avg("wizard", "intelligence")).toBeGreaterThan(avg("wizard", "strength") + 3);
    expect(avg("cleric", "wisdom")).toBeGreaterThan(avg("cleric", "intelligence") + 3);
    expect(avg("thief", "dexterity")).toBeGreaterThan(avg("thief", "wisdom") + 2);
  });

  it("varies between rolls", () => {
    const a = rollStats(classStatWeights({ id: "ranger" }), RULES, seeded(1));
    const b = rollStats(classStatWeights({ id: "ranger" }), RULES, seeded(99));
    expect(a).not.toEqual(b);
  });

  it("derives weights for an unknown class from its record", () => {
    expect(classStatWeights({ id: "shaman", casting_type: ["priest"] }).wisdom).toBe(5);
    expect(classStatWeights({ id: "scout", casting_type: ["none"], range: 6 }).dexterity).toBe(5);
    expect(classStatWeights({ id: "brute", casting_type: ["none"] }).strength).toBe(5);
  });
});

describe("keyStatsFor", () => {
  it("badges up to two stats that matter", () => {
    const k = (id: string) => keyStatsFor(classStatWeights({ id }));
    expect(k("fighter")).toEqual(["strength", "constitution"]);
    expect(k("paladin")).toEqual(["strength", "wisdom"]);
    expect(k("ranger")).toEqual(["dexterity", "wisdom"]);
    expect(k("wizard")).toEqual(["intelligence"]);
    expect(k("druid")).toEqual(["intelligence", "wisdom"]);
  });
});
