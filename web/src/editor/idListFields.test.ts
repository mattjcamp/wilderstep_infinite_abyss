/**
 * Id-list field config + option-building helpers. The config test
 * pins the coverage promised by the usability audit (P1): each
 * listed (model, field) pair renders the IdListPicker instead of a
 * raw JSON textarea, so a silent removal here is an authoring-UX
 * regression. Option helpers are pure — tested directly.
 */
import { describe, expect, it } from "vitest";

import { getIdListFieldConfig } from "./idListFields";
import {
  distinctFromRecords,
  optionsFromRecords,
} from "./IdListPicker";

describe("getIdListFieldConfig — audit P1 coverage", () => {
  it("covers the headline fields", () => {
    // (model, field, expected source kind, duplicates allowed)
    const expectations: Array<[string, string, string, boolean]> = [
      ["encounters", "monsters", "catalog", true],
      ["spawns", "spawn_monsters", "catalog", true],
      ["spawns", "boss_monsters", "catalog", true],
      ["spawns", "loot", "catalog", true],
      ["races", "abilities", "catalog", false],
      ["items", "slots", "static", false],
      ["spells", "usable_in", "static", false],
      ["abilities", "usable_in", "static", false],
      ["character_classes", "casting_type", "distinct", false],
      ["character_classes", "allowable_item_types", "distinct", false],
    ];
    for (const [model, field, kind, dupes] of expectations) {
      const cfg = getIdListFieldConfig(field, model);
      expect(cfg, `${model}.${field}`).not.toBeNull();
      expect(cfg!.source.kind, `${model}.${field} source`).toBe(kind);
      expect(
        cfg!.allowDuplicates ?? false,
        `${model}.${field} duplicates`,
      ).toBe(dupes);
    }
  });

  it("stays away from object-shaped fields and unknown models", () => {
    // character_classes.abilities entries are {ability_id, min_level}
    // links — NOT plain ids; they keep the JSON textarea until they
    // get their own structured editor.
    expect(getIdListFieldConfig("abilities", "character_classes")).toBeNull();
    // monsters.spells are inline spell blocks.
    expect(getIdListFieldConfig("spells", "monsters")).toBeNull();
    expect(getIdListFieldConfig("monsters", "items")).toBeNull();
    expect(getIdListFieldConfig("monsters", undefined)).toBeNull();
  });
});

describe("optionsFromRecords", () => {
  it("builds sorted labelled options with model-appropriate thumbs", () => {
    const monsters = optionsFromRecords("monsters", [
      { id: "wolf", name: "Wolf", sprite: "monster/wolf.png" },
      { id: "goblin", name: "Goblin" },
      { id: "", name: "broken — no id" },
      { name: "broken — id missing" },
    ]);
    expect(monsters.map((o) => o.id)).toEqual(["goblin", "wolf"]);
    expect(monsters[1].thumb).toContain("/sprites/monster/wolf.png");
    expect(monsters[0].thumb).toBeNull();

    // Items resolve icon → item/<icon>.png instead of `sprite`.
    const items = optionsFromRecords("items", [
      { id: "arrows", name: "Arrows", icon: "arrows" },
    ]);
    expect(items[0].thumb).toContain("/sprites/item/arrows.png");
  });

  it("falls back to the id when a record has no name", () => {
    const out = optionsFromRecords("abilities", [{ id: "fast_learner" }]);
    expect(out[0].label).toBe("fast_learner");
  });
});

describe("distinctFromRecords", () => {
  it("collects sorted distinct values from string and array fields", () => {
    const out = distinctFromRecords(
      [
        { item_type: "sword" },
        { item_type: "potion" },
        { item_type: "sword" },
        { item_type: ["wand", "sword"] }, // array-valued fields count too
        { item_type: 7 }, // non-strings ignored
        {},
      ],
      "item_type",
    );
    expect(out.map((o) => o.id)).toEqual(["potion", "sword", "wand"]);
    expect(out.every((o) => o.thumb === null)).toBe(true);
  });
});
