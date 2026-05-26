import { describe, it, expect } from "vitest";
import {
  computeSellPrice,
  getCounterStock,
  setCounterStock,
} from "./counterStock";

describe("counterStock — getCounterStock", () => {
  it("seeds an empty save from the catalog list (one row per id)", () => {
    // First-ever visit on a save with no `counters` slice — the
    // helper should hand back one fresh entry per catalog seed id
    // so the overlay renders the authored stock immediately, then
    // persist that array on the next mutation.
    const stock = getCounterStock(undefined, "general", [
      "torch",
      "dagger",
      "torch",
    ]);
    expect(stock).toEqual([
      { item: "torch" },
      { item: "dagger" },
      { item: "torch" },
    ]);
  });

  it("prefers the persisted save slice over the catalog seed", () => {
    // Once the player has bought / sold at this counter, the
    // save's array is the source of truth — the catalog seed is
    // ignored. Pre-existing per-instance durability on rows must
    // ride through unchanged.
    const slice = {
      general: [
        { item: "dagger", durability: 7 },
        { item: "torch", charges: 3 },
      ],
    };
    const stock = getCounterStock(slice, "general", ["totally_different"]);
    expect(stock).toEqual([
      { item: "dagger", durability: 7 },
      { item: "torch", charges: 3 },
    ]);
  });

  it("returns a defensive copy so caller edits don't mutate the save", () => {
    const slice = { general: [{ item: "dagger" }] };
    const stock = getCounterStock(slice, "general", []);
    stock[0].item = "stolen";
    expect(slice.general[0].item).toBe("dagger");
  });

  it("treats a counter id missing from the slice as 'use the seed'", () => {
    // Player has visited shop A but not shop B. Opening B should
    // still expand B's catalog seed; the existing A slice is
    // unrelated and must not be returned.
    const slice = { general: [{ item: "dagger" }] };
    const stock = getCounterStock(slice, "weapons", ["sword", "axe"]);
    expect(stock).toEqual([{ item: "sword" }, { item: "axe" }]);
  });
});

describe("counterStock — setCounterStock", () => {
  it("creates the slice on first write", () => {
    const next = setCounterStock(undefined, "general", [{ item: "torch" }]);
    expect(next).toEqual({ general: [{ item: "torch" }] });
  });

  it("preserves unrelated counters", () => {
    const slice = { weapons: [{ item: "sword" }] };
    const next = setCounterStock(slice, "general", [{ item: "torch" }]);
    expect(next).toEqual({
      weapons: [{ item: "sword" }],
      general: [{ item: "torch" }],
    });
  });

  it("overrides an existing counter's entries", () => {
    const slice = { general: [{ item: "dagger", durability: 1 }] };
    const next = setCounterStock(slice, "general", [
      { item: "dagger", durability: 10 },
    ]);
    expect(next.general).toEqual([{ item: "dagger", durability: 10 }]);
  });
});

describe("counterStock — computeSellPrice", () => {
  const sword = { id: "sword", sell: 20, durability: 10 };
  const torch = { id: "torch", sell: 5 }; // no durability — consumable

  it("returns the base price for items with no catalog durability", () => {
    // Consumable / stackable — wear is meaningless, full payout.
    expect(computeSellPrice(torch, {})).toBe(5);
    expect(computeSellPrice(torch, { durability: 3 })).toBe(5);
  });

  it("returns the base price when the entry has no per-instance wear stamp", () => {
    // A fresh sword that's never been equipped has no `durability`
    // on the inventory row — treat as full health, full payout.
    expect(computeSellPrice(sword, {})).toBe(20);
    expect(computeSellPrice(sword, undefined)).toBe(20);
  });

  it("scales linearly by current / max for worn gear", () => {
    expect(computeSellPrice(sword, { durability: 10 })).toBe(20); // full
    expect(computeSellPrice(sword, { durability: 5 })).toBe(10);  // half
    expect(computeSellPrice(sword, { durability: 2 })).toBe(4);   // 20%
  });

  it("floors to a minimum payout of 1 gold for non-zero durability", () => {
    // A weapon at 1/10 durability would scale to floor(20 * 0.1) = 2.
    // A weapon at 1/100 would floor to 0; the floor bumps it to 1 so
    // selling a beat-up sword always feels like SOMETHING, not free.
    const fragile = { id: "fragile", sell: 5, durability: 100 };
    expect(computeSellPrice(fragile, { durability: 1 })).toBe(1);
  });

  it("returns 0 when the catalog doesn't accept the item for sale", () => {
    const quest = { id: "dragonheart" }; // no sell price
    expect(computeSellPrice(quest, { durability: 5 })).toBe(0);
    const nullSell = { id: "x", sell: null as unknown as number };
    expect(computeSellPrice(nullSell, {})).toBe(0);
  });

  it("clamps over-peak wear so a buffed item never sells above base", () => {
    // Defensive: if a future repair-spell ever bumped current above
    // peak, the helper should still cap the ratio at 1.0 instead of
    // paying double for a "blessed" weapon.
    expect(computeSellPrice(sword, { durability: 999 })).toBe(20);
  });

  it("handles undefined item ref gracefully", () => {
    expect(computeSellPrice(undefined, { durability: 5 })).toBe(0);
  });
});
