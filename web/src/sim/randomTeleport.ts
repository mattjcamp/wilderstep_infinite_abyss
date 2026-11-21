/**
 * Random reachable destination for a teleport trap that has no
 * authored destination: flood-fill from the party over cells the party
 * could walk across on foot, then pick a random "plain" landing cell.
 *
 * Crossing rules: walkable, not locked, not a pit, not water (bridges —
 * `boat_passable` — are fine), and not a bump-to-interact cell (NPC,
 * shop counter, lore, notice board, quest giver, dungeon entrance).
 * Cells holding a monster can't be crossed either.
 *
 * Landing rules (stricter): no link / stairs, trap, item, spawn,
 * encounter or pressure plate, so the jump never chains into another
 * event. Prefers cells at least `minDistance` steps away so it feels
 * like a jump; falls back to any reachable landing when none are.
 */

import type { Position, SimCell, SimGrid } from "./types";

function passable(c: SimCell | null | undefined): c is SimCell {
  if (!c) return false;
  if (!c.walkable || c.locked || c.pit) return false;
  if (c.water && !c.boat_passable) return false;
  if (c.npc || c.counter || c.lore || c.board || c.quest || c.dungeon) return false;
  return true;
}

function landable(c: SimCell): boolean {
  return (
    !c.link &&
    !c.stairs &&
    !c.trap &&
    !c.trap_id &&
    !c.item &&
    !c.spawn &&
    !c.encounter &&
    !c.pressure_plate &&
    !c.boat
  );
}

export function randomReachableCell(
  grid: SimGrid,
  from: Position,
  isOccupied: (col: number, row: number) => boolean,
  rng: () => number = Math.random,
  minDistance = 5,
): Position | null {
  const key = (c: number, r: number) => `${c},${r}`;
  const seen = new Set<string>([key(from.col, from.row)]);
  const queue: Array<[number, number, number]> = [[from.col, from.row, 0]];
  const far: Position[] = [];
  const near: Position[] = [];
  for (let i = 0; i < queue.length; i++) {
    const [c, r, d] = queue[i];
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const k = key(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      const cell = grid[nr]?.[nc];
      if (!passable(cell) || isOccupied(nc, nr)) continue;
      queue.push([nc, nr, d + 1]);
      if (landable(cell)) (d + 1 >= minDistance ? far : near).push({ col: nc, row: nr });
    }
  }
  const pool = far.length > 0 ? far : near;
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}
