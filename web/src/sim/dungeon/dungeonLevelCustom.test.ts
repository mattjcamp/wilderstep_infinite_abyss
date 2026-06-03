import { describe, it, expect } from "vitest";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { TILE_DWALL, type DungeonLevel } from "@/battle/world/Dungeon";
import { TILE_DFLOOR } from "@/battle/world/Tiles";

/** Build a tiny 3×3 custom floor: a ring of walls around one floor
 *  cell. The generator carves custom floors with the GENERIC numeric
 *  TILE_DFLOOR / TILE_DWALL (identical to ruins) — it's the converter
 *  that swaps the sprites for the author's palette ids. */
function customFloor(
  customFloorId: string,
  customWallId: string,
): DungeonLevel {
  const W = TILE_DWALL;
  const F = TILE_DFLOOR;
  const tiles = [
    [W, W, W],
    [W, F, W],
    [W, W, W],
  ];
  return {
    name: "F",
    width: 3,
    height: 3,
    tiles,
    decorations: {},
    tileProperties: {},
    entryCol: 1,
    entryRow: 1,
    style: "custom",
    monsters: [],
    openedChests: new Set<string>(),
    triggeredTraps: new Set<string>(),
    detectedTraps: new Set<string>(),
    exploredTiles: new Set<string>(),
    overworldExits: new Set<string>(),
    questArtifacts: {},
    chestItem: "",
    customFloor: customFloorId,
    customWall: customWallId,
  };
}

const palette = new Map<string, string>([
  ["grass", "map/grass1.png"],
  ["mountain", "map/mountains.png"],
]);

describe("dungeonLevelToMap — custom style palette swap", () => {
  it("paints the chosen floor/wall sprites and forces walkability/sight flags", () => {
    const map = dungeonLevelToMap(customFloor("grass", "mountain"), {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
      customTileSprites: palette,
    });

    // Floor cell: the grass sprite, forced walkable + transparent
    // even though grass authored obstructs=false (here we assert the
    // FORCED outcome regardless of palette flags).
    const floor = map.grid[1][1];
    expect(floor.sprite).toBe("map/grass1.png");
    expect(floor.walkable).toBe(true);
    expect(floor.obstructs).toBe(false);

    // Wall cell: the mountain sprite, forced blocking + opaque. This is
    // the "force wall = blocking" guarantee — solvable layouts no matter
    // what the author's wall tile claims about itself.
    const wall = map.grid[0][0];
    expect(wall.sprite).toBe("map/mountains.png");
    expect(wall.walkable).toBe(false);
    expect(wall.obstructs).toBe(true);
  });

  it("falls back to the stone dungeon sprite when a palette id is missing", () => {
    // An unresolved palette id (typo / deleted tile) must still render a
    // playable dungeon rather than a blank cell — the ruins floor/wall
    // sprite shows through, and the forced flags still apply.
    const map = dungeonLevelToMap(customFloor("nope", "alsonope"), {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
      customTileSprites: palette,
    });
    const floor = map.grid[1][1];
    const wall = map.grid[0][0];
    // Sprites keep the default ruins prototype's art (non-empty), and
    // the floor/wall flags are still forced.
    expect(floor.sprite).toBeTruthy();
    expect(floor.walkable).toBe(true);
    expect(wall.walkable).toBe(false);
    expect(wall.obstructs).toBe(true);
  });

  it("leaves a non-custom (ruins) floor untouched by the palette", () => {
    const lvl = customFloor("grass", "mountain");
    lvl.style = "ruins";
    const map = dungeonLevelToMap(lvl, {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
      customTileSprites: palette,
    });
    // Ruins floor keeps the stone-dungeon sprite — NOT the grass swap.
    expect(map.grid[1][1].sprite).not.toBe("map/grass1.png");
  });
});
