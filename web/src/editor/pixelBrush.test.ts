import { describe, expect, it } from "vitest";
import { BRUSH_SIZES, brushOrigin } from "./PixelEditor";

describe("brushOrigin", () => {
  it("1×1 paints only the hovered cell", () => {
    expect(brushOrigin(5, 7, 1)).toEqual({ col: 5, row: 7 });
  });
  it("odd sizes centre on the hovered cell", () => {
    expect(brushOrigin(5, 5, 3)).toEqual({ col: 4, row: 4 });
  });
  it("even sizes lean up/left", () => {
    expect(brushOrigin(5, 5, 2)).toEqual({ col: 5, row: 5 });
    expect(brushOrigin(5, 5, 4)).toEqual({ col: 4, row: 4 });
  });
  it("sizes are ascending and start at 1", () => {
    expect(BRUSH_SIZES[0]).toBe(1);
    expect([...BRUSH_SIZES].sort((a, b) => a - b)).toEqual([...BRUSH_SIZES]);
  });
});
