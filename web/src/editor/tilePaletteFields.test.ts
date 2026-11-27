import { describe, expect, it } from "vitest";
import { getSpriteFieldConfig } from "./spriteFields";

describe("Tile Palette sprite fields", () => {
  it("sprite and background_sprite both use the map sprite picker", () => {
    expect(getSpriteFieldConfig("sprite", "map_tiles")).toEqual({ category: "map", format: "path" });
    const bg = getSpriteFieldConfig("background_sprite", "map_tiles");
    expect(bg).toMatchObject({ category: "map", format: "path", dialog: true, tagFilters: false });
    // Only terrain folders — no people / monsters / items.
    expect(bg?.categories).toContain("map");
    expect(bg?.categories).not.toContain("person");
  });
});
