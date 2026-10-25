import { describe, it, expect } from "vitest";
import { dungeonSpriteKeys, prototypeForTileId, resolveDungeonSprite } from "./tileMapping";
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
    expect(trap!.paletteId).toBe(caveFloor!.paletteId);
    expect(trap!.paletteId).toBe("grass_brown");
    expect(trap!.trap).toBe(true);
  });

  it("uses the forest floor sprite in forest-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "forest");
    const forestFloor = prototypeForTileId(20 /* TILE_DFLOOR */, "forest");
    expect(trap).not.toBeNull();
    expect(forestFloor).not.toBeNull();
    expect(trap!.paletteId).toBe(forestFloor!.paletteId);
    expect(trap!.paletteId).toBe("grass");
    expect(trap!.trap).toBe(true);
  });

  it("uses the ruins/stone floor sprite in ruins-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "ruins");
    const ruinsFloor = prototypeForTileId(20 /* TILE_DFLOOR */, "ruins");
    expect(trap).not.toBeNull();
    expect(ruinsFloor).not.toBeNull();
    expect(trap!.paletteId).toBe(ruinsFloor!.paletteId);
    expect(trap!.paletteId).toBe("floor_gray");
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
  // Forest transitions had their own gold/blue arch sprites; since the
  // 2026-10 tile trim they borrow the stairs art until arches are
  // redrawn. They must stay walkable and keep their stairs ids.
  it("maps the UP archway to the stairs-up sprite, walkable", () => {
    const up = prototypeForTileId(TILE_FOREST_ARCHWAY_UP, "forest");
    expect(up!.paletteId).toBe("stairs_up");
    expect(up!.walkable).toBe(true);
  });

  it("maps the DOWN archway to the stairs-down sprite, walkable", () => {
    const down = prototypeForTileId(TILE_FOREST_ARCHWAY_DOWN, "forest");
    expect(down!.paletteId).toBe("stairs_down");
    expect(down!.walkable).toBe(true);
  });

  it("archways keep their stairs ids", () => {
    const up = prototypeForTileId(TILE_FOREST_ARCHWAY_UP, "forest");
    const down = prototypeForTileId(TILE_FOREST_ARCHWAY_DOWN, "forest");
    expect(up!.id).toBe("stairs_up");
    expect(down!.id).toBe("stairs_down");
  });
});

describe("dungeon art comes from the module palette", () => {
  it("prototypes carry no sprite path of their own", () => {
    for (const style of ["ruins", "caves", "forest"] as const) {
      for (let id = 0; id < 200; id++) {
        const p = prototypeForTileId(id, style);
        if (p) expect(p.sprite).toBe("");
      }
    }
  });

  it("resolves a palette id through the module palette, empty when missing", () => {
    const palette = new Map([["stairs_up", "map/my_stairs.png"]]);
    expect(resolveDungeonSprite("stairs_up", palette)).toBe("map/my_stairs.png");
    expect(resolveDungeonSprite("chest", palette)).toBe("");
    expect(dungeonSpriteKeys(palette)).toEqual(["map/my_stairs.png"]);
  });
});
