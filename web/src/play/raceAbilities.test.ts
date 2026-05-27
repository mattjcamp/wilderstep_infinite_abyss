import { describe, it, expect } from "vitest";
import {
  attemptPickpocket,
  attemptTinker,
  canPickpocket,
  canTinker,
  findAliveMemberOfRace,
  generalStockFor,
  type RaceAbilityCharacterRef,
  type RaceAbilityCounterRef,
} from "./raceAbilities";
import { mulberry32 } from "@/battle/rng";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "./saveTypes";
import type { StackableItemRef } from "./inventoryStacking";

/** Compact saved-member fixture — only the fields these helpers
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

/** Build a WorldSave shape sufficient to drive the helpers. */
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

const HALFLING_HERO: RaceAbilityCharacterRef = {
  id: "p1",
  name: "Pip",
  race: "halfling",
};

const HUMAN_HERO: RaceAbilityCharacterRef = {
  id: "p1",
  name: "Aldric",
  race: "human",
};

const GNOME_HERO: RaceAbilityCharacterRef = {
  id: "p1",
  name: "Fizwick",
  race: "gnome",
};

/** Items catalog stub — only the ids the loot table / tinker stock
 *  reference need to be stackable to exercise the stack-merging
 *  branch. The PICKPOCKET_LOOT items the play side declares are
 *  the union of these ids. */
function makeItems(): StackableItemRef[] {
  return [
    { id: "torch", stackable: true },
    { id: "arrows", stackable: true },
    { id: "healing_herb", stackable: true },
    { id: "antidote", stackable: true },
    { id: "lockpick", stackable: true },
    { id: "mana_potion", stackable: true },
    { id: "stones", stackable: true },
    { id: "smoke_bomb", stackable: true },
    { id: "holy_water", stackable: true },
    // Dagger is non-stackable in the shipped items.json.
    { id: "dagger", stackable: false },
  ];
}

function makeCounters(): RaceAbilityCounterRef[] {
  return [
    {
      id: "general",
      items: [
        "torch",
        "torch",
        "lockpick",
        "lockpick",
        "healing_herb",
        "arrows",
        // intentional duplicate so the dedupe path runs:
        "arrows",
        "dagger",
      ],
    },
    {
      id: "potion_shop",
      items: ["mana_potion", "healing_potion"],
    },
  ];
}

describe("findAliveMemberOfRace", () => {
  it("returns the first alive member whose race matches (case-insensitive)", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(
      findAliveMemberOfRace(save, [HALFLING_HERO], "Halfling"),
    ).toEqual({ id: "p1", name: "Pip" });
    expect(
      findAliveMemberOfRace(save, [HALFLING_HERO], "halfling"),
    ).toEqual({ id: "p1", name: "Pip" });
  });

  it("skips fallen members (hp <= 0)", () => {
    const save = makeSave({}, [savedMember({ id: "p1", hp: 0 })]);
    expect(findAliveMemberOfRace(save, [HALFLING_HERO], "halfling")).toBeNull();
  });

  it("returns null when no member matches the race", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(findAliveMemberOfRace(save, [HUMAN_HERO], "halfling")).toBeNull();
  });

  it("returns null when the member's catalog entry is missing", () => {
    // Members list has p1; catalog doesn't carry p1 → no race lookup.
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(findAliveMemberOfRace(save, [], "halfling")).toBeNull();
  });
});

// ── Pickpocket ────────────────────────────────────────────────────

describe("canPickpocket", () => {
  it("true when a Halfling is alive and the NPC is fresh", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(canPickpocket(save, [HALFLING_HERO], "blacksmith")).toBe(true);
  });

  it("false when no Halfling is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(canPickpocket(save, [HUMAN_HERO], "blacksmith")).toBe(false);
  });

  it("false when the NPC was already pickpocketed", () => {
    const save = makeSave(
      { pickpocketedNpcs: ["blacksmith"] },
      [savedMember({ id: "p1" })],
    );
    expect(canPickpocket(save, [HALFLING_HERO], "blacksmith")).toBe(false);
    // Other NPCs are still fair game.
    expect(canPickpocket(save, [HALFLING_HERO], "innkeeper")).toBe(true);
  });

  it("false when the Halfling is down (hp <= 0)", () => {
    const save = makeSave({}, [savedMember({ id: "p1", hp: 0 })]);
    expect(canPickpocket(save, [HALFLING_HERO], "blacksmith")).toBe(false);
  });
});

describe("attemptPickpocket", () => {
  it("refuses with a clear message when no Halfling is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptPickpocket(
      save,
      [HUMAN_HERO],
      makeItems(),
      "blacksmith",
      mulberry32(1),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no halfling/i);
    expect(r.nextSave).toBeUndefined();
  });

  it("refuses when the NPC has already been pickpocketed", () => {
    const save = makeSave(
      { pickpocketedNpcs: ["blacksmith"] },
      [savedMember({ id: "p1" })],
    );
    const r = attemptPickpocket(
      save,
      [HALFLING_HERO],
      makeItems(),
      "blacksmith",
      mulberry32(1),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already pickpocketed/i);
  });

  it("on success, adds the NPC id to pickpocketedNpcs", () => {
    // Roll picks a non-gold loot item with this seed — verified by
    // checking the returned save has the marker either way.
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptPickpocket(
      save,
      [HALFLING_HERO],
      makeItems(),
      "blacksmith",
      mulberry32(7),
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.pickpocketedNpcs).toEqual(["blacksmith"]);
  });

  it("on a gold roll, bumps party.gold by 3..15 and DOESN'T touch inventory", () => {
    // Force the "Gold" branch via an RNG whose first call returns 0 —
    // pickWeighted sums 100 across the table, first entry (Gold,
    // weight 25) consumes the [0,25) range. The second rng() call
    // computes the gold amount (3 + floor(rng()*13)).
    const rngs = [0, 0, 0]; // pick gold + amount roll
    let i = 0;
    const rng = () => rngs[i++];
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptPickpocket(
      save,
      [HALFLING_HERO],
      makeItems(),
      "blacksmith",
      rng,
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.gold).toBe(3); // 3 + floor(0*13) = 3
    expect(r.nextSave!.party.inventory).toEqual([]);
    expect(r.message).toMatch(/pilfers 3 gold/);
  });

  it("on an item roll, adds the item to the stash (stack-merging)", () => {
    // RNG whose first call lands in the [25,45) range so the loot
    // pick is "healing_herb" (weight 20, second entry after Gold's
    // 25). 0.30 * 100 = 30 → 30 - 25 = 5 < 20 → healing_herb.
    const rng = () => 0.3;
    const save = makeSave(
      { inventory: [{ item: "healing_herb", charges: 2 }] },
      [savedMember({ id: "p1" })],
    );
    const r = attemptPickpocket(
      save,
      [HALFLING_HERO],
      makeItems(),
      "blacksmith",
      rng,
    );
    expect(r.ok).toBe(true);
    // Stack-merged onto the existing row: 2 + 1 = 3.
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "healing_herb", charges: 3 },
    ]);
    expect(r.nextSave!.party.pickpocketedNpcs).toEqual(["blacksmith"]);
  });

  it("preserves the existing pickpocketedNpcs entries when adding the new one", () => {
    const save = makeSave(
      { pickpocketedNpcs: ["innkeeper"] },
      [savedMember({ id: "p1" })],
    );
    const r = attemptPickpocket(
      save,
      [HALFLING_HERO],
      makeItems(),
      "blacksmith",
      mulberry32(42),
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.pickpocketedNpcs).toEqual([
      "innkeeper",
      "blacksmith",
    ]);
  });
});

// ── Tinker ─────────────────────────────────────────────────────────

describe("canTinker", () => {
  it("true when a Gnome is alive and the party hasn't tinkered today", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(canTinker(save, [GNOME_HERO], 5)).toBe(true);
  });

  it("true when last_tinker_day is strictly earlier than currentDay", () => {
    const save = makeSave({ last_tinker_day: 3 }, [savedMember({ id: "p1" })]);
    expect(canTinker(save, [GNOME_HERO], 4)).toBe(true);
  });

  it("false when the party already tinkered today", () => {
    const save = makeSave({ last_tinker_day: 4 }, [savedMember({ id: "p1" })]);
    expect(canTinker(save, [GNOME_HERO], 4)).toBe(false);
  });

  it("false when no Gnome is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(canTinker(save, [HUMAN_HERO], 4)).toBe(false);
  });
});

describe("generalStockFor", () => {
  it("returns deduped ids from the general counter's items list", () => {
    const stock = generalStockFor(makeCounters());
    // makeCounters has torch x2, lockpick x2, arrows x2; dedupe
    // should leave one of each, preserving first-seen order.
    expect(stock).toEqual([
      "torch",
      "lockpick",
      "healing_herb",
      "arrows",
      "dagger",
    ]);
  });

  it("returns an empty list when the catalog has no general counter", () => {
    expect(generalStockFor([])).toEqual([]);
    expect(
      generalStockFor([{ id: "potion_shop", items: ["healing_potion"] }]),
    ).toEqual([]);
  });
});

describe("attemptTinker", () => {
  it("refuses when no Gnome is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptTinker(
      save,
      [HUMAN_HERO],
      makeCounters(),
      makeItems(),
      "torch",
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no gnome/i);
  });

  it("refuses when the party already tinkered today", () => {
    const save = makeSave({ last_tinker_day: 5 }, [savedMember({ id: "p1" })]);
    const r = attemptTinker(
      save,
      [GNOME_HERO],
      makeCounters(),
      makeItems(),
      "torch",
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already tinkered today/i);
  });

  it("refuses when the requested item isn't in the general store stock", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptTinker(
      save,
      [GNOME_HERO],
      makeCounters(),
      makeItems(),
      "holy_water",
      5,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/isn't something/i);
  });

  it("on success, adds the item and stamps last_tinker_day", () => {
    const save = makeSave(
      { inventory: [{ item: "torch", charges: 1 }] },
      [savedMember({ id: "p1" })],
    );
    const r = attemptTinker(
      save,
      [GNOME_HERO],
      makeCounters(),
      makeItems(),
      "torch",
      5,
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "torch", charges: 2 },
    ]);
    expect(r.nextSave!.party.last_tinker_day).toBe(5);
    expect(r.message).toMatch(/tinkers up/i);
  });

  it("succeeds again the NEXT day after a prior tinker", () => {
    const save = makeSave({ last_tinker_day: 4 }, [savedMember({ id: "p1" })]);
    const r = attemptTinker(
      save,
      [GNOME_HERO],
      makeCounters(),
      makeItems(),
      "lockpick",
      5,
    );
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.last_tinker_day).toBe(5);
  });
});
