import { describe, it, expect } from "vitest";
import {
  generateDungeonFromRecord,
  resolveLevelOptions,
} from "./generateFromRecord";
import { torchProfileFromProbability } from "@/battle/world/Dungeon";
import { DUNGEON_DEFAULTS, type DungeonRecord } from "./types";

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
