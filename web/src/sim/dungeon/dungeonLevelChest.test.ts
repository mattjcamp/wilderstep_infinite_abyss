import { describe, it, expect } from "vitest";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { TILE_CHEST, type DungeonLevel } from "@/battle/world/Dungeon";
import { TILE_DFLOOR } from "@/battle/world/Tiles";

/** Build a tiny 3×3 ruins floor with a single chest at (1,1) and the
 *  given `chestItem`. Only the fields the converter reads matter. */
function chestFloor(chestItem: string): DungeonLevel {
  const F = TILE_DFLOOR;
  const tiles = [
    [F, F, F],
    [F, TILE_CHEST, F],
    [F, F, F],
  ];
  return {
    name: "F",
    width: 3,
    height: 3,
    tiles,
    decorations: {},
    tileProperties: {},
    entryCol: 0,
    entryRow: 0,
    style: "ruins",
    monsters: [],
    openedChests: new Set<string>(),
    triggeredTraps: new Set<string>(),
    detectedTraps: new Set<string>(),
    exploredTiles: new Set<string>(),
    overworldExits: new Set<string>(),
    questArtifacts: {},
    chestItem,
  };
}

describe("dungeonLevelToMap — chest item binding", () => {
  it("stamps the configured chest item onto the chest cell", () => {
    const map = dungeonLevelToMap(chestFloor("iron_chest"), {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
    });
    const cell = map.grid[1][1];
    // The item binding is what routes the bump through the
    // chest_encountered pipeline (the item is is_chest:true).
    expect(cell.item).toBe("iron_chest");
    // Identity + render bits still mark it a chest cell.
    expect(cell.id).toBe("chest");
    expect(cell.walkable).toBe(true);
    expect(cell.placedItemSprite).toBe("map/chest_tile.png");
  });

  it("leaves the chest cell item empty when no chest item is configured", () => {
    // Legacy floors generated before loot config carry chestItem "".
    const map = dungeonLevelToMap(chestFloor(""), {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
    });
    const cell = map.grid[1][1];
    expect(cell.item).toBe("");
    // Still renders as a (contents-less) chest overlay as before.
    expect(cell.id).toBe("chest");
    expect(cell.placedItemSprite).toBe("map/chest_tile.png");
  });

  it("only the chest cell gets the item — surrounding floor stays clear", () => {
    const map = dungeonLevelToMap(chestFloor("iron_chest"), {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
    });
    expect(map.grid[0][0].item).toBe("");
    expect(map.grid[1][1].item).toBe("iron_chest");
  });
});
