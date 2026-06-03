import { describe, it, expect } from "vitest";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import {
  TILE_DWALL,
  TILE_TRAP,
  TILE_STAIRS,
  TILE_STAIRS_DOWN,
  type DungeonLevel,
} from "@/battle/world/Dungeon";
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
  ["portal1", "map/portal.png"],
  ["moongate", "map/moongate.png"],
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

  it("conceals a trap as the custom floor (hidden until detected)", () => {
    // A trap sits at the center; the surrounding ring is wall. The trap
    // must render with the SAME sprite as the custom floor so the player
    // can't spot it by a mismatched tile — but the trap flag stays so
    // detection / triggering still work.
    const lvl = customFloor("grass", "mountain");
    lvl.tiles[1][1] = TILE_TRAP;
    const map = dungeonLevelToMap(lvl, {
      dungeonId: "d",
      floorIdx: 0,
      totalFloors: 1,
      customTileSprites: palette,
    });
    const trap = map.grid[1][1];
    expect(trap.sprite).toBe("map/grass1.png"); // looks like floor
    expect(trap.trap).toBe(true); // still a trap underneath
    expect(trap.walkable).toBe(true); // you can step onto it (to trigger)
  });

  it("paints custom transition sprites on stairs while keeping their links", () => {
    // Up-stairs at (1,1), down-stairs at (0,1). Both should render the
    // chosen transition sprite but keep their floor-link (so the party
    // can still traverse) and stay walkable.
    const lvl = customFloor("grass", "mountain");
    lvl.customStairsUp = "portal1";
    lvl.customStairsDown = "moongate";
    lvl.tiles[1][1] = TILE_STAIRS;
    lvl.tiles[1][0] = TILE_STAIRS_DOWN;
    const map = dungeonLevelToMap(lvl, {
      dungeonId: "d",
      floorIdx: 1, // not the entrance floor, so up-stairs links to F0
      totalFloors: 3,
      customTileSprites: palette,
    });
    const up = map.grid[1][1];
    const down = map.grid[1][0];
    expect(up.sprite).toBe("map/portal.png");
    expect(down.sprite).toBe("map/moongate.png");
    // Links survive the cosmetic swap (a transition with no link is a
    // dead end — this guards the regression).
    expect(up.link).not.toBeNull();
    expect(down.link).not.toBeNull();
    expect(up.walkable).toBe(true);
    expect(down.walkable).toBe(true);
  });

  it("keeps the default stairs sprite when no transition tile is set", () => {
    const lvl = customFloor("grass", "mountain");
    lvl.tiles[1][1] = TILE_STAIRS;
    const map = dungeonLevelToMap(lvl, {
      dungeonId: "d",
      floorIdx: 1,
      totalFloors: 2,
      customTileSprites: palette,
    });
    // No customStairsUp → the up-stairs keeps its built-in sprite (not a
    // floor/wall swap), so it's neither the floor nor wall custom art.
    const up = map.grid[1][1];
    expect(up.sprite).not.toBe("map/grass1.png");
    expect(up.sprite).not.toBe("map/mountains.png");
    expect(up.link).not.toBeNull();
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
