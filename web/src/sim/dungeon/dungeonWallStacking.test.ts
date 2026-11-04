import { describe, it, expect } from "vitest";
import {
  generateDungeonLevel,
  TILE_DWALL,
  type DungeonLevel,
} from "@/battle/world/Dungeon";
import { TILE_DFLOOR, TILE_DDOOR, TILE_LOCKED_DOOR } from "@/battle/world/Tiles";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { DUNGEON_PALETTE_IDS } from "./tileMapping";

const isDoor = (t: number | undefined) => t === TILE_DDOOR || t === TILE_LOCKED_DOOR;

describe("doors only sit in horizontal walls", () => {
  it("every door has wall to its west and east — side-wall openings are open gaps", () => {
    for (const style of ["dungeon", "cavern"] as const) {
      for (let seed = 1; seed <= 120; seed++) {
        const l = generateDungeonLevel({
          name: "F", width: 40, height: 30, style, difficulty: "normal",
          floorIdx: 0, placeStairsDown: true, lockProbability: 0.5,
          torchProbability: 0.15, seed,
        });
        l.tiles.forEach((row, r) =>
          row.forEach((t, c) => {
            if (!isDoor(t)) return;
            expect(row[c - 1], `${style} seed ${seed} (${c},${r}) W`).toBe(TILE_DWALL);
            expect(row[c + 1], `${style} seed ${seed} (${c},${r}) E`).toBe(TILE_DWALL);
          }),
        );
      }
    }
  });
});

describe("generator never stacks doors", () => {
  it("no door touches another door, vertically or side by side", () => {
    for (const style of ["dungeon", "cavern"] as const) {
      for (let seed = 1; seed <= 120; seed++) {
        const l = generateDungeonLevel({
          name: "F", width: 40, height: 30, style, difficulty: "normal",
          floorIdx: 0, placeStairsDown: true, lockProbability: 0.5,
          torchProbability: 0.15, seed,
        });
        l.tiles.forEach((row, r) =>
          row.forEach((t, c) => {
            if (!isDoor(t)) return;
            expect(isDoor(l.tiles[r + 1]?.[c]), `${style} seed ${seed} (${c},${r}) ↓`).toBe(false);
            expect(isDoor(row[c + 1]), `${style} seed ${seed} (${c},${r}) →`).toBe(false);
          }),
        );
      }
    }
  });
});

function level(tiles: number[][]): DungeonLevel {
  return {
    name: "W", width: tiles[0].length, height: tiles.length, tiles,
    decorations: {}, tileProperties: {}, entryCol: 1, entryRow: 1,
    style: "dungeon", monsters: [], openedChests: new Set(),
    triggeredTraps: new Set(), detectedTraps: new Set(), exploredTiles: new Set(),
    overworldExits: new Set(), questArtifacts: {}, chestItem: "",
  };
}

describe("two-thick walls between rooms", () => {
  const F = TILE_DFLOOR, W = TILE_DWALL, D = TILE_DDOOR;
  // Room above (rows 1–2), a two-thick wall (rows 3–4) crossed by a
  // corridor (col 4) with one door in the lower row, room below (5–6).
  const tiles = [
    [W, W, W, W, W, W, W, W, W],
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, W],
    [W, W, W, W, F, W, W, W, W],
    [W, W, W, W, D, W, W, W, W],
    [W, F, F, F, F, F, F, F, W],
    [W, F, F, F, F, F, F, F, W],
    [W, W, W, W, W, W, W, W, W],
  ];
  const map = dungeonLevelToMap(level(tiles), { dungeonId: "d", floorIdx: 0, totalFloors: 1 });
  const id = (c: number, r: number) => map.grid[r][c].id;

  it("the upper row is wall top, only the lower row is a brick face", () => {
    for (const c of [2, 3, 5, 6]) expect(id(c, 4)).toBe("dungeon_wall_top");
    // Solid rock away from the passage; side strips edge the passage.
    expect(id(2, 3)).toBe("dungeon_pit_centre");
    expect(id(6, 3)).toBe("dungeon_pit_centre");
    expect(id(3, 3)).toBe("dungeon_wall_left");
    expect(id(5, 3)).toBe("dungeon_wall_right");
    // The corridor passes through the wall top to the single door.
    expect(id(4, 3)).toBe("dungeon_floor_flagstone");
    expect(id(4, 4)).toBe("dungeon_door");
  });

  it("an ordinary single-thick bottom wall keeps its brick face", () => {
    expect(id(3, 7)).toBe("dungeon_wall_top");
  });

  it("a thick wall ending beside open floor doesn't stack faces (screenshot case)", () => {
    const end = [
      [W, W, W, W, W, W, W],
      [W, F, F, F, F, F, W],
      [W, F, W, W, W, W, W],
      [W, F, W, W, W, W, W],
      [W, F, F, F, F, F, W],
      [W, W, W, W, W, W, W],
    ];
    const m = dungeonLevelToMap(level(end), { dungeonId: "d", floorIdx: 0, totalFloors: 1 });
    expect(m.grid[3][2].id).toBe("dungeon_wall_top");
    expect(m.grid[2][2].id).toBe("dungeon_wall_right");
    expect(m.grid[2][4].id).toBe("dungeon_pit_centre");
  });

  it("a lone wall stub with floor on both sides becomes a divider, not a black hole", () => {
    const stub = [
      [W, W, W, W, W, W, W],
      [W, F, F, F, F, F, W],
      [W, F, F, W, F, F, W],
      [W, F, F, W, F, F, W],
      [W, F, F, F, F, F, W],
      [W, W, W, W, W, W, W],
    ];
    const m = dungeonLevelToMap(level(stub), { dungeonId: "d", floorIdx: 0, totalFloors: 1 });
    expect(m.grid[2][3].id).toBe("dungeon_wall_divider");
    expect(m.grid[3][3].id).toBe("dungeon_wall_t_up");
  });
});

describe("generated floors never stack brick faces", () => {
  const FACE = /_(wall_top|wall_corner_tl|wall_corner_tr|wall_t_down|wall_t_up)$/;
  it("no face-type wall piece sits directly above another", () => {
    for (const style of ["dungeon", "cavern"] as const) {
      for (let seed = 1; seed <= 80; seed++) {
        const l = generateDungeonLevel({
          name: "F", width: 40, height: 30, style, difficulty: "normal",
          floorIdx: 0, placeStairsDown: true, lockProbability: 0.3,
          torchProbability: 0.3, pitProbability: 0.5, seed,
        });
        const palette = new Map(DUNGEON_PALETTE_IDS.map((id) => [id, `s/${id}.png`]));
        const m = dungeonLevelToMap(l, { dungeonId: "d", floorIdx: 0, totalFloors: 2, paletteSprites: palette });
        for (let r = 0; r + 1 < m.grid.length; r++) {
          for (let c = 0; c < m.grid[r].length; c++) {
            const up = m.grid[r][c], dn = m.grid[r + 1][c];
            const isFace = (cell: { id: string; sprite: string }) =>
              FACE.test(cell.id) || FACE.test(cell.sprite.replace(/\.png$/, ""));
            const upFace = isFace(up);
            const dnFace = isFace(dn);
            expect(upFace && dnFace, `${style} seed ${seed} (${c},${r})`).toBe(false);
          }
        }
      }
    }
  });
});
