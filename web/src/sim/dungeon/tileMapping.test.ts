import { describe, it, expect } from "vitest";
import { prototypeForTileId } from "./tileMapping";
import { TILE_TRAP } from "@/battle/world/Dungeon";

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
