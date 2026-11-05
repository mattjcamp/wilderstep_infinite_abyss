import { describe, it, expect } from "vitest";
import { keyToDir, pickSpatial, type Box } from "./spatialNav";

const box = (left: number, top: number, w = 100, h = 40): Box => ({
  left, top, right: left + w, bottom: top + h,
});

describe("pickSpatial", () => {
  // A row of five cards, a wide panel below, two small buttons under it.
  const cards = [0, 110, 220, 330, 440].map((x) => box(x, 0));
  const male = box(0, 200, 60);
  const female = box(70, 200, 60);
  const back = box(0, 300, 60);
  const next = box(480, 300, 60);
  const all = [...cards, male, female, back, next];

  it("moves along a row and stops at the end", () => {
    expect(pickSpatial(cards[1], all, "right")).toBe(2);
    expect(pickSpatial(cards[1], all, "left")).toBe(0);
    expect(pickSpatial(cards[4], all, "right")).toBe(-1);
  });

  it("drops to the nearest control below, preferring ones in line", () => {
    expect(pickSpatial(cards[0], all, "down")).toBe(5); // Male
    expect(pickSpatial(male, all, "down")).toBe(7); // Back
    expect(pickSpatial(female, all, "right")).toBe(-1);
    expect(pickSpatial(back, all, "right")).toBe(8); // Next
    expect(pickSpatial(next, all, "up")).toBe(4); // card straight above beats a far-off button
    expect(pickSpatial(back, all, "up")).toBe(5); // Male
  });

  it("moves between rows of a grid by column", () => {
    const grid: Box[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) grid.push(box(c * 110, r * 60));
    expect(pickSpatial(grid[1], grid, "down")).toBe(5);
    expect(pickSpatial(grid[6], grid, "up")).toBe(2);
    expect(pickSpatial(grid[7], grid, "left")).toBe(6);
  });
});

describe("keyToDir", () => {
  it("maps arrows always and WASD only when letters are free", () => {
    expect(keyToDir("ArrowUp", false)).toBe("up");
    expect(keyToDir("a", true)).toBe("left");
    expect(keyToDir("a", false)).toBeNull();
    expect(keyToDir("Enter", true)).toBeNull();
  });
});
