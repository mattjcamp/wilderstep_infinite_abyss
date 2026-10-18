import { describe, expect, it } from "vitest";
import {
  compareTags,
  groupByTags,
  PINNED_TAGS,
  nextCopyId,
  planTagDelete,
  UNTAGGED,
} from "./mapTags";

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

describe("planTagDelete", () => {
  const link = (map_id: string) => ({ link: { map_id } });
  const town = {
    id: "town",
    name: "Town",
    tags: ["town"],
    grid: [[link("inn"), link("shop"), {}], [link("inn"), null, {}]],
  };
  const inn = { id: "inn", name: "Inn", tags: ["hallow", "House"], grid: [[link("town")]] };
  const shop = { id: "shop", name: "Shop", tags: ["hallow"], grid: [[link("inn")]] };
  const loose = { id: "loose", name: "Loose", tags: [], grid: [] };
  const parentMap = { id: "parent_hut", name: "Hut", tags: ["hallow"], grid: [] };

  it("deletes own maps under the tag and reports links left dangling", () => {
    const own = [town, inn, shop, loose];
    const plan = planTagDelete("hallow", [parentMap, ...own], own);
    expect(plan.toDelete.map((m) => m.id)).toEqual(["inn", "shop"]);
    expect(plan.remainingOwn.map((m) => m.id)).toEqual(["town", "loose"]);
    expect(plan.inherited.map((m) => m.id)).toEqual(["parent_hut"]);
    // Links between two deleted maps don't count; town has 3 into them.
    expect(plan.brokenLinks).toEqual([{ id: "town", name: "Town", count: 3 }]);
  });

  it("removes a multi-tagged map in full when any one of its tags is targeted", () => {
    const own = [town, inn, shop];
    const plan = planTagDelete("House", own, own);
    expect(plan.toDelete.map((m) => m.id)).toEqual(["inn"]);
    expect(plan.brokenLinks.map((b) => b.id).sort()).toEqual(["shop", "town"]);
  });

  it("targets maps with no tags via the (untagged) bucket", () => {
    const own = [town, loose, { id: "bare", name: "Bare" }];
    const plan = planTagDelete(UNTAGGED, own, own);
    expect(plan.toDelete.map((m) => m.id)).toEqual(["loose", "bare"]);
  });
});

describe("nextCopyId", () => {
  it("numbers copies instead of appending _copy", () => {
    expect(nextCopyId("otto_inn", new Set(["otto_inn"]))).toBe("otto_inn_2");
    expect(
      nextCopyId("stone_house_1", new Set(["stone_house_1", "stone_house_2"])),
    ).toBe("stone_house_3");
  });

  it("counts up from the highest existing number", () => {
    expect(nextCopyId("hut_7", new Set(["hut_6", "hut_7"]))).toBe("hut_8");
    expect(
      nextCopyId("wood_house_1", new Set(["wood_house_1", "wood_house_5"])),
    ).toBe("wood_house_6");
  });

  it("copying a copy doesn't grow the id", () => {
    const ids = new Set(["hut1", "hut1_2", "hut1_3"]);
    expect(nextCopyId("hut1_3", ids)).toBe("hut1_4");
  });

  it("collapses legacy _copy chains", () => {
    expect(nextCopyId("armory_1_copy_2_copy", new Set(["armory_1"]))).toBe(
      "armory_2",
    );
    expect(nextCopyId("stone_house_1_copy_copy_copy", new Set())).toBe(
      "stone_house_2",
    );
  });

  it("keeps ids that would strip to nothing", () => {
    expect(nextCopyId("copy", new Set(["copy"]))).toBe("copy_2");
  });
});
