import { describe, expect, it } from "vitest";
import { getSpriteFieldConfig } from "./spriteFields";

describe("Tile Palette sprite fields", () => {
  it("sprite and background_sprite both use the map sprite picker", () => {
    expect(getSpriteFieldConfig("sprite", "map_tiles")).toEqual({ category: "map", format: "path" });
    expect(getSpriteFieldConfig("background_sprite", "map_tiles")).toEqual({ category: "map", format: "path" });
  });
});
