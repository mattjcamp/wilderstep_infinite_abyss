import { describe, it, expect } from "vitest";
import { dungeonSpriteKeys, prototypeForTileId, resolveDungeonSprite } from "./tileMapping";
import { TILE_STAIRS, TILE_TRAP } from "@/battle/world/Dungeon";
import { TILE_DFLOOR, TILE_STAIRS_DOWN } from "@/battle/world/Tiles";

/**
 * Trap cells render as the surrounding style's floor so the party
 * can't spot them by eye — the only intended way to reveal a trap is
 * the Detect Traps party effect, which paints a red-X overlay on top
 * of this base sprite. A regression that hardcodes the base sprite
 * makes traps in one tileset stick out as obviously-different
 * squares, which is exactly what we're guarding against here.
 */
describe("prototypeForTileId — TILE_TRAP", () => {
  it("uses the dungeon floor sprite in dungeon-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "dungeon");
    const floor = prototypeForTileId(TILE_DFLOOR, "dungeon");
    expect(trap!.paletteId).toBe(floor!.paletteId);
    expect(trap!.paletteId).toBe("dungeon_floor_flagstone");
    expect(trap!.trap).toBe(true);
  });

  it("uses the cave floor sprite in cavern-style dungeons", () => {
    const trap = prototypeForTileId(TILE_TRAP, "cavern");
    const floor = prototypeForTileId(TILE_DFLOOR, "cavern");
    expect(trap!.paletteId).toBe(floor!.paletteId);
    expect(trap!.paletteId).toBe("cave_floor_dirt");
    expect(trap!.trap).toBe(true);
  });

  it("preserves the trap identity (id, name) regardless of style", () => {
    for (const style of ["dungeon", "cavern"] as const) {
      const trap = prototypeForTileId(TILE_TRAP, style);
      expect(trap!.id).toBe("dungeon_floor_trap");
      expect(trap!.name).toBe("Trap");
      expect(trap!.walkable).toBe(true);
    }
  });
});

describe("prototypeForTileId — stairs", () => {
  it("each tileset paints its own stairs, walkable, with stairs ids", () => {
    expect(prototypeForTileId(TILE_STAIRS, "dungeon")!.paletteId).toBe("dungeon_stairs_up");
    expect(prototypeForTileId(TILE_STAIRS_DOWN, "dungeon")!.paletteId).toBe("dungeon_stairs");
    expect(prototypeForTileId(TILE_STAIRS, "cavern")!.paletteId).toBe("cave_stairs_up");
    expect(prototypeForTileId(TILE_STAIRS_DOWN, "cavern")!.paletteId).toBe("cave_stairs");
    for (const style of ["dungeon", "cavern"] as const) {
      const up = prototypeForTileId(TILE_STAIRS, style)!;
      const down = prototypeForTileId(TILE_STAIRS_DOWN, style)!;
      expect(up.id).toBe("stairs_up");
      expect(down.id).toBe("stairs_down");
      expect(up.walkable).toBe(true);
      expect(down.walkable).toBe(true);
    }
  });
});

describe("dungeon art comes from the module palette", () => {
  it("prototypes carry no sprite path of their own", () => {
    for (const style of ["dungeon", "cavern"] as const) {
      for (let id = 0; id < 200; id++) {
        const p = prototypeForTileId(id, style);
        if (p) expect(p.sprite).toBe("");
      }
    }
  });

  it("resolves a palette id through the module palette, empty when missing", () => {
    const palette = new Map([["dungeon_stairs_up", "map/my_stairs.png"]]);
    expect(resolveDungeonSprite("dungeon_stairs_up", palette)).toBe("map/my_stairs.png");
    expect(resolveDungeonSprite("chest", palette)).toBe("");
    expect(dungeonSpriteKeys(palette)).toEqual(["map/my_stairs.png"]);
  });
});
