import { describe, it, expect } from "vitest";
import { autotileDungeonWalls, DUNGEON_TILESET_WALL_IDS as IDS } from "./dungeonAutotile";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { generateDungeonLevel } from "@/battle/world/Dungeon";
import { DUNGEON_PALETTE_IDS } from "./tileMapping";

type Cell = { id: string; name: string; sprite: string; walkable: boolean; background_sprite?: string };

/** ASCII → grid: '#' wall, '.' floor. */
function grid(rows: string[]): Cell[][] {
  return rows.map((row) =>
    [...row].map((ch) =>
      ch === "#"
        ? { id: "dungeon_wall", name: "W", sprite: "", walkable: false }
        : { id: "floor", name: "F", sprite: "floor.png", walkable: true },
    ),
  );
}
const sprites = new Map(Object.values(IDS).map((id) => [id, `${id}.png`]));
const run = (g: Cell[][]) =>
  autotileDungeonWalls(g, { isWall: (c) => c.id === "dungeon_wall" || c.id.startsWith("dungeon_wall_") || c.id === "dungeon_pit_centre", sprites, floorSprite: "floor.png" });

describe("autotileDungeonWalls", () => {
  it("frames a room: face on top + bottom, strips on the sides, black rock beyond", () => {
    const g = grid([
      "#######",
      "##...##",
      "##...##",
      "#######",
      "#######",
    ]);
    run(g);
    expect(g[0][3].id).toBe(IDS.faceTop); // floor below
    expect(g[3][3].id).toBe(IDS.faceBottom); // floor above
    expect(g[1][1].id).toBe(IDS.left); // room to the east
    expect(g[1][5].id).toBe(IDS.right); // room to the west
    expect(g[1][1].background_sprite).toBe("floor.png"); // strips sit on floor
    expect(g[0][3].background_sprite).toBe(`${IDS.rock}.png`); // faces sit on black
    expect(g[4][3].background_sprite).toBeUndefined(); // rock needs none
    expect(g[4][3].id).toBe(IDS.rock); // nothing open around
    expect(g[1][0].id).toBe(IDS.rock);
  });

  it("puts corners where the top face meets the side strips", () => {
    const g = grid([
      "#####",
      "#...#",
      "#...#",
      "#####",
    ]);
    // Make the room's side walls run up into the face row: the face
    // cells above the strips become corners.
    // Two rooms sharing a wall: the shared wall is a divider, with a
    // T (down) where it meets the top face and a T (up) at the bottom.
    const g2 = grid([
      "#######",
      "#..#..#",
      "#..#..#",
      "#######",
    ]);
    run(g);
    run(g2);
    // Outer corners sit on top of the side strips → corner pieces.
    expect(g[1][0].id).toBe(IDS.left);
    expect(g[0][0].id).toBe(IDS.cornerTl);
    expect(g[0][4].id).toBe(IDS.cornerTr);
    expect(g[0][2].id).toBe(IDS.faceTop);
    expect(g2[1][3].id).toBe(IDS.divider);
    expect(g2[2][3].id).toBe(IDS.divider);
    expect(g2[0][3].id).toBe(IDS.tDown);
    expect(g2[3][3].id).toBe(IDS.tUp);
  });

  it("keeps an id when asked (wall torches stay torches)", () => {
    const g = grid(["###", "#.#", "###"]);
    g[0][1].id = "wall_torch";
    autotileDungeonWalls(g, {
      isWall: (c) => !c.walkable,
      sprites,
      floorSprite: "floor.png",
      keepId: (c) => c.id === "wall_torch",
    });
    expect(g[0][1].id).toBe("wall_torch");
    expect(g[0][1].sprite).toBe(`${IDS.faceTop}.png`);
  });
});

describe("dungeon style — full generated floor", () => {
  it("paints every cell with Dungeon Tileset art and keeps the layout playable", () => {
    const level = generateDungeonLevel({
      name: "F1",
      width: 40,
      height: 30,
      style: "dungeon",
      difficulty: "normal",
      floorIdx: 0,
      placeStairsDown: true,
      lockProbability: 0.3,
      torchProbability: 0.1,
      seed: 1234,
    });
    // Palette: every id the dungeon prototypes can borrow → a fake path.
    const palette = new Map(DUNGEON_PALETTE_IDS.map((id) => [id, `sprite/${id}.png`]));
    const map = dungeonLevelToMap(level, { dungeonId: "d", floorIdx: 0, totalFloors: 2, customTileSprites: palette });
    const ids = new Set<string>();
    let walls = 0;
    let floors = 0;
    for (const row of map.grid) {
      for (const cell of row) {
        expect(cell.sprite).not.toBe(""); // no blank cells
        ids.add(cell.id);
        if (cell.walkable) floors++;
        else walls++;
        // Generic placeholder walls must all have been autotiled.
        expect(cell.id).not.toBe("dungeon_wall");
        // Strip walls carry the floor underneath.
        if ([IDS.left, IDS.right, IDS.divider].includes(cell.id as never)) {
          expect(cell.background_sprite).toBe("sprite/dungeon_floor_flagstone.png");
        }
      }
    }
    expect(floors).toBeGreaterThan(50);
    expect(walls).toBeGreaterThan(50);
    expect(ids.has("dungeon_floor_flagstone")).toBe(true);
    expect(ids.has(IDS.faceTop)).toBe(true);
    expect(ids.has(IDS.rock)).toBe(true);
    expect(ids.has("stairs_up")).toBe(true);
    // Doors get the rock backing too.
    for (const row of map.grid) for (const cell of row) {
      if (cell.id === "dungeon_door" || cell.id === "door_locked") {
        expect(cell.background_sprite).toBe("sprite/dungeon_pit_centre.png");
      }
    }
    // At least one side strip — rooms have side walls.
    expect(ids.has(IDS.left) || ids.has(IDS.right) || ids.has(IDS.divider)).toBe(true);
  });
});
