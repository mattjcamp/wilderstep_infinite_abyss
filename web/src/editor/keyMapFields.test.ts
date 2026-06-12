/**
 * Key-map field config (audit P1.2) + the catalog `where` filter the
 * reagent picker depends on. Coverage pins which fields render the
 * KeyMapEditor instead of a raw JSON textarea.
 */
import { describe, expect, it } from "vitest";

import { getKeyMapFieldConfig } from "./keyMapFields";
import { loadOptions, __resetIdListOptionCacheForTests } from "./IdListPicker";

describe("getKeyMapFieldConfig — audit P1.2 coverage", () => {
  it("covers reagents, stat modifiers, and equipment slots", () => {
    const reagents = getKeyMapFieldConfig("reagents", "recipes");
    expect(reagents).not.toBeNull();
    expect(reagents!.value.kind).toBe("number");
    expect(reagents!.fixedRows ?? false).toBe(false);
    // Reagent keys filter the items catalog to forageables.
    expect(reagents!.keys).toMatchObject({
      kind: "catalog",
      model: "items",
      where: { field: "item_type", in: ["reagent", "herb"] },
    });

    for (const model of ["races", "character_classes"]) {
      const mods = getKeyMapFieldConfig("stat_modifiers", model);
      expect(mods, model).not.toBeNull();
      expect(mods!.fixedRows).toBe(true);
      expect(mods!.value.kind).toBe("number");
      // Negatives allowed — no min.
      expect(
        (mods!.value as { min?: number }).min,
        model,
      ).toBeUndefined();
    }

    const equipped = getKeyMapFieldConfig("equipped", "characters");
    expect(equipped).not.toBeNull();
    expect(equipped!.fixedRows).toBe(true);
    expect(equipped!.value.kind).toBe("id");
  });

  it("returns null for unconfigured fields", () => {
    expect(getKeyMapFieldConfig("inventory", "characters")).toBeNull();
    expect(getKeyMapFieldConfig("reagents", "items")).toBeNull();
    expect(getKeyMapFieldConfig("reagents", undefined)).toBeNull();
  });
});

describe("catalog source `where` filter", () => {
  it("keeps only records matching the filter (and distinct cache keys)", async () => {
    __resetIdListOptionCacheForTests();
    // Stub fetch: StaticModuleSource resolves the module manifest +
    // items.json. Minimal three-item catalog, two forageable.
    const items = {
      items: [
        { id: "sword", name: "Sword", item_type: "sword", icon: "sword" },
        { id: "moonpetal", name: "Moonpetal", item_type: "reagent" },
        { id: "healing_herb", name: "Healing Herb", item_type: "herb" },
      ],
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      const body = u.endsWith("items.json")
        ? items
        : u.endsWith("module.json")
          ? { id: "default" }
          : u.endsWith("index.json")
            ? { modules: [{ id: "default" }] }
            : null;
      return {
        ok: body !== null,
        status: body !== null ? 200 : 404,
        json: async () => body,
      } as Response;
    }) as typeof fetch;
    try {
      const filtered = await loadOptions("default", {
        kind: "catalog",
        model: "items",
        where: { field: "item_type", in: ["reagent", "herb"] },
      });
      expect(filtered.map((o) => o.id).sort()).toEqual([
        "healing_herb",
        "moonpetal",
      ]);
      // Unfiltered load of the same catalog must NOT reuse the
      // filtered cache entry.
      const all = await loadOptions("default", {
        kind: "catalog",
        model: "items",
      });
      expect(all.map((o) => o.id).sort()).toEqual([
        "healing_herb",
        "moonpetal",
        "sword",
      ]);
    } finally {
      globalThis.fetch = origFetch;
      __resetIdListOptionCacheForTests();
    }
  });
});
