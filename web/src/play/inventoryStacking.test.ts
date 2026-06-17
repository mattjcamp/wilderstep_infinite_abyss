import { describe, expect, it } from "vitest";

import {
  addToInventory,
  removeFromInventory,
  type InventoryEntry,
  type StackableItemRef,
} from "./inventoryStacking";

// Minimal catalog: a stackable consumable + a non-stackable weapon.
const catalog: StackableItemRef[] = [
  { id: "torch", stackable: true },
  { id: "skeleton_key", stackable: false },
];

describe("removeFromInventory", () => {
  it("decrements a stackable row's charges by the count", () => {
    const inv: InventoryEntry[] = [{ item: "torch", charges: 5 }];
    expect(removeFromInventory(inv, "torch", catalog, 2)).toEqual([
      { item: "torch", charges: 3 },
    ]);
  });

  it("splices a stackable row when its charges hit zero", () => {
    const inv: InventoryEntry[] = [
      { item: "torch", charges: 2 },
      { item: "skeleton_key" },
    ];
    expect(removeFromInventory(inv, "torch", catalog, 2)).toEqual([
      { item: "skeleton_key" },
    ]);
  });

  it("removes one row per copy for non-stackable items", () => {
    const inv: InventoryEntry[] = [
      { item: "skeleton_key" },
      { item: "skeleton_key" },
      { item: "torch", charges: 1 },
    ];
    expect(removeFromInventory(inv, "skeleton_key", catalog, 1)).toEqual([
      { item: "skeleton_key" },
      { item: "torch", charges: 1 },
    ]);
  });

  it("is best-effort when removing more than the party holds", () => {
    const inv: InventoryEntry[] = [{ item: "torch", charges: 1 }];
    // Asking for 3 removes the single copy and ignores the shortfall.
    expect(removeFromInventory(inv, "torch", catalog, 3)).toEqual([]);
  });

  it("is a no-op when the item isn't present", () => {
    const inv: InventoryEntry[] = [{ item: "torch", charges: 1 }];
    expect(removeFromInventory(inv, "skeleton_key", catalog, 1)).toEqual([
      { item: "torch", charges: 1 },
    ]);
  });

  it("does not mutate the input array", () => {
    const inv: InventoryEntry[] = [{ item: "torch", charges: 2 }];
    const out = removeFromInventory(inv, "torch", catalog, 1);
    expect(inv).toEqual([{ item: "torch", charges: 2 }]);
    expect(out).not.toBe(inv);
  });

  it("inverts addToInventory for a stackable grant + return", () => {
    let inv: InventoryEntry[] = [];
    inv = addToInventory(inv, "torch", catalog, 1);
    inv = removeFromInventory(inv, "torch", catalog, 1);
    expect(inv).toEqual([]);
  });
});
