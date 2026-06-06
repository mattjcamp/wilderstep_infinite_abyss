import { describe, expect, it } from "vitest";
import { groupItemsByCategory, itemGroupLabel, UNCATEGORIZED } from "./itemTags";

describe("itemGroupLabel", () => {
  it("title-cases the category", () => {
    expect(itemGroupLabel("weapons")).toBe("Weapons");
    expect(itemGroupLabel("quest_items")).toBe("Quest Items");
  });

  it("falls back to (uncategorized) when category is missing", () => {
    expect(itemGroupLabel()).toBe(UNCATEGORIZED);
    expect(itemGroupLabel("  ")).toBe(UNCATEGORIZED);
  });
});

describe("groupItemsByCategory", () => {
  const items = [
    { id: "iron_sword", name: "Iron Sword", category: "weapons", item_type: "sword" },
    { id: "broad_axe", name: "Broad Axe", category: "weapons", item_type: "axe" },
    { id: "sun_sword", name: "Sun Sword", category: "weapons", item_type: "sword" },
    { id: "leather", name: "Leather Armor", category: "armors", item_type: "leather" },
    { id: "mystery", name: "Mystery" }, // no category
  ];

  it("buckets items by category only (ignoring item_type)", () => {
    const grouped = groupItemsByCategory(items);
    expect(grouped.map((g) => g.label)).toEqual([
      "Armors",
      "Weapons",
      UNCATEGORIZED,
    ]);
  });

  it("orders groups alphabetically with uncategorized last", () => {
    const grouped = groupItemsByCategory(items);
    expect(grouped[0].label).toBe("Armors");
    expect(grouped[grouped.length - 1].label).toBe(UNCATEGORIZED);
  });

  it("sorts members within a group by display name", () => {
    const grouped = groupItemsByCategory(items);
    const weapons = grouped.find((g) => g.label === "Weapons");
    expect(weapons!.items.map((i) => i.name)).toEqual([
      "Broad Axe",
      "Iron Sword",
      "Sun Sword",
    ]);
  });
});
