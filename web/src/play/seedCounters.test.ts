/**
 * Guards the counters shape bridge in seedBattleCaches.
 *
 * The v2 `counters` model merges to a collection (`{ counters: [ { id,
 * items, … } ] }`), but the v1 loot loader (`loadCounters` /
 * `parseCounters`) expects a BARE map keyed by shop type. CombatScene's
 * loot-drop pool reads through that v1 path, so a wrong transform =
 * silently no loot. These tests pin the transform against the REAL
 * `parseCounters` + `buildLootPool` so a regression can't slip through.
 */
import { describe, expect, it } from "vitest";

import { countersToRawMap } from "./seedBattleCaches";
import { parseCounters } from "@/battle/world/Counters";
import { buildLootPool } from "@/battle/world/Loot";
import type { Item } from "@/battle/world/Items";

/** Minimal items catalog — buildLootPool only does `items.has(name)`. */
function itemsMap(names: string[]): Map<string, Item> {
  return new Map(names.map((n) => [n, { id: n } as unknown as Item]));
}

/** The merged v2 collection shape, as loadModelLayers+mergeModel yields. */
const mergedCounters = {
  counters: [
    { id: "general", name: "General Store", items: ["torch", "rope"] },
    { id: "weapon", name: "Weapon Shop", items: ["dagger", "sword"] },
    { id: "armor", name: "Armor Shop", items: ["cloth", "plate"] },
    // A non-loot shop type — present but not in LOOT_SHOP_TYPES.
    { id: "inn", name: "Inn", items: ["room"] },
  ],
};

describe("countersToRawMap", () => {
  it("re-keys the merged collection by id into the shape parseCounters expects", () => {
    const raw = countersToRawMap(mergedCounters);
    // Keyed by shop type (the entry id), NOT a `counters` array.
    expect(Object.keys(raw).sort()).toEqual(["armor", "general", "inn", "weapon"]);
    const parsed = parseCounters(raw as never);
    expect(parsed.get("weapon")?.items).toEqual(["dagger", "sword"]);
    expect(parsed.get("general")?.name).toBe("General Store");
  });

  it("feeds buildLootPool a working general/weapon/armor pool", () => {
    const parsed = parseCounters(countersToRawMap(mergedCounters) as never);
    // Catalog is missing "plate" — it must be excluded from the pool.
    const pool = buildLootPool(
      itemsMap(["torch", "rope", "dagger", "sword", "cloth"]),
      parsed,
    );
    // Sorted, deduped, only catalog-present items from loot shop types
    // (inn's "room" is excluded — not a loot shop type).
    expect(pool).toEqual(["cloth", "dagger", "rope", "sword", "torch"]);
  });

  it("skips entries without a string id and tolerates non-collection input", () => {
    expect(countersToRawMap({ counters: [{ items: ["x"] }] })).toEqual({});
    expect(countersToRawMap(null)).toEqual({});
    expect(countersToRawMap({})).toEqual({});
  });
});
