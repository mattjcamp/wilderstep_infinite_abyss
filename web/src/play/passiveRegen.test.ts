import { describe, expect, it } from "vitest";
import { applyPassiveRegen, regenHasEffect } from "./passiveRegen";

const rate = { hp: 1, mp: 1 };

describe("applyPassiveRegen", () => {
  it("heals living members by the rate, capped at max", () => {
    const members = [
      { hp: 10, mp: 3, max_hp: 20, max_mp: 8 }, // gains both
      { hp: 20, mp: 8, max_hp: 20, max_mp: 8 }, // already full → no change
    ];
    const { nextMembers, changed } = applyPassiveRegen(members, rate);
    expect(changed).toBe(true);
    expect(nextMembers[0]).toMatchObject({ hp: 11, mp: 4 });
    expect(nextMembers[1]).toMatchObject({ hp: 20, mp: 8 });
  });

  it("clamps to max (never overshoots)", () => {
    const members = [{ hp: 19, mp: 8, max_hp: 20, max_mp: 8 }];
    const { nextMembers } = applyPassiveRegen(members, { hp: 5, mp: 5 });
    expect(nextMembers[0]).toMatchObject({ hp: 20, mp: 8 });
  });

  it("never revives downed members (hp <= 0)", () => {
    const members = [{ hp: 0, mp: 0, max_hp: 20, max_mp: 8 }];
    const { nextMembers, changed } = applyPassiveRegen(members, rate);
    expect(changed).toBe(false);
    expect(nextMembers[0]).toMatchObject({ hp: 0, mp: 0 });
  });

  it("leaves a stat alone when its max is unknown", () => {
    const members = [{ hp: 5, mp: 2, max_hp: 10 }]; // no max_mp
    const { nextMembers } = applyPassiveRegen(members, rate);
    expect(nextMembers[0]).toMatchObject({ hp: 6, mp: 2 }); // mp untouched
  });

  it("reports no change when everyone is full", () => {
    const members = [{ hp: 20, mp: 8, max_hp: 20, max_mp: 8 }];
    const { changed } = applyPassiveRegen(members, rate);
    expect(changed).toBe(false);
  });

  it("is a no-op for a zero rate", () => {
    const members = [{ hp: 5, mp: 2, max_hp: 20, max_mp: 8 }];
    const { changed } = applyPassiveRegen(members, { hp: 0, mp: 0 });
    expect(changed).toBe(false);
  });
});

describe("regenHasEffect", () => {
  it("is true only when a rate heals something", () => {
    expect(regenHasEffect({ hp: 1, mp: 0 })).toBe(true);
    expect(regenHasEffect({ hp: 0, mp: 2 })).toBe(true);
    expect(regenHasEffect({ hp: 0, mp: 0 })).toBe(false);
    expect(regenHasEffect(null)).toBe(false);
    expect(regenHasEffect(undefined)).toBe(false);
  });
});
