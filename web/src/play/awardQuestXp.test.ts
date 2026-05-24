import { describe, it, expect } from "vitest";
import { awardQuestXpToSavedMembers } from "./awardQuestXp";
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
