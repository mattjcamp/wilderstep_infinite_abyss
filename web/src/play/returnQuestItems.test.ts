import { describe, expect, it } from "vitest";

import { type StackableItemRef } from "./inventoryStacking";
import type { SavedCharacterState, SavedPartyState } from "./saveTypes";
import {
  removeItemsFromLiveParty,
  removeItemsFromSavedParty,
  type LivePartyLike,
} from "./returnQuestItems";

const catalog: StackableItemRef[] = [
  { id: "torch", stackable: true },
  { id: "master_key", stackable: false },
  { id: "sun_sword", stackable: false },
];

function member(
  id: string,
  over: Partial<SavedCharacterState> = {},
): SavedCharacterState {
  return {
    id,
    custom: null,
    hp: 10,
    mp: 0,
    inventory: [],
    effects: [],
    ...over,
  };
}

function party(over: Partial<SavedPartyState> = {}): SavedPartyState {
  return {
    currentMapId: "m",
    col: 0,
    row: 0,
    avatar: "",
    gold: 0,
    inventory: [],
    torch_steps: 0,
    infravision_active: false,
    roster: [],
    members: [],
    ...over,
  };
}

describe("removeItemsFromSavedParty", () => {
  it("removes from the shared stash", () => {
    const p = party({ inventory: [{ item: "master_key" }] });
    const next = removeItemsFromSavedParty(p, ["master_key"], catalog);
    expect(next.inventory).toEqual([]);
  });

  it("removes from a member's personal inventory when not in the stash", () => {
    const p = party({
      inventory: [{ item: "torch", charges: 2 }],
      members: [member("a", { inventory: [{ item: "master_key" }] })],
    });
    const next = removeItemsFromSavedParty(p, ["master_key"], catalog);
    // Stash untouched; the personal copy is gone.
    expect(next.inventory).toEqual([{ item: "torch", charges: 2 }]);
    expect(next.members[0].inventory).toEqual([]);
  });

  it("removes an equipped item as a last resort (and clears durability)", () => {
    const p = party({
      members: [
        member("a", {
          equipped: { hands: "sun_sword" },
          equipped_durability: { hands: 40 },
        }),
      ],
    });
    const next = removeItemsFromSavedParty(p, ["sun_sword"], catalog);
    expect(next.members[0].equipped).toEqual({});
    expect(next.members[0].equipped_durability).toEqual({});
  });

  it("prefers a stash/personal copy over the equipped one", () => {
    const p = party({
      inventory: [{ item: "master_key" }],
      members: [
        member("a", {
          equipped: { hands: "master_key" },
          equipped_durability: { hands: null },
        }),
      ],
    });
    const next = removeItemsFromSavedParty(p, ["master_key"], catalog);
    // The loose stash copy is taken; the equipped one stays.
    expect(next.inventory).toEqual([]);
    expect(next.members[0].equipped).toEqual({ hands: "master_key" });
  });

  it("reclaims only one copy per listed id", () => {
    const p = party({
      inventory: [{ item: "master_key" }],
      members: [member("a", { inventory: [{ item: "master_key" }] })],
    });
    const next = removeItemsFromSavedParty(p, ["master_key"], catalog);
    // One copy removed from the stash; the member keeps theirs.
    expect(next.inventory).toEqual([]);
    expect(next.members[0].inventory).toEqual([{ item: "master_key" }]);
  });

  it("is a no-op (same identity) when nothing matches", () => {
    const p = party({ inventory: [{ item: "torch", charges: 1 }] });
    const next = removeItemsFromSavedParty(p, ["master_key"], catalog);
    expect(next).toBe(p);
  });

  it("does not mutate the input party", () => {
    const p = party({ inventory: [{ item: "master_key" }] });
    removeItemsFromSavedParty(p, ["master_key"], catalog);
    expect(p.inventory).toEqual([{ item: "master_key" }]);
  });
});

describe("removeItemsFromLiveParty", () => {
  function livePartyWithEquipped(): LivePartyLike {
    return {
      inventory: [],
      roster: [
        {
          inventory: [],
          equipped: { hands: "sun_sword", body: null },
          equipped_durability: { hands: 40, body: null },
        },
      ],
    };
  }

  it("clears an equipped slot in place", () => {
    const live = livePartyWithEquipped();
    removeItemsFromLiveParty(live, ["sun_sword"], catalog);
    expect(live.roster[0].equipped.hands).toBeNull();
    expect(live.roster[0].equipped_durability.hands).toBeNull();
  });

  it("decrements a shared stack in place", () => {
    const live: LivePartyLike = {
      inventory: [{ item: "torch", charges: 3 }],
      roster: [],
    };
    removeItemsFromLiveParty(live, ["torch"], catalog);
    expect(live.inventory).toEqual([{ item: "torch", charges: 2 }]);
  });

  it("removes from a member's personal inventory before equipped", () => {
    const live: LivePartyLike = {
      inventory: [],
      roster: [
        {
          inventory: [{ item: "master_key" }],
          equipped: { hands: "master_key", body: null },
          equipped_durability: { hands: null, body: null },
        },
      ],
    };
    removeItemsFromLiveParty(live, ["master_key"], catalog);
    expect(live.roster[0].inventory).toEqual([]);
    expect(live.roster[0].equipped.hands).toBe("master_key");
  });
});
