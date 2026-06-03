import { describe, it, expect } from "vitest";
import {
  generateDungeonFromRecord,
  resolveLevelOptions,
} from "./generateFromRecord";
import {
  torchProfileFromProbability,
  TILE_STAIRS_DOWN,
  TILE_CHEST,
} from "@/battle/world/Dungeon";
import { TILE_FOREST_ARCHWAY_DOWN, TILE_DDOOR } from "@/battle/world/Tiles";
import { DUNGEON_DEFAULTS, type DungeonRecord } from "./types";

/** Count tiles of a given id on a floor's grid. */
function countTile(
  floor: { tiles: number[][] },
  id: number,
): number {
  let n = 0;
  for (const row of floor.tiles) for (const t of row) if (t === id) n += 1;
  return n;
}

/** Build a record with sensible defaults so each test can override
 *  just the fields it cares about. */
function makeRecord(over: Partial<DungeonRecord> = {}): DungeonRecord {
  return {
    id: "test_dungeon",
    name: "Test Dungeon",
    style: "caves",
    difficulty: "normal",
    size: { width: 30, height: 20 },
    torch_density: 0.15,
    locked_doors: 0.25,
    levels: [
      { id: "lvl_1", name: "Level 1", depth: 1 },
    ],
    ...over,
  };
}

describe("resolveLevelOptions", () => {
  it("returns the parent's values when the level overrides nothing", () => {
    const record = makeRecord({
      style: "ruins",
      difficulty: "hard",
      size: { width: 40, height: 24 },
      torch_density: 0.5,
      locked_doors: 0.1,
    });
    const r = resolveLevelOptions(record, record.levels[0], 0);
    expect(r.style).toBe("ruins");
    expect(r.difficulty).toBe("hard");
    expect(r.size).toEqual({ width: 40, height: 24 });
    expect(r.torch_density).toBe(0.5);
    expect(r.locked_doors).toBe(0.1);
    expect(r.name).toBe("Level 1");
    expect(r.depth).toBe(1);
    expect(r.floorIdx).toBe(0);
  });

  it("level overrides win over parent values", () => {
    const record = makeRecord({
      style: "caves",
      size: { width: 30, height: 20 },
      levels: [
        {
          id: "lvl_1",
          name: "Boss Floor",
          depth: 1,
          style: "ruins",
          size: { width: 50, height: 50 },
          difficulty: "boss",
          torch_density: 0,
          locked_doors: 1,
        },
      ],
    });
    const r = resolveLevelOptions(record, record.levels[0], 0);
    expect(r.style).toBe("ruins");
    expect(r.size).toEqual({ width: 50, height: 50 });
    expect(r.difficulty).toBe("boss");
    expect(r.torch_density).toBe(0);
    expect(r.locked_doors).toBe(1);
  });

  it("falls back to DUNGEON_DEFAULTS when both parent + level are missing", () => {
    // Stand-in for an older record (the_hole) missing style /
    // difficulty / size on the parent. The resolver must hand back
    // editor-default values so the dungeon still generates.
    const record: DungeonRecord = {
      id: "partial",
      name: "Partial",
      levels: [{ id: "p_1", name: "Partial 1", depth: 1 }],
    };
    const r = resolveLevelOptions(record, record.levels[0], 0);
    expect(r.style).toBe(DUNGEON_DEFAULTS.style);
    expect(r.difficulty).toBe(DUNGEON_DEFAULTS.difficulty);
    expect(r.size).toEqual(DUNGEON_DEFAULTS.size);
    expect(r.torch_density).toBe(DUNGEON_DEFAULTS.torch_density);
    expect(r.locked_doors).toBe(DUNGEON_DEFAULTS.locked_doors);
  });

  it("door frequency defaults to 1 and custom tiles to empty", () => {
    const record = makeRecord();
    const r = resolveLevelOptions(record, record.levels[0], 0);
    expect(r.doorFrequency).toBe(DUNGEON_DEFAULTS.doors);
    expect(r.doorFrequency).toBe(1);
    expect(r.customFloor).toBe("");
    expect(r.customWall).toBe("");
  });

  it("inherits door frequency + custom tiles from the parent, level overrides win", () => {
    const record = makeRecord({
      doors: 0.3,
      style: "custom",
      custom_floor: "grass",
      custom_wall: "mountain",
      levels: [
        {
          id: "lvl_1",
          name: "Level 1",
          depth: 1,
          doors: 0, // override
          custom_wall: "water", // override only the wall
        },
      ],
    });
    const r = resolveLevelOptions(record, record.levels[0], 0);
    expect(r.doorFrequency).toBe(0);
    expect(r.customFloor).toBe("grass"); // inherited
    expect(r.customWall).toBe("water"); // overridden
  });
});

describe("generateDungeonFromRecord", () => {
  it("produces one level per entry in record.levels[]", () => {
    const record = makeRecord({
      levels: [
        { id: "a", name: "A", depth: 1 },
        { id: "b", name: "B", depth: 2 },
        { id: "c", name: "C", depth: 3 },
      ],
    });
    const out = generateDungeonFromRecord(record, { seed: 1 });
    expect(out.length).toBe(3);
  });

  it("passes the parent's authored size straight through to the generator", () => {
    const record = makeRecord({
      size: { width: 28, height: 24 },
      levels: [{ id: "x", name: "X", depth: 1 }],
    });
    const [floor] = generateDungeonFromRecord(record, { seed: 7 });
    expect(floor.width).toBe(28);
    expect(floor.height).toBe(24);
  });

  it("honors a per-Level size override on just that floor", () => {
    const record = makeRecord({
      size: { width: 30, height: 20 },
      levels: [
        { id: "a", name: "A", depth: 1 },
        {
          id: "b",
          name: "B",
          depth: 2,
          size: { width: 48, height: 36 },
        },
        { id: "c", name: "C", depth: 3 },
      ],
    });
    const [f0, f1, f2] = generateDungeonFromRecord(record, { seed: 11 });
    // Parent's size applies to floors 0 and 2…
    expect({ w: f0.width, h: f0.height }).toEqual({ w: 30, h: 20 });
    expect({ w: f2.width, h: f2.height }).toEqual({ w: 30, h: 20 });
    // …but floor 1's override wins.
    expect({ w: f1.width, h: f1.height }).toEqual({ w: 48, h: 36 });
  });

  it("places no doors when doors frequency is 0, but does at the default", () => {
    // doors: 0 → an open layout with zero doorframes.
    const open = makeRecord({
      style: "ruins",
      size: { width: 40, height: 30 },
      doors: 0,
      levels: [{ id: "x", name: "X", depth: 1 }],
    });
    const [openFloor] = generateDungeonFromRecord(open, { seed: 5 });
    expect(countTile(openFloor, TILE_DDOOR)).toBe(0);

    // Same record at the default (doors omitted → 1) places doors. A
    // rooms-and-corridors ruins floor of this size reliably has at
    // least one room entrance.
    const doored = makeRecord({
      style: "ruins",
      size: { width: 40, height: 30 },
      levels: [{ id: "x", name: "X", depth: 1 }],
    });
    const [dooredFloor] = generateDungeonFromRecord(doored, { seed: 5 });
    expect(countTile(dooredFloor, TILE_DDOOR)).toBeGreaterThan(0);
  });

  it("uses the Level's authored name on the produced floor", () => {
    const record = makeRecord({
      levels: [{ id: "x", name: "Tomb Hall", depth: 1 }],
    });
    const [floor] = generateDungeonFromRecord(record, { seed: 1 });
    expect(floor.name).toBe("Tomb Hall");
  });

  it("falls back to defaults when the parent's size is missing", () => {
    const record: DungeonRecord = {
      id: "partial",
      name: "Partial",
      levels: [{ id: "p", name: "P", depth: 1 }],
    };
    const [floor] = generateDungeonFromRecord(record, { seed: 1 });
    expect(floor.width).toBe(DUNGEON_DEFAULTS.size.width);
    expect(floor.height).toBe(DUNGEON_DEFAULTS.size.height);
  });

  it("seeds floor N as (seed + N)", () => {
    // Same record, same seed → same output. Different seed → diff.
    const record = makeRecord({
      levels: [
        { id: "a", name: "A", depth: 1 },
        { id: "b", name: "B", depth: 2 },
      ],
    });
    const runA = generateDungeonFromRecord(record, { seed: 100 });
    const runB = generateDungeonFromRecord(record, { seed: 100 });
    const runC = generateDungeonFromRecord(record, { seed: 101 });
    expect(JSON.stringify(runA[0].tiles)).toBe(
      JSON.stringify(runB[0].tiles),
    );
    expect(JSON.stringify(runA[0].tiles)).not.toBe(
      JSON.stringify(runC[0].tiles),
    );
  });

  it("every non-bottom floor has a way DOWN — incl. small forest maps (regression)", () => {
    // Regression: a forest descent archway is placed BEFORE doors,
    // and its edge-carved trail looked like a corridor mouth to
    // `placeDoors`, which overwrote the archway with a door — leaving
    // small forest dungeons with no way to the next area. Sweep many
    // seeds + sizes across both forest and a non-forest style and
    // assert floor 0 of every 2-level dungeon carries a down-stair
    // (TILE_STAIRS_DOWN or its forest archway equivalent).
    const cases: Array<{ style: DungeonRecord["style"]; size: { width: number; height: number } }> = [
      { style: "forest", size: { width: 30, height: 20 } }, // small
      { style: "forest", size: { width: 40, height: 30 } }, // medium
      { style: "caves", size: { width: 30, height: 20 } },
      { style: "ruins", size: { width: 30, height: 20 } },
    ];
    for (const c of cases) {
      for (let seed = 1; seed <= 25; seed++) {
        const record = makeRecord({
          style: c.style,
          size: c.size,
          torch_density: 0.1,
          locked_doors: 0,
          levels: [
            { id: "f0", name: "Area 1", depth: 1 },
            { id: "f1", name: "Area 2", depth: 2 },
          ],
        });
        const [f0] = generateDungeonFromRecord(record, { seed });
        const downs =
          countTile(f0, TILE_STAIRS_DOWN) +
          countTile(f0, TILE_FOREST_ARCHWAY_DOWN);
        expect(
          downs,
          `no down-stair: style=${c.style} ${c.size.width}x${c.size.height} seed=${seed}`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("loot — chests", () => {
  function countChests(floor: { tiles: number[][] }): number {
    return countTile(floor, TILE_CHEST);
  }

  it("places NO chests when loot is unconfigured (opt-in)", () => {
    // No `loot` block → chests are off everywhere, every seed.
    for (let seed = 1; seed <= 15; seed++) {
      const record = makeRecord({
        size: { width: 40, height: 30 },
        levels: [{ id: "f0", name: "F0", depth: 1 }],
      });
      const [f0] = generateDungeonFromRecord(record, { seed });
      expect(countChests(f0)).toBe(0);
      expect(f0.chestItem).toBe("");
    }
  });

  it("places chests + binds the chest item when loot.chest_item is set", () => {
    // A high frequency makes a placement near-certain across rooms; we
    // assert at least one seed in the sweep yields a chest and that the
    // floor records the configured chest item id.
    let sawChest = false;
    for (let seed = 1; seed <= 15; seed++) {
      const record = makeRecord({
        size: { width: 40, height: 30 },
        loot: { chest_item: "iron_chest", chest_frequency: 1 },
        levels: [{ id: "f0", name: "F0", depth: 1 }],
      });
      const [f0] = generateDungeonFromRecord(record, { seed });
      expect(f0.chestItem).toBe("iron_chest");
      if (countChests(f0) > 0) sawChest = true;
    }
    expect(sawChest).toBe(true);
  });

  it("frequency 0 places no chests even with a chest item set", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const record = makeRecord({
        size: { width: 40, height: 30 },
        loot: { chest_item: "iron_chest", chest_frequency: 0 },
        levels: [{ id: "f0", name: "F0", depth: 1 }],
      });
      const [f0] = generateDungeonFromRecord(record, { seed });
      // The item id still rides on the floor (so any manually-placed
      // chest would bind), but the probability-0 loop places none.
      expect(countChests(f0)).toBe(0);
    }
  });

  it("resolveLevelOptions inherits + overrides loot field-by-field", () => {
    const record = makeRecord({
      loot: { chest_item: "iron_chest", chest_frequency: 0.4 },
      levels: [
        { id: "a", name: "A", depth: 1 }, // inherits both
        {
          id: "b",
          name: "B",
          depth: 2,
          loot: { chest_frequency: 0.9 }, // overrides freq, inherits item
        },
        {
          id: "c",
          name: "C",
          depth: 3,
          loot: { chest_item: "" }, // explicit "no chests" on this floor
        },
      ],
    });
    const a = resolveLevelOptions(record, record.levels[0], 0);
    expect(a.chestItem).toBe("iron_chest");
    expect(a.chestFrequency).toBe(0.4);

    const b = resolveLevelOptions(record, record.levels[1], 1);
    expect(b.chestItem).toBe("iron_chest"); // inherited
    expect(b.chestFrequency).toBe(0.9); // overridden

    const c = resolveLevelOptions(record, record.levels[2], 2);
    expect(c.chestItem).toBe(""); // explicitly cleared → no chests
  });

  it("defaults chest_frequency when an item is set but frequency omitted", () => {
    const record = makeRecord({
      loot: { chest_item: "iron_chest" },
      levels: [{ id: "f0", name: "F0", depth: 1 }],
    });
    const r = resolveLevelOptions(record, record.levels[0], 0);
    expect(r.chestItem).toBe("iron_chest");
    expect(r.chestFrequency).toBe(DUNGEON_DEFAULTS.loot.chest_frequency);
  });
});

describe("torchProfileFromProbability", () => {
  it("returns a zero-count profile for p === 0", () => {
    const prof = torchProfileFromProbability(0);
    expect(prof.maxMultiplier).toBe(0);
    expect(prof.includeCorridors).toBe(false);
    // minSpacing is effectively infinite so the placement loop
    // never accepts a candidate even if the multiplier rounds up.
    expect(prof.minSpacing).toBeGreaterThan(100);
  });

  it("scales the torch count linearly with the probability", () => {
    const low = torchProfileFromProbability(0.1);
    const mid = torchProfileFromProbability(0.5);
    const high = torchProfileFromProbability(1);
    expect(low.maxMultiplier).toBeLessThan(mid.maxMultiplier);
    expect(mid.maxMultiplier).toBeLessThan(high.maxMultiplier);
  });

  it("tightens minSpacing as probability rises", () => {
    const low = torchProfileFromProbability(0.05);
    const high = torchProfileFromProbability(0.9);
    expect(low.minSpacing).toBeGreaterThanOrEqual(high.minSpacing);
  });

  it("includes corridor walls only at higher probabilities", () => {
    expect(torchProfileFromProbability(0.1).includeCorridors).toBe(false);
    expect(torchProfileFromProbability(0.6).includeCorridors).toBe(true);
  });

  it("clamps minSpacing at a hard floor (≥ 2)", () => {
    expect(torchProfileFromProbability(1).minSpacing).toBeGreaterThanOrEqual(2);
  });
});
