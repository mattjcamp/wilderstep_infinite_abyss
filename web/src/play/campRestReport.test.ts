import { describe, expect, it } from "vitest";
import { applyCampRest, campRestReport } from "./campRest";
import type { SavedCharacterState } from "./saveTypes";

const m = (id: string, hp: number, mp: number, max_hp: number, max_mp: number) =>
  ({ id, custom: null, hp, mp, max_hp, max_mp, inventory: [] }) as unknown as SavedCharacterState;

describe("campRestReport", () => {
  it("reports HP / MP restored per member, names from the lookup", () => {
    const before = [m("a", 4, 0, 10, 6), m("b", 10, 6, 10, 6), m("c", 0, 2, 8, 4)];
    const after = applyCampRest(before, () => undefined, () => undefined).nextMembers;
    const r = campRestReport(before, after, true, (id) =>
      id === "a" ? { name: "Aria", sprite: "person/a.png" } : undefined,
    );
    expect(r.sleptToMorning).toBe(true);
    expect(r.lines).toEqual([
      { id: "a", name: "Aria", sprite: "person/a.png", hpGained: 6, mpGained: 6, hp: 10, maxHp: 10, mp: 6, maxMp: 6, fallen: false },
      { id: "b", name: "b", sprite: undefined, hpGained: 0, mpGained: 0, hp: 10, maxHp: 10, mp: 6, maxMp: 6, fallen: false },
      { id: "c", name: "c", sprite: undefined, hpGained: 0, mpGained: 0, hp: 0, maxHp: 8, mp: 2, maxMp: 4, fallen: true },
    ]);
  });
});
