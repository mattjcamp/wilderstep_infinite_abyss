import { describe, expect, it } from "vitest";
import { curePoison, tickPoisonOnStep } from "./memberEffects";
import type { SavedCharacterState } from "./saveTypes";

const m = (hp: number, duration?: number): SavedCharacterState =>
  ({
    id: "pip",
    custom: null,
    hp,
    mp: 0,
    inventory: [],
    effects: duration === undefined ? [] : [{ id: "poisoned", duration }],
  }) as unknown as SavedCharacterState;

const opts = { damagePerTick: 2, nameOf: () => "Pip" };

describe("tickPoisonOnStep", () => {
  it("does nothing when nobody is poisoned", () => {
    const r = tickPoisonOnStep([m(10)], opts);
    expect(r.changed).toBe(false);
    expect(r.lines).toEqual([]);
  });
  it("counts steps down and bites every 10 steps", () => {
    let r = tickPoisonOnStep([m(10, 12)], opts);
    expect(r.members[0].hp).toBe(10);
    expect(r.members[0].effects).toEqual([{ id: "poisoned", duration: 11 }]);
    r = tickPoisonOnStep(r.members, opts); // 11 → 10: bite
    expect(r.members[0].hp).toBe(8);
    expect(r.lines).toEqual(["Pip suffers from poison (-2 HP)."]);
    for (let i = 0; i < 9; i++) r = tickPoisonOnStep(r.members, opts); // → 1
    expect(r.members[0].hp).toBe(8);
  });
  it("never kills on the map and wears off with a line", () => {
    const r = tickPoisonOnStep([m(2, 1)], opts);
    expect(r.members[0].hp).toBe(1);
    expect(r.members[0].effects).toEqual([]);
    expect(r.lines).toEqual(["Pip suffers from poison (-1 HP).", "Pip is no longer poisoned."]);
    const r2 = tickPoisonOnStep([m(1, 10)], opts);
    expect(r2.members[0].hp).toBe(1);
    expect(r2.lines).toEqual([]);
  });
});

describe("curePoison", () => {
  it("removes poison or returns null", () => {
    expect(curePoison(m(5, 30))?.effects).toEqual([]);
    expect(curePoison(m(5))).toBeNull();
  });
});
