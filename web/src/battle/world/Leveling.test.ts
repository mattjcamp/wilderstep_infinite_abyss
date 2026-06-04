/**
 * Tests for the rising-increment XP curve (Leveling.ts).
 *
 * The curve: cost of level L→L+1 is `L × exp_per_level`, so the
 * cumulative total to reach level N is `exp_per_level × N(N-1)/2`.
 * With the class default of 1500 that's: level 2 at 1,500 total,
 * level 3 at 4,500, level 4 at 9,000, level 10 at 67,500 — keeping
 * fights-per-level roughly flat as monster XP awards rise with
 * difficulty tier. Humans (Fast Learner, exp_per_level 1125) pay
 * 25% less at every level.
 */

import { describe, it, expect } from "vitest";
import {
  awardXp,
  xpForNextLevel,
  xpProgressInLevel,
  xpTotalForLevel,
} from "./Leveling";
import type { PartyMember } from "./Party";
import type { ClassTemplate, RaceInfo } from "./Classes";

const EXP_DEFAULT = 1500; // class default (Classes.ts EXP_PER_LEVEL_DEFAULT)
const EXP_HUMAN = 1125; // races.json human override (fast_learner)

function makeMember(over: Partial<PartyMember> = {}): PartyMember {
  return {
    id: "test_member",
    name: "Testa",
    class: "fighter",
    race: "dwarf",
    gender: "f",
    level: 1,
    exp: 0,
    hp: 10,
    max_hp: 10,
    mp: 0,
    max_mp: 0,
    strength: 10,
    dexterity: 10,
    constitution: 10, // mod 0 → hpGain = hp_per_level exactly
    intelligence: 10,
    wisdom: 10,
    ...over,
  } as PartyMember;
}

function makeClass(over: Partial<ClassTemplate> = {}): ClassTemplate {
  return {
    id: "fighter",
    name: "Fighter",
    range: 5,
    casting_type: [],
    abilities: [],
    hp_per_level: 8,
    mp_per_level: 0,
    exp_per_level: EXP_DEFAULT,
    ...over,
  } as ClassTemplate;
}

const human: RaceInfo = { id: "human", name: "Human", exp_per_level: EXP_HUMAN };

describe("xpTotalForLevel", () => {
  it("is the triangular sum of per-level costs", () => {
    expect(xpTotalForLevel(1, EXP_DEFAULT)).toBe(0);
    expect(xpTotalForLevel(2, EXP_DEFAULT)).toBe(1500);
    expect(xpTotalForLevel(3, EXP_DEFAULT)).toBe(4500);
    expect(xpTotalForLevel(4, EXP_DEFAULT)).toBe(9000);
    expect(xpTotalForLevel(10, EXP_DEFAULT)).toBe(67500);
  });

  it("each increment costs current_level × exp_per_level", () => {
    for (let lvl = 1; lvl < 20; lvl++) {
      const increment =
        xpTotalForLevel(lvl + 1, EXP_DEFAULT) - xpTotalForLevel(lvl, EXP_DEFAULT);
      expect(increment).toBe(lvl * EXP_DEFAULT);
    }
  });
});

describe("xpForNextLevel", () => {
  it("returns the cumulative threshold for the member's next level", () => {
    const tpl = makeClass();
    expect(xpForNextLevel(makeMember({ level: 1 }), tpl, null)).toBe(1500);
    expect(xpForNextLevel(makeMember({ level: 2 }), tpl, null)).toBe(4500);
    expect(xpForNextLevel(makeMember({ level: 9 }), tpl, null)).toBe(67500);
  });

  it("applies the race override when present", () => {
    const tpl = makeClass();
    expect(xpForNextLevel(makeMember({ level: 1 }), tpl, human)).toBe(1125);
    expect(xpForNextLevel(makeMember({ level: 9 }), tpl, human)).toBe(50625);
  });
});

describe("xpProgressInLevel — XP bar math (party screen / character sheet)", () => {
  it("reads as progress within the current level, not the whole curve", () => {
    // Fresh level 1: 0 into 1500.
    expect(xpProgressInLevel(1, 0, EXP_DEFAULT)).toEqual({ into: 0, needed: 1500 });
    // Just hit level 2 (1500 total): bar resets to 0 of 3000.
    expect(xpProgressInLevel(2, 1500, EXP_DEFAULT)).toEqual({ into: 0, needed: 3000 });
    // Midway through level 3 (total 4500 + 2000 of the 4500 needed).
    expect(xpProgressInLevel(3, 6500, EXP_DEFAULT)).toEqual({ into: 2000, needed: 4500 });
  });

  it("agrees with awardXp's thresholds (bar full exactly at level-up)", () => {
    const tpl = makeClass();
    const m = makeMember();
    awardXp(m, 4499, tpl, null); // one shy of level 3
    const p = xpProgressInLevel(m.level, m.exp, EXP_DEFAULT);
    expect(m.level).toBe(2);
    expect(p.needed - p.into).toBe(1); // 1 XP from a full bar
  });

  it("clamps stale saves from the old flat curve instead of going negative", () => {
    // A save written under the old curve can hold less exp than the
    // new cumulative floor for its level (e.g. level 5 at 6000 exp;
    // the new floor for level 5 is 15000). The bar clamps to 0.
    expect(xpProgressInLevel(5, 6000, EXP_DEFAULT)).toEqual({ into: 0, needed: 7500 });
  });

  it("floors needed at 1 to keep bar fill math divide-safe", () => {
    expect(xpProgressInLevel(1, 0, 0).needed).toBe(1);
  });
});

describe("awardXp — rising increment pacing", () => {
  it("levels up exactly at each cumulative threshold", () => {
    const tpl = makeClass();
    const m = makeMember();

    expect(awardXp(m, 1499, tpl, null)).toHaveLength(0);
    expect(m.level).toBe(1);

    const events = awardXp(m, 1, tpl, null); // exp now exactly 1500
    expect(events).toHaveLength(1);
    expect(m.level).toBe(2);

    // Next level needs 3000 more (2 × 1500), not another 1500.
    expect(awardXp(m, 2999, tpl, null)).toHaveLength(0);
    expect(m.level).toBe(2);
    expect(awardXp(m, 1, tpl, null)).toHaveLength(1);
    expect(m.level).toBe(3);
  });

  it("processes multiple level-ups from one large award sequentially", () => {
    const tpl = makeClass();
    const m = makeMember();
    // 9000 total = exactly level 4 (1500 + 3000 + 4500).
    const events = awardXp(m, 9000, tpl, null);
    expect(events.map((e) => e.newLevel)).toEqual([2, 3, 4]);
    expect(m.level).toBe(4);
    expect(m.max_hp).toBe(10 + 3 * 8); // hp_per_level 8, CON mod 0
  });

  it("does not let a level-7 party level off a single deadly encounter", () => {
    // Under the old flat curve a ~1000 XP encounter was a full level
    // at any level. Now level 7→8 costs 10,500.
    const tpl = makeClass();
    const m = makeMember({ level: 7, exp: xpTotalForLevel(7, EXP_DEFAULT) });
    expect(awardXp(m, 1000, tpl, null)).toHaveLength(0);
    expect(m.level).toBe(7);
  });

  it("Fast Learner humans level ~25% faster at every level", () => {
    const tpl = makeClass();
    const humanM = makeMember({ race: "human" });
    const dwarfM = makeMember({ race: "dwarf" });

    // 1125 XP: human levels, dwarf doesn't.
    expect(awardXp(humanM, 1125, tpl, human)).toHaveLength(1);
    expect(awardXp(dwarfM, 1125, tpl, null)).toHaveLength(0);

    // The proportional discount holds at high level too:
    // level 9→10 costs the human 9×1125 = 10,125 vs 9×1500 = 13,500.
    const h9 = makeMember({ race: "human", level: 9, exp: xpTotalForLevel(9, EXP_HUMAN) });
    const d9 = makeMember({ race: "dwarf", level: 9, exp: xpTotalForLevel(9, EXP_DEFAULT) });
    expect(awardXp(h9, 10125, tpl, human)).toHaveLength(1);
    expect(awardXp(d9, 10125, tpl, null)).toHaveLength(0);
    expect(awardXp(d9, 3375, tpl, null)).toHaveLength(1); // tops up to 13,500
  });

  it("ignores non-positive awards", () => {
    const tpl = makeClass();
    const m = makeMember({ exp: 1499 });
    expect(awardXp(m, 0, tpl, null)).toHaveLength(0);
    expect(awardXp(m, -50, tpl, null)).toHaveLength(0);
    expect(m.exp).toBe(1499);
  });
});
