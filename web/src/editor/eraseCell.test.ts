import { describe, expect, it } from "vitest";
import { EMPTY_TILE_ID, emptyCell, isErased } from "./eraseCell";

describe("emptyCell", () => {
  it("is a blank, non-walkable cell with no art", () => {
    const c = emptyCell();
    expect(c.id).toBe(EMPTY_TILE_ID);
    expect(c.sprite).toBe("");
    expect(c.walkable).toBe(false);
    expect(c.obstructs).toBe(false);
    expect("background_sprite" in c).toBe(false);
    expect("link" in c).toBe(false);
  });

  it("returns a fresh object each time", () => {
    const a = emptyCell();
    a.name = "changed";
    expect(emptyCell().name).toBe("Empty");
  });
});

describe("isErased", () => {
  it("recognises an erased cell, ignoring absent optional fields", () => {
    expect(isErased(emptyCell() as unknown as Record<string, unknown>)).toBe(
      true,
    );
    expect(
      isErased({ ...emptyCell(), link: null, background_sprite: undefined }),
    ).toBe(true);
  });

  it("is false for a real tile or an empty cell carrying data", () => {
    expect(
      isErased({ ...emptyCell(), id: "grass", sprite: "map/grass.png" }),
    ).toBe(false);
    expect(
      isErased({ ...emptyCell(), background_sprite: "map/grass.png" }),
    ).toBe(false);
    expect(
      isErased({ ...emptyCell(), link: { map_id: "x", x: 0, y: 0 } }),
    ).toBe(false);
    expect(isErased(null)).toBe(false);
  });
});
