import { describe, it, expect } from "vitest";
import { generateDungeonFromRecord, resolveLevelOptions } from "./generateFromRecord";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { TILE_TRAP } from "@/battle/world/Dungeon";
import type { DungeonRecord } from "./types";

function record(over: Partial<DungeonRecord> = {}): DungeonRecord {
  return {
    id: "trap_test",
    name: "Trap Test",
    style: "dungeon",
    difficulty: "normal",
    size: { width: 48, height: 40 },
    torch_density: 0.1,
    locked_doors: 0,
    levels: [
      { id: "f0", name: "Area 1", depth: 1 },
      { id: "f1", name: "Area 2", depth: 2 },
    ],
    ...over,
  };
}

const trapCount = (tiles: number[][]) =>
  tiles.flat().filter((t) => t === TILE_TRAP).length;

describe("dungeon trap settings", () => {
  it("defaults to the historical 0.35 rate and the default trap", () => {
    const r = record();
    const opts = resolveLevelOptions(r, r.levels[0], 0);
    expect(opts.trapFrequency).toBe(0.35);
    expect(opts.trapTypes).toEqual([]);
  });

  it("traps: 0 places no traps; 1 places more than the default", () => {
    let none = 0, all = 0, def = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      none += trapCount(generateDungeonFromRecord(record({ traps: 0 }), { seed })[0].tiles);
      all += trapCount(generateDungeonFromRecord(record({ traps: 1 }), { seed })[0].tiles);
      def += trapCount(generateDungeonFromRecord(record(), { seed })[0].tiles);
    }
    expect(none).toBe(0);
    expect(all).toBeGreaterThan(def);
  });

  it("changing the trap rate leaves the rest of the floor unchanged", () => {
    const a = generateDungeonFromRecord(record({ traps: 0 }), { seed: 9 })[0];
    const b = generateDungeonFromRecord(record({ traps: 1 }), { seed: 9 })[0];
    const strip = (t: number[][]) => t.map((row) => row.map((v) => (v === TILE_TRAP ? -1 : v)));
    const sa = strip(a.tiles), sb = strip(b.tiles);
    for (let r = 0; r < sa.length; r++)
      for (let c = 0; c < sa[r].length; c++)
        if (sb[r][c] !== -1) expect(sa[r][c]).toBe(sb[r][c]);
  });

  it("stamps trap_id from the weighted mix onto trap cells", () => {
    const rec = record({
      traps: 1,
      trap_types: [{ trap_id: "fire_trap", weight: 1 }, { trap_id: "dart_trap", weight: 1 }],
    });
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const lvl = generateDungeonFromRecord(rec, { seed })[0];
      const map = dungeonLevelToMap(lvl, { dungeonId: "trap_test", floorIdx: 0, totalFloors: 2 });
      for (const row of map.grid) for (const cell of row) {
        if (cell.trap) {
          expect(cell.trap_id).toBeDefined();
          seen.add(cell.trap_id!);
        }
      }
    }
    expect(seen).toEqual(new Set(["fire_trap", "dart_trap"]));
  });

  it("a Level's trap settings override the parent's; ids omitted with no mix", () => {
    const rec = record({ traps: 1, trap_types: [{ trap_id: "fire_trap" }] });
    rec.levels[1] = { ...rec.levels[1], traps: 0.5, trap_types: [{ trap_id: "dart_trap", weight: 2 }, { trap_id: "", weight: 1 }] };
    const o0 = resolveLevelOptions(rec, rec.levels[0], 0);
    const o1 = resolveLevelOptions(rec, rec.levels[1], 1);
    expect(o0.trapTypes).toEqual([{ trap_id: "fire_trap", weight: 1 }]);
    expect(o1.trapFrequency).toBe(0.5);
    expect(o1.trapTypes).toEqual([{ trap_id: "dart_trap", weight: 2 }]);
    const plain = generateDungeonFromRecord(record({ traps: 1 }), { seed: 2 })[0];
    expect(plain.trapIds).toBeUndefined();
  });
});
