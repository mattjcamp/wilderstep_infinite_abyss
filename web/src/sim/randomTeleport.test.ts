import { describe, it, expect } from "vitest";
import { randomReachableCell } from "./randomTeleport";
import type { SimCell, SimGrid } from "./types";

const F = (over: Partial<SimCell> = {}): SimCell =>
  ({ id: "floor", walkable: true, obstructs: false, light_source: false, light_range: 0, ...over }) as SimCell;
const W = (): SimCell => F({ id: "wall", walkable: false });

/** Build a grid from rows of chars: . floor, # wall, L locked door,
 *  T trap, S stairs, ~ water, M monster spot (floor, occupied). */
function grid(rows: string[]): { g: SimGrid; monsters: Set<string> } {
  const monsters = new Set<string>();
  const g = rows.map((row, r) =>
    [...row].map((ch, c) => {
      switch (ch) {
        case "#": return W();
        case "L": return F({ locked: true });
        case "T": return F({ trap: true });
        case "S": return F({ stairs: "down", link: { map_id: "x", x: 0, y: 0 } });
        case "~": return F({ water: true });
        case "M": monsters.add(`${c},${r}`); return F();
        default: return F();
      }
    }),
  );
  return { g, monsters };
}

describe("randomReachableCell", () => {
  it("never lands behind a locked door, across water, or on a trap / stairs", () => {
    const { g } = grid([
      "##########",
      "#....T..S#",
      "#........#",
      "####L#####",
      "#........#",
      "#~~~~~~~~#",
      "#........#",
      "##########",
    ]);
    for (let i = 0; i < 200; i++) {
      const p = randomReachableCell(g, { col: 1, row: 1 }, () => false, Math.random, 0)!;
      expect(p.row === 1 || p.row === 2).toBe(true);
      expect(g[p.row][p.col].trap).toBeFalsy();
      expect(g[p.row][p.col].stairs).toBeFalsy();
      expect(p).not.toEqual({ col: 1, row: 1 });
    }
  });

  it("doesn't walk through monsters", () => {
    const { g, monsters } = grid([
      "#######",
      "#..M..#",
      "#######",
    ]);
    const occ = (c: number, r: number) => monsters.has(`${c},${r}`);
    for (let i = 0; i < 50; i++) {
      const p = randomReachableCell(g, { col: 1, row: 1 }, occ, Math.random, 0)!;
      expect(p).toEqual({ col: 2, row: 1 });
    }
  });

  it("prefers cells at least minDistance away, else any reachable", () => {
    const { g } = grid(["##########", "#........#", "##########"]);
    for (let i = 0; i < 50; i++) {
      const p = randomReachableCell(g, { col: 1, row: 1 }, () => false, Math.random, 5)!;
      expect(p.col).toBeGreaterThanOrEqual(6);
    }
    const small = grid(["#####", "#...#", "#####"]).g;
    expect(randomReachableCell(small, { col: 1, row: 1 }, () => false, Math.random, 5)).not.toBeNull();
  });

  it("returns null when boxed in", () => {
    const { g } = grid(["###", "#.#", "###"]);
    expect(randomReachableCell(g, { col: 1, row: 1 }, () => false)).toBeNull();
  });
});
