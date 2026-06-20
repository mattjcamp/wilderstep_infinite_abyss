import { describe, it, expect } from "vitest";
import { mergeModel } from "./merge";

describe("mergeModel — singletons (collectionKey null)", () => {
  const parent = {
    start_position: { map_id: "overview", col: 4, row: 16 },
    gold: 50,
    roster: ["gimli", "goldmoon"],
    party_effects: [],
  };

  it("inherits keys the child omits", () => {
    // Child only changes start_position; roster/gold inherit from parent.
    const child = { start_position: { map_id: "the_main_map", col: 8, row: 70 } };
    const merged = mergeModel(null, parent, child) as Record<string, unknown>;
    expect(merged.roster).toEqual(["gimli", "goldmoon"]);
    expect(merged.gold).toBe(50);
    expect(merged.start_position).toEqual({ map_id: "the_main_map", col: 8, row: 70 });
  });

  it("lets the child override a key it sets", () => {
    const child = { roster: ["raistlin_majere"] };
    const merged = mergeModel(null, parent, child) as Record<string, unknown>;
    expect(merged.roster).toEqual(["raistlin_majere"]);
  });

  it("treats an explicit empty array as a deliberate override (not inherit)", () => {
    const child = { roster: [] };
    const merged = mergeModel(null, parent, child) as Record<string, unknown>;
    expect(merged.roster).toEqual([]);
  });

  it("returns the parent untouched when the child has no own file", () => {
    expect(mergeModel(null, parent, null)).toEqual(parent);
  });

  it("returns the child when there is no parent", () => {
    const child = { gold: 10 };
    expect(mergeModel(null, null, child)).toEqual(child);
  });
});

describe("mergeModel — collections (by id)", () => {
  it("overrides parent records by id and appends new ids in order", () => {
    const parent = { items: [{ id: "a", v: 1 }, { id: "b", v: 1 }] };
    const child = { items: [{ id: "b", v: 2 }, { id: "c", v: 3 }] };
    const merged = mergeModel("items", parent, child) as {
      items: Array<{ id: string; v: number }>;
    };
    expect(merged.items).toEqual([
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 3 },
    ]);
  });
});
