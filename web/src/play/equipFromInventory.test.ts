import { describe, expect, it } from "vitest";

import {
  applyEquipChoice,
  type EquipContext,
  type PartyGearState,
} from "./equipFromInventory";
import type { SavedCharacterState } from "./saveTypes";

const items = [
  { id: "sword", name: "Sword", slots: ["hands"], item_type: "sword", durability: 20 },
  { id: "club", name: "Club", slots: ["hands"], item_type: "club" },
  { id: "plate", name: "Plate", slots: ["body"], item_type: "heavy_armor" },
  { id: "potion", name: "Potion", stackable: true },
];

function member(id: string, fields: Partial<SavedCharacterState> = {}): SavedCharacterState {
  return { id, custom: null, inventory: [], effects: [], hp: 10, ...fields } as SavedCharacterState;
}

function ctx(over: Partial<EquipContext> = {}): EquipContext {
  return {
    items,
    catalogEquipped: () => undefined,
    allowableItemTypes: () => undefined,
    displayName: (id) => id,
    ...over,
  };
}

function ok(r: ReturnType<typeof applyEquipChoice>): PartyGearState {
  if (!r || "error" in r) throw new Error(`expected state, got ${JSON.stringify(r)}`);
  return r;
}

describe("applyEquipChoice", () => {
  it("equips from the inventory onto an empty slot, carrying durability", () => {
    const st: PartyGearState = {
      inventory: [{ item: "potion", charges: 2 }, { item: "sword", durability: 7 }],
      members: [member("a")],
    };
    const r = ok(applyEquipChoice(st, { kind: "stash", stashIndex: 1 }, "a", ctx()));
    expect(r.inventory).toEqual([{ item: "potion", charges: 2 }]);
    expect(r.members[0].equipped).toEqual({ hands: "sword" });
    expect(r.members[0].equipped_durability).toEqual({ hands: 7, body: null });
  });

  it("bounces the displaced item back into the inventory with its wear", () => {
    const st: PartyGearState = {
      inventory: [{ item: "sword" }],
      members: [member("a", { equipped: { hands: "club" }, equipped_durability: { hands: 3, body: null } })],
    };
    const r = ok(applyEquipChoice(st, { kind: "stash", stashIndex: 0 }, "a", ctx()));
    expect(r.members[0].equipped).toEqual({ hands: "sword" });
    expect(r.members[0].equipped_durability?.hands).toBeNull();
    expect(r.inventory).toEqual([{ item: "club", durability: 3 }]);
  });

  it("falls back to the catalog loadout when the save has no equipped map", () => {
    const st: PartyGearState = { inventory: [{ item: "sword" }], members: [member("a")] };
    const r = ok(
      applyEquipChoice(st, { kind: "stash", stashIndex: 0 }, "a", ctx({
        catalogEquipped: () => ({ hands: "club", body: "plate" }),
      })),
    );
    expect(r.members[0].equipped).toEqual({ hands: "sword", body: "plate" });
    expect(r.inventory.map((e) => e.item)).toEqual(["club"]);
  });

  it("unequips into the inventory when the target is null", () => {
    const st: PartyGearState = {
      inventory: [],
      members: [member("a", { equipped: { hands: "sword", body: "plate" }, equipped_durability: { hands: 5, body: null } })],
    };
    const r = ok(applyEquipChoice(st, { kind: "equipped", memberId: "a", slot: "hands" }, null, ctx()));
    expect(r.members[0].equipped).toEqual({ body: "plate" });
    expect(r.members[0].equipped_durability).toEqual({ hands: null, body: null });
    expect(r.inventory).toEqual([{ item: "sword", durability: 5 }]);
  });

  it("moves gear from one member to another in one step", () => {
    const st: PartyGearState = {
      inventory: [{ item: "potion", charges: 1 }],
      members: [
        member("a", { equipped: { hands: "sword" }, equipped_durability: { hands: 9, body: null } }),
        member("b", { equipped: { hands: "club" } }),
      ],
    };
    const r = ok(applyEquipChoice(st, { kind: "equipped", memberId: "a", slot: "hands" }, "b", ctx()));
    expect(r.members[0].equipped).toEqual({});
    expect(r.members[1].equipped).toEqual({ hands: "sword" });
    expect(r.members[1].equipped_durability?.hands).toBe(9);
    expect(r.inventory.map((e) => e.item)).toEqual(["potion", "club"]);
  });

  it("refuses an item the class can't use and changes nothing", () => {
    const st: PartyGearState = {
      inventory: [],
      members: [member("a", { equipped: { hands: "sword" } }), member("b")],
    };
    const r = applyEquipChoice(
      st,
      { kind: "equipped", memberId: "a", slot: "hands" },
      "b",
      ctx({ allowableItemTypes: (id) => (id === "b" ? ["club"] : undefined) }),
    );
    expect(r).toEqual({ error: "b can't equip Sword — their class isn't trained for it." });
  });

  it("picking the current wearer is a no-op", () => {
    const st: PartyGearState = { inventory: [], members: [member("a", { equipped: { hands: "sword" } })] };
    expect(applyEquipChoice(st, { kind: "equipped", memberId: "a", slot: "hands" }, "a", ctx())).toBeNull();
  });

  it("ignores non-gear rows", () => {
    const st: PartyGearState = { inventory: [{ item: "potion" }], members: [member("a")] };
    expect(applyEquipChoice(st, { kind: "stash", stashIndex: 0 }, "a", ctx())).toBeNull();
  });
});
