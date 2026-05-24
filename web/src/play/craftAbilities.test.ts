import { describe, it, expect } from "vitest";
import {
  attemptCraft,
  canCraft,
  craftStockFor,
  findAliveMemberOfClass,
} from "./craftAbilities";
import type { RaceAbilityCharacterRef } from "./raceAbilities";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "./saveTypes";
import type { StackableItemRef } from "./inventoryStacking";

/** Compact saved-member fixture — only the fields the helpers
 *  read (id + hp) carry meaningful values. */
function savedMember(over: Partial<SavedCharacterState> = {}): SavedCharacterState {
  return {
    id: "?",
    custom: null,
    hp: 10,
    mp: 0,
    inventory: [],
    effects: [],
    ...over,
  };
}

function makeSave(
  partyOver: Partial<SavedPartyState> = {},
  members: SavedCharacterState[] = [savedMember({ id: "p1" })],
): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: "2024-01-01T00:00:00Z",
    moduleId: "test",
    clockMinutes: 0,
    party: {
      currentMapId: "world",
      col: 0,
      row: 0,
      avatar: "",
      gold: 0,
      inventory: [],
      torch_steps: 0,
      galadriels_light_steps: 0,
      infravision_active: false,
      onBoat: false,
      currentBoatSprite: null,
      roster: members.map((m) => m.id),
      members,
      ...partyOver,
    },
    maps: {},
  };
}

const RANGER_HERO: RaceAbilityCharacterRef & { class?: string } = {
  id: "p1",
  name: "Aldric",
  race: "human",
  class: "ranger",
};

const FIGHTER_HERO: RaceAbilityCharacterRef & { class?: string } = {
  id: "p1",
  name: "Brenna",
  race: "human",
  class: "fighter",
};

function makeItems(): StackableItemRef[] {
  // `charges` on a stackable catalog entry is the per-bundle pay-out
  // count (matches items.json: arrows/bolts/fire_arrows = 20). The
  // craft helper reads this through `craftBundleSize` so a successful
  // craft adds a full bundle, just like a shop purchase.
  return [
    { id: "arrows", stackable: true, charges: 20 },
    { id: "bolts", stackable: true, charges: 20 },
    { id: "fire_arrows", stackable: true, charges: 20 },
    // Noise items the picker should never offer for either ability.
    { id: "torch", stackable: true, charges: 1 },
    { id: "lockpick", stackable: true, charges: 5 },
  ];
}

describe("craftStockFor", () => {
  it("returns arrows + bolts for craft_arrows", () => {
    expect(craftStockFor("craft_arrows")).toEqual(["arrows", "bolts"]);
  });

  it("returns fire_arrows for craft_fire_arrows", () => {
    expect(craftStockFor("craft_fire_arrows")).toEqual(["fire_arrows"]);
  });

  it("returns an empty list for unknown ids (defensive)", () => {
    expect(craftStockFor("craft_chaos_bombs")).toEqual([]);
  });
});

describe("findAliveMemberOfClass", () => {
  it("returns the first alive member whose class matches (case-insensitive)", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(
      findAliveMemberOfClass(save, [RANGER_HERO], "Ranger"),
    ).toEqual({ id: "p1", name: "Aldric" });
    expect(
      findAliveMemberOfClass(save, [RANGER_HERO], "ranger"),
    ).toEqual({ id: "p1", name: "Aldric" });
  });

  it("skips fallen members", () => {
    const save = makeSave({}, [savedMember({ id: "p1", hp: 0 })]);
    expect(findAliveMemberOfClass(save, [RANGER_HERO], "ranger")).toBeNull();
  });

  it("returns null when no member matches the class", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(findAliveMemberOfClass(save, [FIGHTER_HERO], "ranger")).toBeNull();
  });
});

describe("canCraft", () => {
  it("true when an alive Ranger is in the party and the day-gate is fresh", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(canCraft(save, [RANGER_HERO], "ranger", "craft_arrows", 5)).toBe(
      true,
    );
  });

  it("false when no Ranger is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(canCraft(save, [FIGHTER_HERO], "ranger", "craft_arrows", 5)).toBe(
      false,
    );
  });

  it("false when the Ranger already used THIS ability today", () => {
    const save = makeSave(
      { last_ability_day: { craft_arrows: 5 } },
      [savedMember({ id: "p1" })],
    );
    expect(canCraft(save, [RANGER_HERO], "ranger", "craft_arrows", 5)).toBe(
      false,
    );
  });

  it("each craft ability ticks against its own day counter (independent)", () => {
    // Used craft_arrows today; craft_fire_arrows should still be
    // available because it has its own counter.
    const save = makeSave(
      { last_ability_day: { craft_arrows: 5 } },
      [savedMember({ id: "p1" })],
    );
    expect(canCraft(save, [RANGER_HERO], "ranger", "craft_arrows", 5)).toBe(
      false,
    );
    expect(
      canCraft(save, [RANGER_HERO], "ranger", "craft_fire_arrows", 5),
    ).toBe(true);
  });

  it("becomes true again on the next in-game day", () => {
    const save = makeSave(
      { last_ability_day: { craft_arrows: 5 } },
      [savedMember({ id: "p1" })],
    );
    expect(canCraft(save, [RANGER_HERO], "ranger", "craft_arrows", 6)).toBe(
      true,
    );
  });
});

describe("attemptCraft — craft_arrows", () => {
  it("refuses when no Ranger is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptCraft(
      save,
      [FIGHTER_HERO],
      makeItems(),
      "ranger",
      "craft_arrows",
      "arrows",
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no ranger/i);
  });

  it("refuses when craft_arrows was already used today", () => {
    const save = makeSave(
      { last_ability_day: { craft_arrows: 5 } },
      [savedMember({ id: "p1" })],
    );
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_arrows",
      "arrows",
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already used this ability today/i);
  });

  it("refuses when the requested item isn't in the craft_arrows stock", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_arrows",
      "fire_arrows", // fire arrows aren't in THIS ability's stock
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/isn't something this ability can craft/i);
  });

  it("on success, adds a bundle of Arrows + stamps last_ability_day", () => {
    const save = makeSave(
      { inventory: [{ item: "arrows", charges: 5 }] },
      [savedMember({ id: "p1" })],
    );
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_arrows",
      "arrows",
      5,
    );
    expect(r.ok).toBe(true);
    // Stack-merged on the existing row: 5 + a full bundle of 20.
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "arrows", charges: 25 },
    ]);
    expect(r.nextSave!.party.last_ability_day).toEqual({
      craft_arrows: 5,
    });
    // Player-facing message names the bundle size so the craft / shop
    // parity is visible.
    expect(r.message).toMatch(/bundle of 20/i);
  });

  it("on success with Bolts, the same path commits the day for craft_arrows", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_arrows",
      "bolts",
      5,
    );
    expect(r.ok).toBe(true);
    // Fresh row at bundle size (20), not the legacy "+1 per craft".
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "bolts", charges: 20 },
    ]);
    expect(r.nextSave!.party.last_ability_day?.craft_arrows).toBe(5);
    // Important: craft_fire_arrows counter is NOT touched —
    // independence between ability counters.
    expect(r.nextSave!.party.last_ability_day?.craft_fire_arrows).toBeUndefined();
  });
});

describe("attemptCraft — craft_fire_arrows", () => {
  it("refuses regular arrows (not in the fire stock)", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_fire_arrows",
      "arrows",
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/isn't something this ability can craft/i);
  });

  it("succeeds with fire_arrows + stamps the right ability counter", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_fire_arrows",
      "fire_arrows",
      5,
    );
    expect(r.ok).toBe(true);
    // Fire Arrows craft pays out the same bundle-of-20 the shop does.
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "fire_arrows", charges: 20 },
    ]);
    expect(r.nextSave!.party.last_ability_day).toEqual({
      craft_fire_arrows: 5,
    });
  });

  it("preserves the existing last_ability_day entries when adding the new one", () => {
    // Player used Craft Arrows earlier in the day, now uses Craft
    // Fire Arrows — both counters should coexist on the same save.
    const save = makeSave(
      { last_ability_day: { craft_arrows: 5 } },
      [savedMember({ id: "p1" })],
    );
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_fire_arrows",
      "fire_arrows",
      5,
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.last_ability_day).toEqual({
      craft_arrows: 5,
      craft_fire_arrows: 5,
    });
  });

  it("falls back to a single item when the catalog has no bundle size", () => {
    // Defensive: if a future ability's stock item lacks the bundle
    // `charges` field (or is mistakenly non-stackable), the craft
    // should still pay out — just one item, not zero — so the picker
    // doesn't silently swallow the day-counter use.
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const itemsNoBundle: StackableItemRef[] = [
      { id: "fire_arrows", stackable: true }, // no charges → falls back to 1
    ];
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      itemsNoBundle,
      "ranger",
      "craft_fire_arrows",
      "fire_arrows",
      5,
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "fire_arrows", charges: 1 },
    ]);
    // Single-item message omits the "bundle of N" phrasing so the
    // line reads naturally.
    expect(r.message).not.toMatch(/bundle of/i);
  });

  it("the same craft ability succeeds again the NEXT day", () => {
    const save = makeSave(
      { last_ability_day: { craft_fire_arrows: 5 } },
      [savedMember({ id: "p1" })],
    );
    const r = attemptCraft(
      save,
      [RANGER_HERO],
      makeItems(),
      "ranger",
      "craft_fire_arrows",
      "fire_arrows",
      6,
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.last_ability_day?.craft_fire_arrows).toBe(6);
  });
});
