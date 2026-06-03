import { describe, it, expect } from "vitest";
import { prototypeForTileId } from "./tileMapping";
import { TILE_TRAP } from "@/battle/world/Dungeon";
import {
  TILE_FOREST_ARCHWAY_UP,
  TILE_FOREST_ARCHWAY_DOWN,
} from "@/battle/world/Tiles";

/**
 * Trap cells render as the surrounding style's floor so the party
 * can't spot them by eye — the only intended way to reveal a trap is
 * the Detect Traps party effect, which paints a red-X overlay on top
 * of this base sprite. A regression that hardcodes the base sprite
 * (e.g. always `stone_floor.png`) makes traps in cave / forest
 * dungeons stick out as obviously-different gray squares, which is
 * exactly what we're guarding against here.
 */
describe("prototypeForTileId — TILE_TRAP", () => {
  it("uses the cave floor sprite in caves-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "caves");
    const caveFloor = prototypeForTileId(20 /* TILE_DFLOOR */, "caves");
    expect(trap).not.toBeNull();
    expect(caveFloor).not.toBeNull();
    expect(trap!.sprite).toBe(caveFloor!.sprite);
    expect(trap!.sprite).toBe("map/path.png");
    expect(trap!.trap).toBe(true);
  });

  it("uses the forest floor sprite in forest-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "forest");
    const forestFloor = prototypeForTileId(20 /* TILE_DFLOOR */, "forest");
    expect(trap).not.toBeNull();
    expect(forestFloor).not.toBeNull();
    expect(trap!.sprite).toBe(forestFloor!.sprite);
    expect(trap!.sprite).toBe("map/grass1.png");
    expect(trap!.trap).toBe(true);
  });

  it("uses the ruins/stone floor sprite in ruins-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "ruins");
    const ruinsFloor = prototypeForTileId(20 /* TILE_DFLOOR */, "ruins");
    expect(trap).not.toBeNull();
    expect(ruinsFloor).not.toBeNull();
    expect(trap!.sprite).toBe(ruinsFloor!.sprite);
    expect(trap!.sprite).toBe("map/stone_floor.png");
    expect(trap!.trap).toBe(true);
  });

  it("preserves the trap identity (id, name) regardless of style", () => {
    for (const style of ["caves", "forest", "ruins"] as const) {
      const trap = prototypeForTileId(TILE_TRAP, style);
      expect(trap!.id).toBe("dungeon_floor_trap");
      expect(trap!.name).toBe("Trap");
      expect(trap!.walkable).toBe(true);
    }
  });
});

describe("prototypeForTileId — forest transition arches", () => {
  // A forest is a sprawling place, not a staircase, so its level
  // transitions render as brightly-coloured arches (gold = up/entrance,
  // blue = down/descent) rather than the stairs sprites. Guard against
  // a regression that points them back at stairs_*.png.
  it("maps the UP archway to the gold arch sprite, walkable", () => {
    const up = prototypeForTileId(TILE_FOREST_ARCHWAY_UP, "forest");
    expect(up!.sprite).toBe("map/arch_gold.png");
    expect(up!.walkable).toBe(true);
  });

  it("maps the DOWN archway to the blue arch sprite, walkable", () => {
    const down = prototypeForTileId(TILE_FOREST_ARCHWAY_DOWN, "forest");
    expect(down!.sprite).toBe("map/arch_blue.png");
    expect(down!.walkable).toBe(true);
  });

  it("archway sprites are arches, not stairs", () => {
    const up = prototypeForTileId(TILE_FOREST_ARCHWAY_UP, "forest");
    const down = prototypeForTileId(TILE_FOREST_ARCHWAY_DOWN, "forest");
    expect(up!.sprite).not.toContain("stairs");
    expect(down!.sprite).not.toContain("stairs");
  });
});
