import { describe, it, expect } from "vitest";
import {
  awardQuestXpToSavedMembers,
  awardQuestXpWithLevelUps,
  type QuestXpCharacterRef,
} from "./awardQuestXp";
import type { RawClass } from "@/battle/world/Classes";
import type { SavedCharacterState } from "./saveTypes";

/** Minimal SavedCharacterState fixture — every required field plus a
 *  knob for the bits each test wants to vary. */
function makeMember(over: Partial<SavedCharacterState> = {}): SavedCharacterState {
  return {
    id: "hero",
    custom: null,
    hp: 10,
    mp: 0,
    inventory: [],
    effects: [],
    ...over,
  };
}

describe("awardQuestXpToSavedMembers", () => {
  it("returns input untouched (changed=false) when xp is 0", () => {
    const members = [makeMember({ exp: 100 })];
    const { nextMembers, changed } = awardQuestXpToSavedMembers(members, 0);
    expect(changed).toBe(false);
    expect(nextMembers[0].exp).toBe(100);
    // Defensive: returned objects are fresh copies (callers can
    // commit straight to a save without worrying about shared refs).
    expect(nextMembers[0]).not.toBe(members[0]);
  });

  it("returns input untouched (changed=false) when xp is negative or NaN", () => {
    const members = [makeMember({ exp: 50 })];
    expect(awardQuestXpToSavedMembers(members, -10).changed).toBe(false);
    expect(awardQuestXpToSavedMembers(members, NaN).changed).toBe(false);
  });

  it("treats Infinity / -Infinity as no-op (Number.isFinite guard)", () => {
    // Wouldn't happen from authored quest data, but a malformed
    // module shouldn't be able to silently grant an infinite-XP
    // award and bork the save's number serialisation.
    const members = [makeMember({ exp: 50 })];
    expect(awardQuestXpToSavedMembers(members, Infinity).changed).toBe(false);
    expect(awardQuestXpToSavedMembers(members, -Infinity).changed).toBe(false);
  });

  it("banks xp onto an alive member's existing exp", () => {
    const members = [makeMember({ exp: 100 })];
    const { nextMembers, changed } = awardQuestXpToSavedMembers(members, 250);
    expect(changed).toBe(true);
    expect(nextMembers[0].exp).toBe(350);
  });

  it("defaults absent exp to 0 before adding (legacy-save case)", () => {
    // exp omitted from the saved record — should be treated as 0,
    // not coerced to NaN.
    const members = [makeMember({ exp: undefined })];
    const { nextMembers } = awardQuestXpToSavedMembers(members, 75);
    expect(nextMembers[0].exp).toBe(75);
  });

  it("awards the FULL xp to each alive member (no split)", () => {
    // Matches combat's reward semantics — every alive member
    // gets the full quest reward, not a per-member share.
    const members = [
      makeMember({ id: "a", exp: 100 }),
      makeMember({ id: "b", exp: 200 }),
      makeMember({ id: "c", exp: 0 }),
    ];
    const { nextMembers } = awardQuestXpToSavedMembers(members, 500);
    expect(nextMembers.map((m) => m.exp)).toEqual([600, 700, 500]);
  });

  it("skips fallen members (hp <= 0) and doesn't flag the save as changed when no one's alive", () => {
    const members = [
      makeMember({ id: "a", hp: 0, exp: 100 }),
      makeMember({ id: "b", hp: -3, exp: 200 }),
    ];
    const { nextMembers, changed } = awardQuestXpToSavedMembers(members, 500);
    expect(changed).toBe(false);
    expect(nextMembers.map((m) => m.exp)).toEqual([100, 200]);
    // Fresh copies even on skip — caller can still substitute them
    // into a save without aliasing the input list.
    expect(nextMembers[0]).not.toBe(members[0]);
    expect(nextMembers[1]).not.toBe(members[1]);
  });

  it("flags changed=true when at least one member qualifies, even if some are down", () => {
    const members = [
      makeMember({ id: "alive", hp: 5, exp: 100 }),
      makeMember({ id: "down", hp: 0, exp: 100 }),
    ];
    const { nextMembers, changed } = awardQuestXpToSavedMembers(members, 200);
    expect(changed).toBe(true);
    expect(nextMembers[0].exp).toBe(300);
    expect(nextMembers[1].exp).toBe(100);
  });

  it("preserves every other field on the member", () => {
    // Smoke test that the spread doesn't drop fields the helper
    // doesn't care about — inventory, effects, max_hp, level, etc.
    const member = makeMember({
      id: "preserve_me",
      hp: 7,
      mp: 3,
      max_hp: 10,
      max_mp: 5,
      level: 3,
      exp: 100,
      inventory: [{ item: "lockpick", charges: 2 }],
      effects: [{ id: "poison", duration: 5 }],
      equipped: { hands: "club" },
      equipped_durability: { hands: 4, body: null },
    });
    const { nextMembers } = awardQuestXpToSavedMembers([member], 50);
    const out = nextMembers[0];
    expect(out.exp).toBe(150);
    // Everything else carries through.
    expect(out.id).toBe("preserve_me");
    expect(out.hp).toBe(7);
    expect(out.max_hp).toBe(10);
    expect(out.level).toBe(3);
    expect(out.inventory).toEqual([{ item: "lockpick", charges: 2 }]);
    expect(out.effects).toEqual([{ id: "poison", duration: 5 }]);
    expect(out.equipped).toEqual({ hands: "club" });
    expect(out.equipped_durability).toEqual({ hands: 4, body: null });
  });

  it("does not mutate the input array or its members", () => {
    const original = makeMember({ exp: 100 });
    const members = [original];
    awardQuestXpToSavedMembers(members, 50);
    // Input untouched — caller still sees its baseline.
    expect(original.exp).toBe(100);
    expect(members[0]).toBe(original);
  });
});

// ── Level-up path ───────────────────────────────────────────────────
// Curve facts the tests lean on (defaults seeded by classFromRaw,
// since v2 class records don't carry the leveling fields):
//   exp_per_level = 1500 → level 2 at 1500 total, level 3 at 4500.
//   hp_per_level: fighter 8, cleric 6. mp_per_level: fighter 0,
//   cleric 6 (wisdom-driven). Human race overrides the curve to its
//   races.json exp_per_level.

const RAW_CLASSES: RawClass[] = [
  { id: "fighter", name: "Fighter" },
  { id: "cleric", name: "Cleric" },
];
const RACES = [
  { id: "human", name: "Human", exp_per_level: 1125 },
  { id: "elf", name: "Elf", exp_per_level: null },
];

function makeCharacter(
  over: Partial<QuestXpCharacterRef> = {},
): QuestXpCharacterRef {
  return {
    id: "hero",
    name: "Hero",
    class: "fighter",
    race: "elf",
    hp: 10,
    mp: 0,
    constitution: 14, // +2 mod → fighter hpGain 8+2 = 10
    wisdom: 16, // +3 mod → cleric mpGain 6+3 = 9
    ...over,
  };
}

describe("awardQuestXpWithLevelUps", () => {
  it("levels a member when the banked XP crosses the threshold", () => {
    const members = [makeMember({ level: 1, exp: 0, max_hp: 10, hp: 6 })];
    const { nextMembers, changed, levelUps } = awardQuestXpWithLevelUps(
      members,
      1500,
      [makeCharacter()],
      RAW_CLASSES,
      RACES,
    );
    expect(changed).toBe(true);
    expect(levelUps).toHaveLength(1);
    expect(levelUps[0]).toMatchObject({
      memberId: "hero",
      name: "Hero",
      newLevel: 2,
      hpGain: 10, // 8 + CON mod 2
      mpGain: 0,
    });
    const out = nextMembers[0];
    expect(out.level).toBe(2);
    expect(out.exp).toBe(1500);
    expect(out.max_hp).toBe(20);
    // Wounded member partially heals by the gain (combat parity).
    expect(out.hp).toBe(16);
  });

  it("banks without leveling when the total stays below the threshold", () => {
    const members = [makeMember({ level: 1, exp: 0, max_hp: 10 })];
    const { nextMembers, levelUps } = awardQuestXpWithLevelUps(
      members,
      1499,
      [makeCharacter()],
      RAW_CLASSES,
      RACES,
    );
    expect(levelUps).toHaveLength(0);
    expect(nextMembers[0].level).toBe(1);
    expect(nextMembers[0].exp).toBe(1499);
    expect(nextMembers[0].max_hp).toBe(10);
  });

  it("processes multiple thresholds in one award", () => {
    // 4500 = level 3 total on the default curve (1500 + 3000).
    const members = [makeMember({ level: 1, exp: 0, max_hp: 10, hp: 10 })];
    const { nextMembers, levelUps } = awardQuestXpWithLevelUps(
      members,
      4500,
      [makeCharacter()],
      RAW_CLASSES,
      RACES,
    );
    expect(levelUps.map((e) => e.newLevel)).toEqual([2, 3]);
    expect(nextMembers[0].level).toBe(3);
    expect(nextMembers[0].max_hp).toBe(30); // +10 per level
  });

  it("grants casters MP on level-up (mp_per_level + casting-stat mod)", () => {
    const members = [
      makeMember({ level: 1, exp: 0, max_hp: 10, mp: 4, max_mp: 12 }),
    ];
    const { nextMembers, levelUps } = awardQuestXpWithLevelUps(
      members,
      1500,
      [makeCharacter({ class: "cleric" })],
      RAW_CLASSES,
      RACES,
    );
    expect(levelUps[0].mpGain).toBe(9); // 6 + WIS mod 3
    expect(nextMembers[0].max_mp).toBe(21);
    expect(nextMembers[0].mp).toBe(13);
  });

  it("honours the race exp_per_level override (Humans level faster)", () => {
    const members = [makeMember({ level: 1, exp: 0, max_hp: 10 })];
    const { levelUps } = awardQuestXpWithLevelUps(
      members,
      1125,
      [makeCharacter({ race: "human" })],
      RAW_CLASSES,
      RACES,
    );
    expect(levelUps).toHaveLength(1);
    expect(levelUps[0].newLevel).toBe(2);
  });

  it("falls back to bank-only when the member has no resolvable class", () => {
    // Catalog miss + no custom blob → exp accrues, level untouched
    // (the legacy deferral behaviour rather than guessing a curve).
    const members = [makeMember({ level: 1, exp: 0 })];
    const { nextMembers, levelUps } = awardQuestXpWithLevelUps(
      members,
      5000,
      [], // no catalog entry for "hero"
      RAW_CLASSES,
      RACES,
    );
    expect(levelUps).toHaveLength(0);
    expect(nextMembers[0].exp).toBe(5000);
    expect(nextMembers[0].level).toBe(1);
  });

  it("resolves custom (player-rolled) members via their saved custom blob", () => {
    const members = [
      makeMember({
        id: "__custom_1",
        level: 1,
        exp: 0,
        max_hp: 10,
        custom: makeCharacter({ id: "__custom_1", name: "Rolled" }),
      }),
    ];
    const { nextMembers, levelUps } = awardQuestXpWithLevelUps(
      members,
      1500,
      [], // not in the module catalog — custom members never are
      RAW_CLASSES,
      RACES,
    );
    expect(levelUps).toHaveLength(1);
    expect(levelUps[0].name).toBe("Rolled");
    expect(nextMembers[0].level).toBe(2);
  });

  it("skips fallen members and does not mutate inputs", () => {
    const down = makeMember({ id: "down", hp: 0, exp: 0, level: 1 });
    const original = makeMember({ level: 1, exp: 0, max_hp: 10 });
    const { nextMembers } = awardQuestXpWithLevelUps(
      [down, original],
      1500,
      [makeCharacter(), makeCharacter({ id: "down" })],
      RAW_CLASSES,
      RACES,
    );
    expect(nextMembers[0].exp).toBe(0);
    expect(nextMembers[0].level).toBe(1);
    // Inputs untouched.
    expect(original.exp).toBe(0);
    expect(original.level).toBe(1);
  });
});
