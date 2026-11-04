import { describe, it, expect } from "vitest";
import {
  generateDungeonLevel,
  TILE_PIT,
  TILE_DWALL,
  TILE_STAIRS,
  TILE_STAIRS_DOWN,
  TILE_CHEST,
  TILE_TRAP,
  type DungeonLevel,
  type DungeonStyle,
} from "@/battle/world/Dungeon";
import { TILE_DFLOOR, TILE_DDOOR, TILE_LOCKED_DOOR } from "@/battle/world/Tiles";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { DUNGEON_PALETTE_IDS } from "./tileMapping";
import { resolveLevelOptions } from "./generateFromRecord";
import type { DungeonRecord } from "./types";

const encounters = {
  dungeon: [
    {
      id: "rats", area: "dungeon", name: "Rats", level: 1, weight: 1,
      monsterPartyTile: "rat", monsters: ["rat"], tags: [],
    },
  ],
} as unknown as Parameters<typeof generateDungeonLevel>[0]["encounters"];

function gen(style: DungeonStyle, seed: number, pits: number): DungeonLevel {
  return generateDungeonLevel({
    name: "F", width: 40, height: 30, style, difficulty: "normal",
    floorIdx: 0, placeStairsDown: true, lockProbability: 0,
    torchProbability: 0.2, chestItemId: "chest", chestProbability: 0.6,
    pitProbability: pits, encounters, seed,
  });
}

/** Cells reachable from the entry, treating pits + walls as blocking
 *  and every door (locked or not) as passable. */
function reachable(l: DungeonLevel): Set<string> {
  const blocked = new Set([TILE_DWALL, TILE_PIT]);
  const seen = new Set<string>([`${l.entryCol},${l.entryRow}`]);
  const q: Array<[number, number]> = [[l.entryCol, l.entryRow]];
  while (q.length) {
    const [c, r] = q.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      const t = l.tiles[nr]?.[nc];
      if (t === undefined || blocked.has(t)) continue;
      const k = `${nc},${nr}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nc, nr]);
    }
  }
  return seen;
}

describe("pit generation", () => {
  it("pits: 0 places no pits", () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(gen("dungeon", seed, 0).tiles.flat()).not.toContain(TILE_PIT);
    }
  });

  it("pits never cut off anything that was reachable without them", () => {
    let total = 0;
    for (const style of ["dungeon", "cavern"] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const base = gen(style, seed, 0);
        const pitted = gen(style, seed, 1);
        const pitCells = new Set<string>();
        pitted.tiles.forEach((row, r) =>
          row.forEach((t, c) => { if (t === TILE_PIT) pitCells.add(`${c},${r}`); }),
        );
        total += pitCells.size;
        // Same layout apart from the pits (the pit pass runs last).
        base.tiles.forEach((row, r) =>
          row.forEach((t, c) => {
            if (!pitCells.has(`${c},${r}`)) expect(pitted.tiles[r][c]).toBe(t);
            else expect(t).toBe(TILE_DFLOOR);
          }),
        );
        const before = reachable(base);
        const after = reachable(pitted);
        for (const k of before) {
          if (!pitCells.has(k)) expect(after.has(k), `${style} seed ${seed} lost ${k}`).toBe(true);
        }
        // Monsters and the entry are never inside a pit.
        for (const m of pitted.monsters) expect(pitCells.has(`${m.col},${m.row}`)).toBe(false);
        expect(pitCells.has(`${pitted.entryCol},${pitted.entryRow}`)).toBe(false);
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it("every pit is ringed by walkable floor — never touching walls, doors or stairs", () => {
    const ringOk = new Set([TILE_DFLOOR, TILE_CHEST, TILE_TRAP, TILE_STAIRS, TILE_STAIRS_DOWN, TILE_PIT]);
    for (let seed = 1; seed <= 30; seed++) {
      const l = gen("dungeon", seed, 1);
      l.tiles.forEach((row, r) =>
        row.forEach((t, c) => {
          if (t !== TILE_PIT) return;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const n = l.tiles[r + dr][c + dc];
              expect(ringOk.has(n)).toBe(true);
              expect(n).not.toBe(TILE_DDOOR);
              expect(n).not.toBe(TILE_LOCKED_DOOR);
            }
          }
        }),
      );
    }
  });

  it("pits inherit level → parent → default 0", () => {
    const rec: DungeonRecord = {
      id: "d", name: "D", pits: 0.4,
      levels: [
        { id: "a", name: "A", depth: 1 },
        { id: "b", name: "B", depth: 2, pits: 0 },
      ],
    };
    expect(resolveLevelOptions(rec, rec.levels[0], 0).pitFrequency).toBe(0.4);
    expect(resolveLevelOptions(rec, rec.levels[1], 1).pitFrequency).toBe(0);
    const bare: DungeonRecord = { id: "e", name: "E", levels: [{ id: "a", name: "A", depth: 1 }] };
    expect(resolveLevelOptions(bare, bare.levels[0], 0).pitFrequency).toBe(0);
  });
});

/** Hand-built floor: a 3×2 pit at cols 2–4, rows 2–3 and a single hole
 *  at (7,2), all ringed by floor. */
function pitFloor(style: DungeonStyle): DungeonLevel {
  const F = TILE_DFLOOR, P = TILE_PIT, W = TILE_DWALL;
  const tiles = [
    [W, W, W, W, W, W, W, W, W, W],
    [W, F, F, F, F, F, F, F, F, W],
    [W, F, P, P, P, F, F, P, F, W],
    [W, F, P, P, P, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, F, W],
    [W, W, W, W, W, W, W, W, W, W],
  ];
  return {
    name: "P", width: 10, height: 6, tiles, decorations: {}, tileProperties: {},
    entryCol: 1, entryRow: 1, style, monsters: [],
    openedChests: new Set(), triggeredTraps: new Set(), detectedTraps: new Set(),
    exploredTiles: new Set(), overworldExits: new Set(), questArtifacts: {}, chestItem: "",
  };
}

describe("pit rim pieces", () => {
  const palette = new Map(DUNGEON_PALETTE_IDS.map((id) => [id, `sprite/${id}.png`]));
  for (const [style, prefix] of [["dungeon", "dungeon"], ["cavern", "cave"]] as const) {
    it(`${style}: picks corners / edges / single hole, blocks movement not sight`, () => {
      const map = dungeonLevelToMap(pitFloor(style), {
        dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette,
      });
      const id = (c: number, r: number) => map.grid[r][c].id;
      expect(id(2, 2)).toBe(`${prefix}_pit_corner_tl`);
      expect(id(3, 2)).toBe(`${prefix}_pit_top`);
      expect(id(4, 2)).toBe(`${prefix}_pit_corner_tr`);
      expect(id(2, 3)).toBe(`${prefix}_pit_corner_bl`);
      expect(id(3, 3)).toBe(`${prefix}_pit_bottom`);
      expect(id(4, 3)).toBe(`${prefix}_pit_corner_br`);
      expect(id(7, 2)).toBe(`${prefix}_pit`);
      const tl = map.grid[2][2];
      expect(tl.sprite).toBe(`sprite/${prefix}_pit_corner_tl.png`);
      expect(tl.background_sprite).toBe(`sprite/${prefix}_pit_centre.png`);
      for (const [c, r] of [[2, 2], [3, 3], [7, 2]]) {
        expect(map.grid[r][c].walkable).toBe(false);
        expect(map.grid[r][c].obstructs).toBe(false);
      }
    });
  }

  it("a pit 3 deep gets left / centre / right in its middle row", () => {
    const l = pitFloor("dungeon");
    l.tiles.splice(3, 0, [TILE_DWALL, TILE_DFLOOR, TILE_PIT, TILE_PIT, TILE_PIT, TILE_DFLOOR, TILE_DFLOOR, TILE_DFLOOR, TILE_DFLOOR, TILE_DWALL]);
    l.height = 7;
    const map = dungeonLevelToMap(l, { dungeonId: "d", floorIdx: 0, totalFloors: 1 });
    expect(map.grid[3][2].id).toBe("dungeon_pit_left");
    expect(map.grid[3][3].id).toBe("dungeon_pit_centre");
    expect(map.grid[3][4].id).toBe("dungeon_pit_right");
  });
});
