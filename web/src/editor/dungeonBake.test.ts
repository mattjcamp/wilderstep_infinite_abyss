import { describe, it, expect } from "vitest";
import { bakeDungeon, bakedMapId, nextFreeSuffix } from "./dungeonBake";
import type { DungeonRecord } from "@/sim/dungeon/types";
import type { EncounterTemplate } from "@/battle/world/Encounters";

/** Standard dungeon record for tests. Override per test as needed. */
function makeRecord(over: Partial<DungeonRecord> = {}): DungeonRecord {
  return {
    id: "test_dungeon",
    name: "Test Dungeon",
    style: "caves",
    difficulty: "normal",
    size: { width: 24, height: 18 },
    torch_density: 0.15,
    locked_doors: 0.25,
    levels: [
      { id: "lvl_1", name: "Upper Caves", depth: 1 },
      { id: "lvl_2", name: "Deep Caves", depth: 2 },
    ],
    ...over,
  };
}

/** Encounters table seeded with two distinct entries so the
 *  generator's sample has something to pick from. We use seed-driven
 *  generation so the placements are deterministic. */
function makeEncounters(): Record<string, EncounterTemplate[]> {
  return {
    dungeon: [
      // Level 2-3 so they fall inside the "normal" difficulty band
      // (encMin=2, encMax=4 — see DIFFICULTY_PROFILES in Dungeon.ts).
      // Level=1 encounters would get filtered by sampleEncounter and
      // the floor would generate empty of monsters.
      {
        id: "cellar_rats",
        area: "dungeon",
        name: "Cellar Rats",
        level: 2,
        weight: 1,
        monsterPartyTile: "monster/giant_rat.png",
        monsters: ["giant_rat", "giant_rat"],
      },
      {
        id: "goblin_warband",
        area: "dungeon",
        name: "Goblin Warband",
        level: 3,
        weight: 1,
        monsterPartyTile: "monster/goblin.png",
        monsters: ["goblin", "goblin"],
      },
    ],
  };
}

describe("nextFreeSuffix", () => {
  it("returns 1 when no maps carry a dungeon-group tag", () => {
    expect(nextFreeSuffix("goblin_lair", [])).toBe(1);
    expect(
      nextFreeSuffix("goblin_lair", [
        { tags: ["overworld"] },
        { tags: ["dungeon"] },
      ]),
    ).toBe(1);
  });

  it("returns one past the largest existing integer suffix", () => {
    expect(
      nextFreeSuffix("goblin_lair", [
        { tags: ["dungeon", "dungeon:goblin_lair_1"] },
      ]),
    ).toBe(2);
    expect(
      nextFreeSuffix("goblin_lair", [
        { tags: ["dungeon:goblin_lair_1"] },
        { tags: ["dungeon:goblin_lair_2"] },
        { tags: ["dungeon:goblin_lair_5"] },
      ]),
    ).toBe(6);
  });

  it("handles gaps by picking max + 1, not first free", () => {
    expect(
      nextFreeSuffix("d", [
        { tags: ["dungeon:d_1"] },
        // gap at 2
        { tags: ["dungeon:d_3"] },
      ]),
    ).toBe(4);
  });

  it("ignores non-integer suffixes (so hand-tagged sets don't poison auto-increment)", () => {
    expect(
      nextFreeSuffix("d", [
        { tags: ["dungeon:d_legacy"] },
        { tags: ["dungeon:d_v1_alpha"] },
        { tags: ["dungeon:d_2"] },
      ]),
    ).toBe(3);
  });

  it("ignores other dungeons' tags", () => {
    expect(
      nextFreeSuffix("crypt", [
        { tags: ["dungeon:goblin_lair_1"] },
        { tags: ["dungeon:goblin_lair_2"] },
      ]),
    ).toBe(1);
  });
});

describe("bakedMapId", () => {
  it("formats as <dungeon>_<suffix>_l<depth>", () => {
    expect(bakedMapId("goblin_lair", 1, 1)).toBe("goblin_lair_1_l1");
    expect(bakedMapId("goblin_lair", 3, 2)).toBe("goblin_lair_3_l2");
  });
});

describe("bakeDungeon", () => {
  it("mints one map per level with the expected real ids", () => {
    const record = makeRecord();
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    expect(result.suffix).toBe(1);
    expect(result.groupTag).toBe("dungeon:test_dungeon_1");
    expect(result.mapIds).toEqual([
      "test_dungeon_1_l1",
      "test_dungeon_1_l2",
    ]);
    expect(result.maps).toHaveLength(2);
    expect(result.maps.map((m) => m.id)).toEqual(result.mapIds);
  });

  it("stamps only the per-bake group tag (not a generic 'dungeon' tag)", () => {
    // The generic "dungeon" tag was deliberately dropped — see the
    // module doc. Each map appearing under two group headers in
    // MapsBrowse just clutters the tag-tree.
    const record = makeRecord();
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    for (const m of result.maps) {
      expect(m.tags).toEqual(["dungeon:test_dungeon_1"]);
    }
  });

  it("picks the next free suffix when prior bakes exist", () => {
    const record = makeRecord();
    const prior = [
      { tags: ["dungeon", "dungeon:test_dungeon_1"] },
      { tags: ["dungeon", "dungeon:test_dungeon_2"] },
    ];
    const result = bakeDungeon(record, { seed: 1, existingMaps: prior });
    expect(result.suffix).toBe(3);
    expect(result.mapIds[0]).toBe("test_dungeon_3_l1");
    expect(result.groupTag).toBe("dungeon:test_dungeon_3");
  });

  it("rewrites inter-floor stair links to real baked sibling ids (not synthetic)", () => {
    const record = makeRecord();
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    // Collect every non-null link map_id across both floors. We don't
    // know exactly which cell has stairs without re-running the
    // generator, but we can assert: (a) at least one inter-floor link
    // exists, (b) no link references a synthetic `__dungeon_` id, and
    // (c) every non-null link points at one of the real baked ids.
    const realIds = new Set(result.mapIds);
    let interFloorLinkSeen = 0;
    for (const m of result.maps) {
      for (const row of m.grid) {
        for (const cell of row) {
          if (!cell.link) continue;
          expect(cell.link.map_id.startsWith("__dungeon_")).toBe(false);
          expect(realIds.has(cell.link.map_id)).toBe(true);
          interFloorLinkSeen++;
        }
      }
    }
    expect(interFloorLinkSeen).toBeGreaterThan(0);
  });

  it("clears stair links that pointed at the overworld exit (top of L1, bottom of LN)", () => {
    // With two floors the L1 stairs-up + L2 stairs-down both
    // originally pointed at EXIT_TO_OVERWORLD_MAP_ID. After bake,
    // those particular cells should have `link: null`. We can't
    // identify those cells from outside, but the previous test
    // already established that NO link points at a synthetic id —
    // so any stair-shaped cell whose link wasn't rewritten to a
    // sibling has been nulled. Here we add a single-floor case
    // where every stair link originally pointed at the overworld
    // and assert NO cell has a non-null link.
    const record = makeRecord({
      levels: [{ id: "only", name: "Only Floor", depth: 1 }],
    });
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    expect(result.maps).toHaveLength(1);
    for (const row of result.maps[0].grid) {
      for (const cell of row) {
        // No inter-floor neighbour exists, so no link should survive.
        expect(cell.link).toBeNull();
      }
    }
  });

  it("stamps real encounter ids on monster cells (no synthetic __dungeon_enc_*)", () => {
    const record = makeRecord();
    const encounters = makeEncounters();
    const validIds = new Set(encounters.dungeon.map((e) => e.id));
    const result = bakeDungeon(record, {
      seed: 7,
      existingMaps: [],
      encounters,
    });
    let encounterCellsSeen = 0;
    for (const m of result.maps) {
      for (const row of m.grid) {
        for (const cell of row) {
          if (!cell.encounter) continue;
          expect(cell.encounter.startsWith("__dungeon_enc_")).toBe(false);
          expect(validIds.has(cell.encounter)).toBe(true);
          encounterCellsSeen++;
        }
      }
    }
    expect(encounterCellsSeen).toBeGreaterThan(0);
  });

  it("does NOT stamp encounters when the table is empty (generator places no monsters)", () => {
    const record = makeRecord();
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    // No encounters table → generator skips monster placement → no
    // cells should carry an encounter id at all.
    for (const m of result.maps) {
      for (const row of m.grid) {
        for (const cell of row) {
          expect(cell.encounter).toBe("");
        }
      }
    }
  });

  it("respects authored width/height on each map", () => {
    const record = makeRecord({
      size: { width: 20, height: 16 },
      levels: [
        { id: "a", name: "A", depth: 1 },
        { id: "b", name: "B", depth: 2, size: { width: 30, height: 22 } },
      ],
    });
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    expect(result.maps[0].width).toBe(20);
    expect(result.maps[0].height).toBe(16);
    expect(result.maps[1].width).toBe(30);
    expect(result.maps[1].height).toBe(22);
    // Grid row count should match the authored height (no buffer pad
    // leaking through — see normaliseAuthoredHeight in
    // generateFromRecord).
    expect(result.maps[0].grid).toHaveLength(16);
    expect(result.maps[1].grid).toHaveLength(22);
  });

  it("gives each map a descriptive name + description", () => {
    const record = makeRecord();
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    expect(result.maps[0].name).toBe("Test Dungeon — Upper Caves");
    expect(result.maps[1].name).toBe("Test Dungeon — Deep Caves");
    expect(result.maps[0].description).toContain("Floor 1");
    expect(result.maps[0].description).toContain("Test Dungeon");
    expect(result.maps[1].description).toContain("Floor 2");
  });

  it("returns an empty maps array when the record has no levels", () => {
    const record = makeRecord({ levels: [] });
    const result = bakeDungeon(record, { seed: 1, existingMaps: [] });
    expect(result.maps).toEqual([]);
    expect(result.mapIds).toEqual([]);
    // Suffix still computed defensively — even an empty bake reserves
    // the next slot, so the caller's UI can show the "would be"
    // group tag.
    expect(result.suffix).toBe(1);
    expect(result.groupTag).toBe("dungeon:test_dungeon_1");
  });
});
