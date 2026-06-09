import { describe, expect, it } from "vitest";
import {
  anchorCell,
  nextCellSelection,
  type CellCoord,
} from "./cellSelection";

const A = { col: 1, row: 1 };
const B = { col: 2, row: 3 };
const C = { col: 5, row: 0 };

describe("nextCellSelection", () => {
  it("plain interaction replaces the selection with one cell", () => {
    expect(nextCellSelection([], A)).toEqual([A]);
    expect(nextCellSelection([A, B], C)).toEqual([C]);
    expect(nextCellSelection([A, B], C, { additive: false })).toEqual([C]);
  });

  it("additive click appends a new cell (becomes the anchor)", () => {
    const next = nextCellSelection([A], B, { additive: true });
    expect(next).toEqual([A, B]);
    expect(anchorCell(next)).toEqual(B);
  });

  it("additive click on a member toggles it off", () => {
    expect(nextCellSelection([A, B], B, { additive: true })).toEqual([A]);
  });

  it("additive click on the sole member clears the selection", () => {
    expect(nextCellSelection([A], A, { additive: true })).toEqual([]);
  });

  it("additive drag adds an absent cell", () => {
    expect(
      nextCellSelection([A], B, { additive: true, drag: true }),
    ).toEqual([A, B]);
  });

  it("additive drag over a member is a no-op AND keeps the same ref", () => {
    const prev: CellCoord[] = [A, B];
    const next = nextCellSelection(prev, B, { additive: true, drag: true });
    expect(next).toBe(prev); // unchanged reference → no React update
  });

  it("does not mutate the input array", () => {
    const prev: CellCoord[] = [A];
    nextCellSelection(prev, B, { additive: true });
    expect(prev).toEqual([A]);
  });
});

describe("anchorCell", () => {
  it("returns null for an empty selection", () => {
    expect(anchorCell([])).toBeNull();
  });
  it("returns the last selected cell", () => {
    expect(anchorCell([A, B, C])).toEqual(C);
  });
});
