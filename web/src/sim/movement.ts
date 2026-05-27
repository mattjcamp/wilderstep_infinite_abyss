/**
 * Pure movement helpers — no React, no Phaser, no DOM.
 *
 * The simulation kernel composes these with stateful side-effects in
 * MapSimulation.ts (sprite movement, lighting refresh, scene events).
 * A future /play scene can reuse these as-is.
 */

import type {
  Direction,
  Position,
  SimCell,
  SimCharacter,
  SimEffect,
  SimGrid,
  SimLightSource,
  SimParty,
  SimRace,
  StepResult,
} from "./types";
import {
  MAGIC_LIGHT_RANGE,
  TORCH_LIGHT_RANGE,
} from "./types";

/** Map a keyboard key (`event.key` value) to a single-step direction.
 *  Returns null for any other key. Accepts both WASD and arrow keys —
 *  v1 wired both, so we keep the convention. */
export function directionForKey(key: string): Direction | null {
  switch (key) {
    case "w":
    case "W":
    case "ArrowUp":
      return "up";
    case "s":
    case "S":
    case "ArrowDown":
      return "down";
    case "a":
    case "A":
    case "ArrowLeft":
      return "left";
    case "d":
    case "D":
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

/** Column/row delta for a direction. Cardinal movement only — the v1
 *  movement rules forbid diagonals for the party (monsters may move
 *  diagonally, but that's a combat-engine concern). */
export function deltaFor(direction: Direction): { dc: number; dr: number } {
  switch (direction) {
    case "up":
      return { dc: 0, dr: -1 };
    case "down":
      return { dc: 0, dr: 1 };
    case "left":
      return { dc: -1, dr: 0 };
    case "right":
      return { dc: 1, dr: 0 };
  }
}

/** Cell at (col,row) or null if off-grid. */
export function cellAt(
  grid: SimGrid,
  col: number,
  row: number,
): SimCell | null {
  const r = grid[row];
  if (!r) return null;
  return r[col] ?? null;
}

/** Attempt a one-step move and return the result. The grid is the
 *  *destination* grid — this function does not mutate party state,
 *  it just describes what would happen. */
export function step(
  grid: SimGrid,
  from: Position,
  direction: Direction,
): StepResult {
  const { dc, dr } = deltaFor(direction);
  const col = from.col + dc;
  const row = from.row + dr;
  const target = cellAt(grid, col, row);
  if (!target) return { kind: "stayed", reason: "off_grid" };
  if (!target.walkable) return { kind: "stayed", reason: "blocked" };
  if (target.link && target.link.map_id) {
    return { kind: "linked", col, row, link: target.link };
  }
  return { kind: "moved", col, row };
}

/** Compute the party's emitted light radius from its current torch /
 *  spell state.
 *
 *  Zero means "the party emits no light" — the renderer then relies
 *  on the map's own light sources + ambient (plus, in dungeons, a
 *  small built-in vision baseline rooted at the party).
 *
 *  v1 took the max across modifiers rather than stacking — we
 *  match that.
 *
 *  Note on race abilities: a previous iteration treated `infravision`
 *  (Dwarf) as a light source granting effectively-infinite party
 *  light. That was a placeholder, not the proper model — infravision
 *  is a vision ability (the character sees in low light) not a
 *  literal lantern the party carries. Until we model vision
 *  abilities separately from light sources, the infravision branch
 *  stays out of this function. `activeMembers` / `races` /
 *  `_effects` are kept on the signature for future hooks (e.g. a
 *  proper "Light" spell effect) without churning the callers. */
export function partyLightRange(
  party: Pick<SimParty, "torch_steps" | "magic_light_steps">,
  _activeMembers: ReadonlyArray<SimCharacter>,
  _races: ReadonlyArray<SimRace>,
  _effects: ReadonlyArray<SimEffect>,
): number {
  let best = 0;
  if (party.torch_steps > 0) best = Math.max(best, TORCH_LIGHT_RANGE);
  if ((party.magic_light_steps ?? 0) > 0) {
    best = Math.max(best, MAGIC_LIGHT_RANGE);
  }
  return best;
}

/** Convert a party position + computed range into an optional light
 *  source the renderer can pass to its brightness calculator. Returns
 *  null when the party emits no light at all (caller can short-circuit
 *  cell tinting for the party layer). */
export function partyLightSource(
  pos: Position,
  range: number,
): SimLightSource | null {
  if (range <= 0) return null;
  return { col: pos.col, row: pos.row, range };
}

/** Tick the party's per-step counters. Returns a new object — does NOT
 *  mutate the input. Counters that hit 0 stay at 0. Step happens AFTER
 *  movement is resolved (the v1 convention), so a torch with 1 step
 *  left illuminates the tile you step ONTO before burning out. */
export function tickPartyTimers(
  party: Pick<SimParty, "torch_steps" | "magic_light_steps">,
): Pick<SimParty, "torch_steps" | "magic_light_steps"> {
  return {
    torch_steps: Math.max(0, party.torch_steps - 1),
    magic_light_steps: Math.max(0, (party.magic_light_steps ?? 0) - 1),
  };
}

/** True iff (col, row) is in-bounds AND its cell is walkable. */
export function isValidSpawn(
  grid: SimGrid,
  col: number,
  row: number,
): boolean {
  const c = cellAt(grid, col, row);
  return c !== null && c.walkable;
}

/** Find a sensible spawn position when the configured one is unusable
 *  for this map (e.g. party.start_position carries the overworld
 *  spawn at row 16 but the user clicked Simulate on a 16×12 town
 *  map). We do a spiral search from the preferred cell, then from
 *  the map's center, finally giving up at (0,0).
 *
 *  Pure — no side effects, returns the chosen position. */
export function findSpawn(
  grid: SimGrid,
  preferred: Position,
): Position {
  const height = grid.length;
  const width = height > 0 ? grid[0]!.length : 0;
  if (height === 0 || width === 0) return { col: 0, row: 0 };
  // 1. Preferred is fine on its own — use it.
  if (isValidSpawn(grid, preferred.col, preferred.row)) return preferred;
  // 2. Spiral out from the preferred coordinate, clamped to grid. The
  //    cap is generous; we want a walkable cell *somewhere*.
  const maxR = Math.max(width, height);
  for (let r = 1; r <= maxR; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        // Only the ring at this radius — skip the interior we
        // already swept on prior iterations.
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
        const c = preferred.col + dc;
        const rw = preferred.row + dr;
        if (isValidSpawn(grid, c, rw)) return { col: c, row: rw };
      }
    }
  }
  // 3. Nothing walkable found — drop them in the top-left in-bounds
  //    cell as a last resort. The map is unwalkable; the user can
  //    paint a walkable tile and re-enter sim.
  return { col: 0, row: 0 };
}
