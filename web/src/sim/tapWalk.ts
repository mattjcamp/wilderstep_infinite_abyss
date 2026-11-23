/**
 * Tap-to-walk route planning (touch play). Pure: the caller describes
 * each cell through `classify`, and this finds the shortest 4-way
 * route from the party to the tapped cell.
 *
 *   "open"     — plain ground the party can walk through.
 *   "interact" — something you bump rather than stand on (NPC, shop
 *                counter, sign, notice board, quest giver, chest,
 *                locked door, lair, link / dungeon entrance, boat).
 *                Never walked THROUGH; as the destination, the route
 *                ends with a final step INTO it — the same bump the
 *                arrow keys would make.
 *   "blocked"  — never entered (walls, water, pits, off-map).
 *
 * Returns the directions to step, or null when there's no route (or
 * the tap was on the party's own tile / a blocked cell).
 */
import type { Direction, Position } from "./types";

export type TapCellKind = "open" | "interact" | "blocked";

/** Longest route a single tap will plan (steps). Taps land on what's
 *  on screen, so this is generous; it just bounds the search. */
export const TAP_WALK_MAX_STEPS = 80;

const DIRS: ReadonlyArray<[Direction, number, number]> = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
];

export function planTapWalk(
  from: Position,
  to: Position,
  classify: (col: number, row: number) => TapCellKind,
  maxSteps = TAP_WALK_MAX_STEPS,
): Direction[] | null {
  if (from.col === to.col && from.row === to.row) return null;
  const targetKind = classify(to.col, to.row);
  if (targetKind === "blocked") return null;

  // BFS over "open" cells. Goal: reach the target itself (open), or a
  // cell next to it (interact) and then bump in.
  const key = (c: number, r: number) => `${c},${r}`;
  const prev = new Map<string, { c: number; r: number; d: Direction } | null>();
  prev.set(key(from.col, from.row), null);
  let frontier: Array<{ c: number; r: number }> = [{ c: from.col, r: from.row }];

  const pathTo = (c: number, r: number): Direction[] => {
    const out: Direction[] = [];
    let k = key(c, r);
    let p = prev.get(k);
    while (p) {
      out.push(p.d);
      k = key(p.c, p.r);
      p = prev.get(k);
    }
    return out.reverse();
  };

  for (let depth = 0; depth <= maxSteps && frontier.length > 0; depth++) {
    const next: Array<{ c: number; r: number }> = [];
    for (const { c, r } of frontier) {
      for (const [d, dc, dr] of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        // Bumping into an interactable target from here?
        if (targetKind === "interact" && nc === to.col && nr === to.row) {
          return [...pathTo(c, r), d];
        }
        const k = key(nc, nr);
        if (prev.has(k)) continue;
        if (classify(nc, nr) !== "open") continue;
        prev.set(k, { c, r, d });
        if (targetKind === "open" && nc === to.col && nr === to.row) {
          return pathTo(nc, nr);
        }
        next.push({ c: nc, r: nr });
      }
    }
    frontier = next;
  }
  return null;
}
