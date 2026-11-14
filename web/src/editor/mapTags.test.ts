import { describe, expect, it } from "vitest";
import {
  buildTagTree,
  compareTags,
  effectiveTagOrder,
  groupByTags,
  isTagPinned,
  makeTagComparator,
  moveTagPin,
  normalizeTag,
  PINNED_TAGS,
  nextCopyId,
  planTagDelete,
  setTagPinned,
  tagAncestors,
  tagLabel,
  tagNodeRecords,
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

  it("matches pinned tags case-insensitively", () => {
    expect(["Zed", "Town", "Overview"].sort(compareTags)).toEqual([
      "Overview",
      "Town",
      "Zed",
    ]);
  });

  it("orders nested paths parent-first, siblings by the custom order", () => {
    const cmp = makeTagComparator(["Hallowmere: Shop", "Hallowmere"]);
    expect(
      ["Abbey", "Hallowmere: House", "Hallowmere", "Hallowmere: Shop", UNTAGGED].sort(cmp),
    ).toEqual(["Hallowmere", "Hallowmere: Shop", "Hallowmere: House", "Abbey", UNTAGGED]);
  });
});

describe("tag path helpers", () => {
  it("normalizes spacing around the separator", () => {
    expect(normalizeTag(" Hallowmere :House ")).toBe("Hallowmere: House");
    expect(tagLabel("Hallowmere: House")).toBe("Hallowmere › House");
    expect(tagAncestors("a: b: c")).toEqual(["a", "a: b", "a: b: c"]);
  });

  it("reads tag_order from the file, falling back to the defaults", () => {
    expect(effectiveTagOrder({ tag_order: ["X", 3, ""] })).toEqual(["X"]);
    expect(effectiveTagOrder({ maps: [] })).toEqual(PINNED_TAGS);
    expect(effectiveTagOrder(null)).toEqual(PINNED_TAGS);
  });

  it("pins, unpins and reorders among siblings only", () => {
    let order = setTagPinned([], "A", true);
    order = setTagPinned(order, "A: x", true);
    order = setTagPinned(order, "B", true);
    expect(order).toEqual(["A", "A: x", "B"]);
    expect(isTagPinned(order, "b")).toBe(true);
    // B moves above A, skipping the nested A: x entry.
    expect(moveTagPin(order, "B", -1)).toEqual(["B", "A: x", "A"]);
    // Already first among its siblings — unchanged.
    expect(moveTagPin(order, "A", -1)).toEqual(order);
    expect(setTagPinned(order, "A: x", false)).toEqual(["A", "B"]);
  });
});

describe("buildTagTree", () => {
  const maps = [
    { id: "sq", name: "Square", tags: ["Hallowmere: Town"] },
    { id: "h1", name: "Hut", tags: ["Hallowmere: House"] },
    { id: "h2", name: "Cottage", tags: ["Hallowmere:House", "Hallowmere: Shop"] },
    { id: "w", name: "World", tags: ["Overview"] },
    { id: "a", name: "Arena" },
  ];

  it("nests on ':' and files records at their leaf", () => {
    const tree = buildTagTree(maps);
    expect(tree.map((n) => n.label)).toEqual(["Overview", "Hallowmere", UNTAGGED]);
    const hallow = tree[1];
    // Town is a default-pinned label only at the top level, so children are A–Z.
    expect(hallow.children.map((n) => n.label)).toEqual(["House", "Shop", "Town"]);
    expect(hallow.children[0].records.map((m) => m.id)).toEqual(["h2", "h1"]);
    // Cottage sits under two children but counts once for the parent.
    expect(tagNodeRecords(hallow).map((m) => m.id).sort()).toEqual(["h1", "h2", "sq"]);
  });

  it("honours a custom order at nested levels", () => {
    const tree = buildTagTree(maps, ["Hallowmere", "Hallowmere: Town"]);
    expect(tree.map((n) => n.label)).toEqual(["Hallowmere", "Overview", UNTAGGED]);
    expect(tree[0].children.map((n) => n.label)).toEqual(["Town", "House", "Shop"]);
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

  it("a parent path takes every map nested beneath it", () => {
    const a = { id: "a", tags: ["Hallowmere: House"], grid: [] };
    const b = { id: "b", tags: ["Hallowmere"], grid: [] };
    const c = { id: "c", tags: ["Hallowmeres"], grid: [] };
    const plan = planTagDelete("Hallowmere", [a, b, c], [a, b, c]);
    expect(plan.toDelete.map((m) => m.id)).toEqual(["a", "b"]);
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
