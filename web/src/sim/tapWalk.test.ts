import { describe, it, expect } from "vitest";
import { planTapWalk, type TapCellKind } from "./tapWalk";

/** Map from rows of chars: '.' open, '#' blocked, 'N' interact. */
function grid(rows: string[]) {
  return (c: number, r: number): TapCellKind => {
    const ch = rows[r]?.[c];
    if (ch === undefined || ch === "#") return "blocked";
    if (ch === "N") return "interact";
    return "open";
  };
}

describe("planTapWalk", () => {
  it("walks a straight line", () => {
    const g = grid(["....."]);
    expect(planTapWalk({ col: 0, row: 0 }, { col: 3, row: 0 }, g)).toEqual([
      "right", "right", "right",
    ]);
  });

  it("routes around walls (shortest path)", () => {
    const g = grid([
      "...",
      ".#.",
      "...",
    ]);
    const path = planTapWalk({ col: 0, row: 1 }, { col: 2, row: 1 }, g)!;
    expect(path).toHaveLength(4);
  });

  it("returns null for a blocked target or no route", () => {
    expect(planTapWalk({ col: 0, row: 0 }, { col: 1, row: 0 }, grid([".#"]))).toBeNull();
    expect(planTapWalk({ col: 0, row: 0 }, { col: 2, row: 0 }, grid([".#."]))).toBeNull();
  });

  it("returns null for a tap on the party's own tile", () => {
    expect(planTapWalk({ col: 0, row: 0 }, { col: 0, row: 0 }, grid(["."]))).toBeNull();
  });

  it("ends with a bump step into an interactable target", () => {
    const g = grid(["...N"]);
    expect(planTapWalk({ col: 0, row: 0 }, { col: 3, row: 0 }, g)).toEqual([
      "right", "right", "right",
    ]);
  });

  it("bumps an adjacent interactable straight away", () => {
    expect(planTapWalk({ col: 0, row: 0 }, { col: 1, row: 0 }, grid([".N"]))).toEqual(["right"]);
  });

  it("never walks through an interactable on the way", () => {
    const g = grid([
      ".N.",
      "...",
    ]);
    const path = planTapWalk({ col: 0, row: 0 }, { col: 2, row: 0 }, g)!;
    expect(path).toEqual(["down", "right", "right", "up"]);
  });

  it("gives up past the step limit", () => {
    const g = grid(["." .repeat(20)]);
    expect(planTapWalk({ col: 0, row: 0 }, { col: 19, row: 0 }, g, 5)).toBeNull();
  });
});
