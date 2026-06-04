import { describe, expect, it } from "vitest";
import { compareTags, groupByTags, PINNED_TAGS, UNTAGGED } from "./mapTags";

describe("compareTags", () => {
  it("pins overview/town/buildings/outside first, in that order", () => {
    const tags = [
      "hollowmere",
      "outside",
      "battle_screen_arena",
      "overview",
      UNTAGGED,
      "town",
      "buildings",
    ];
    expect(tags.slice().sort(compareTags)).toEqual([
      "overview",
      "town",
      "buildings",
      "outside",
      "battle_screen_arena",
      "hollowmere",
      UNTAGGED,
    ]);
  });

  it("sorts non-pinned tags alphabetically with untagged last", () => {
    expect(["zeta", UNTAGGED, "alpha"].sort(compareTags)).toEqual([
      "alpha",
      "zeta",
      UNTAGGED,
    ]);
  });

  it("keeps the pinned list itself stable", () => {
    expect(PINNED_TAGS.slice().sort(compareTags)).toEqual(PINNED_TAGS);
  });
});

describe("groupByTags", () => {
  const maps = [
    { id: "world", name: "The World", tags: ["overview"] },
    { id: "inn", name: "The Inn", tags: ["buildings", "hollowmere"] },
    { id: "arena", name: "Arena" }, // untagged
    { id: "square", name: "Town Square", tags: ["town"] },
    { id: "alley", name: "Alley", tags: ["town"] },
  ];

  it("groups records under every tag they carry, pinned groups first", () => {
    const grouped = groupByTags(maps);
    expect(grouped.map(([tag]) => tag)).toEqual([
      "overview",
      "town",
      "buildings",
      "hollowmere",
      UNTAGGED,
    ]);
    // Multi-tag record appears under each of its tags.
    const byTag = new Map(grouped);
    expect(byTag.get("buildings")!.map((m) => m.id)).toEqual(["inn"]);
    expect(byTag.get("hollowmere")!.map((m) => m.id)).toEqual(["inn"]);
    expect(byTag.get(UNTAGGED)!.map((m) => m.id)).toEqual(["arena"]);
  });

  it("sorts members within a group by display name", () => {
    const byTag = new Map(groupByTags(maps));
    expect(byTag.get("town")!.map((m) => m.name)).toEqual([
      "Alley",
      "Town Square",
    ]);
  });
});
