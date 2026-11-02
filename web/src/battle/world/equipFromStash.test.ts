/**
 * Combat Equip Item draws gear from the party's shared inventory.
 * `equipItemFromInventory` takes the source array explicitly; these
 * lock in that a stash equip moves the item out of the stash, and a
 * swap puts the displaced piece back in the stash at the same index
 * (the member's personal bag is never touched).
 */
import { describe, expect, it } from "vitest";

import type { Item } from "./Items";
import type { InventoryItem, PartyMember } from "./Party";
import { equipItemFromInventory } from "./PartyActions";

const items = new Map<string, Item>(
  [
    { id: "sword", name: "Sword", slots: ["hands"], item_type: "sword", character_can_equip: true, durability: 20 },
    { id: "club", name: "Club", slots: ["hands"], item_type: "club", character_can_equip: true, durability: 12 },
  ].map((i) => [i.id, i as unknown as Item]),
);

function member(fields: Partial<PartyMember> = {}): PartyMember {
  return {
    id: "a",
    name: "Aldric",
    class: "fighter",
    equipped: { hands: null, body: null },
    equipped_durability: { hands: null, body: null },
    inventory: [],
    ...fields,
  } as unknown as PartyMember;
}

describe("equipItemFromInventory — from the shared stash", () => {
  it("moves the item out of the stash into an empty slot", () => {
    const m = member();
    const stash: InventoryItem[] = [{ item: "sword", durability: 7 }, { item: "club" }];
    const r = equipItemFromInventory(m, 0, items, null, stash);
    expect(r.ok).toBe(true);
    expect(m.equipped.hands).toBe("sword");
    expect(m.equipped_durability.hands).toBe(7);
    expect(stash).toEqual([{ item: "club" }]);
    expect(m.inventory).toEqual([]);
  });

  it("swaps: the displaced item returns to the stash at the same index", () => {
    const m = member({
      equipped: { hands: "club", body: null },
      equipped_durability: { hands: 4, body: null },
    });
    const stash: InventoryItem[] = [{ item: "arrows", charges: 5 }, { item: "sword" }];
    const r = equipItemFromInventory(m, 1, items, null, stash);
    expect(r.ok).toBe(true);
    expect(m.equipped.hands).toBe("sword");
    expect(stash).toEqual([{ item: "arrows", charges: 5 }, { item: "club", durability: 4 }]);
    expect(m.inventory).toEqual([]);
  });

  it("refuses gear the class can't use and leaves the stash alone", () => {
    const m = member();
    const stash: InventoryItem[] = [{ item: "sword" }];
    const r = equipItemFromInventory(m, 0, items, ["club"], stash);
    expect(r.ok).toBe(false);
    expect(stash).toEqual([{ item: "sword" }]);
    expect(m.equipped.hands).toBeNull();
  });
});
