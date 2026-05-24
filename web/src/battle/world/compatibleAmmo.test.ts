/**
 * Regression coverage for `compatibleAmmoIds` — the helper that
 * powers the Range action's ammo gating AND the new ammo picker
 * the Combat scene opens when the party carries multiple ammo
 * types that the equipped weapon could load (Arrows + Fire Arrows
 * on any bow is the canonical case).
 *
 * The picker UX lives on the scene side; this test pins the pure
 * "which ammo ids should the picker offer" logic so a future
 * refactor to the AMMO_FAMILY table can't silently drop an
 * ammo from a weapon's list.
 */

import { describe, it, expect } from "vitest";
import { compatibleAmmoIds } from "./Party";
import type { Item } from "./Items";
import type { Party } from "./Party";

function makeWeapon(over: Partial<Item> = {}): Item {
  return {
    id: "short_bow",
    category: "weapons",
    name: "Short Bow",
    ranged: true,
    ammo: "arrows",
    power: 2,
    ...over,
  };
}

function makeParty(
  inventory: ReadonlyArray<{ item: string; charges?: number }>,
): Party {
  // Minimal Party shape — compatibleAmmoIds only reads
  // `party.inventory`, but the type wants more fields.
  return {
    members: [],
    roster: [],
    inventory: inventory.map((e) => ({ ...e })),
    gold: 0,
    party_effects: [],
    avatar: "",
    start_position: { map_id: "world", col: 0, row: 0 },
    torch_steps: 0,
    magic_light_steps: 0,
    galadriels_light_steps: 0,
  } as unknown as Party;
}

describe("compatibleAmmoIds", () => {
  it("returns the weapon's primary ammo when only it is in stash", () => {
    const party = makeParty([{ item: "arrows", charges: 20 }]);
    expect(compatibleAmmoIds(makeWeapon(), party)).toEqual(["arrows"]);
  });

  it("returns both primary AND fire_arrows when both are in stash", () => {
    const party = makeParty([
      { item: "arrows", charges: 5 },
      { item: "fire_arrows", charges: 3 },
    ]);
    // Primary first so the picker lists "Arrows" before "Fire Arrows".
    expect(compatibleAmmoIds(makeWeapon(), party)).toEqual([
      "arrows",
      "fire_arrows",
    ]);
  });

  it("returns only fire_arrows when regular arrows are out", () => {
    // The user might have used their last arrow but still has fire
    // arrows in the bundle. The Range row should stay enabled.
    const party = makeParty([{ item: "fire_arrows", charges: 4 }]);
    expect(compatibleAmmoIds(makeWeapon(), party)).toEqual(["fire_arrows"]);
  });

  it("filters out empty-charge stacks (defensive)", () => {
    // A row with charges: 0 shouldn't surface — partyHasAmmo
    // already excludes it; this test pins that the helper does too.
    const party = makeParty([
      { item: "arrows", charges: 0 },
      { item: "fire_arrows", charges: 2 },
    ]);
    expect(compatibleAmmoIds(makeWeapon(), party)).toEqual(["fire_arrows"]);
  });

  it("returns an empty list when nothing the weapon can load is in stash", () => {
    const party = makeParty([{ item: "torch", charges: 1 }]);
    expect(compatibleAmmoIds(makeWeapon(), party)).toEqual([]);
  });

  it("returns an empty list when the weapon has no ammo field (melee)", () => {
    const sword = makeWeapon({ id: "sword", ammo: undefined });
    const party = makeParty([{ item: "arrows", charges: 5 }]);
    expect(compatibleAmmoIds(sword, party)).toEqual([]);
  });

  it("does NOT alias bolts to fire_arrows — alternates are per-primary", () => {
    const crossbow = makeWeapon({ id: "crossbow", ammo: "bolts" });
    const party = makeParty([
      { item: "bolts", charges: 3 },
      { item: "fire_arrows", charges: 3 }, // should NOT join the list
    ]);
    expect(compatibleAmmoIds(crossbow, party)).toEqual(["bolts"]);
  });
});
