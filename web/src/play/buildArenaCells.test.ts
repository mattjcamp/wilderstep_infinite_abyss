import { describe, it, expect } from "vitest";
import { toArenaCell } from "./buildArenaCells";

describe("toArenaCell", () => {
  it("carries the map cell's background_sprite through for the battle floor", () => {
    const cell = toArenaCell({
      sprite: "objects/barrel.png",
      background_sprite: "dungeon/floor_brick.png",
      walkable: false,
      obstructs: true,
    });
    expect(cell.sprite).toMatch(/objects\/barrel\.png$/);
    expect(cell.backgroundSprite).toMatch(/dungeon\/floor_brick\.png$/);
  });

  it("leaves backgroundSprite null when the cell has none", () => {
    expect(toArenaCell({ sprite: "map/grass.png" }).backgroundSprite).toBeNull();
    expect(toArenaCell({ sprite: "map/grass.png", background_sprite: "" }).backgroundSprite).toBeNull();
  });
});
