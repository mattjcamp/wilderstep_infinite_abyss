/**
 * NPC wander — pure, no Phaser, no DOM.
 *
 * On every turn (one party step), each cell carrying an `npc` or
 * `quest` tag gets a {@link NPC_WANDER_CHANCE} roll to step one
 * cardinal tile to an adjacent walkable cell. The pass mutates the
 * grid in place (the `npc` / `quest` field follows the entity into
 * its new home) and returns the list of moves so the caller can
 * reposition any visual overlays and re-run downstream views (the
 * quest glow, in particular, since giver cells just shifted).
 *
 * The author's `walkable` / `obstructs` / `sprite` fields aren't
 * touched: NPCs are conceptually overlays that ride on top of a
 * floor tile, and the bump-detection path in the kernel keys off
 * the `npc` / `quest` tag (NOT walkability), so swapping just the
 * tag is enough to make the wandering NPC's new cell block the
 * party while the vacated cell reverts to whatever the floor was.
 *
 * The pass intentionally treats `npc` and `quest` symmetrically:
 * the user-visible behaviour is "people standing on the map drift
 * around a little", and quest givers are people too.
 */

import type { Position, SimCell, SimGrid } from "./types";

/** Probability that any given NPC takes a step on a turn. Per
 *  product call: "moderate chance (50%)". Exported so tests can
 *  assert the rate without re-deriving it. */
export const NPC_WANDER_CHANCE = 0.5;

/** RNG contract — Math.random-style function returning [0, 1).
 *  Matches the {@link SpawnRng} contract in `spawn.ts` so a single
 *  injected RNG can drive both subsystems if a future caller wants
 *  reproducibility across the whole step. */
export type WanderRng = () => number;

/** One NPC that took a step on this turn. The caller uses these to
 *  drive overlay updates: the Phaser image at `from` needs to
 *  reposition to `to`, and any feature keyed off cell coords (the
 *  quest-glow halo, the editor's diff'd overlay maps) needs to
 *  re-derive. Carries both `npcId` and `questId` because a single
 *  cell can hold both — the floor reading "npc=guard, quest=help"
 *  means the same person hands out the quest. */
export interface NpcMove {
  from: Position;
  to: Position;
  /** Value of `cell.npc` on the originating cell, if any. */
  npcId?: string;
  /** Value of `cell.quest` on the originating cell, if any. */
  questId?: string;
}

/** Cardinal step offsets. Diagonal isn't part of the party's move
 *  vocabulary, so NPCs match — keeps the visual rhythm consistent
 *  with the rest of the world. */
const CARDINALS: ReadonlyArray<{ dc: number; dr: number }> = [
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
];

/** Find every cell that an NPC or quest giver currently occupies.
 *  Pure scan — caller decides what to do with the list (typically
 *  feed it into {@link runNpcWander}, but tests use it for
 *  setup-time assertions too). */
export function findNpcCells(grid: SimGrid): NpcMove["from"][] {
  const out: Position[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (cell.npc || cell.quest) out.push({ col: c, row: r });
    }
  }
  return out;
}

/** True when `cell` is a valid destination for a wandering NPC:
 *  walkable floor, no other gameplay tag (another NPC, quest tile,
 *  shop counter, encounter / spawn / dungeon entrance, dropped
 *  item, portal link, parked boat, locked door, armed trap), and
 *  not flagged as water. Encapsulated as a helper so the test
 *  suite can probe the eligibility logic directly. */
export function isWanderDestination(cell: SimCell | null | undefined): boolean {
  if (!cell) return false;
  if (!cell.walkable) return false;
  if ((cell.tag ?? "") === "water") return false;
  // Any gameplay tag → off-limits. The list mirrors the bump-
  // detection branches in MapSimulation.stepInDirection: anywhere
  // the party would stop / trigger something, an NPC also
  // shouldn't drift into.
  const c = cell as SimCell & { item?: string };
  if (c.npc) return false;
  if (c.quest) return false;
  if (c.counter) return false;
  if (c.encounter) return false;
  if (c.spawn) return false;
  if (c.dungeon) return false;
  if (c.item) return false;
  if (c.link && c.link.map_id) return false;
  if (c.boat) return false;
  if (c.locked) return false;
  if (c.trap) return false;
  return true;
}

/** Run one wander pass over the grid. For each cell currently
 *  holding an `npc` or `quest` tag, rolls {@link NPC_WANDER_CHANCE}
 *  to decide whether the NPC moves, then picks one of its cardinal
 *  neighbours uniformly at random from the eligible set and swaps
 *  the tag(s) over.
 *
 *  Mutation contract: the grid is mutated in place. The caller
 *  (MapSimulation) already mutates the grid for item pickup, boat
 *  lifts, trap disarm, and tile-add quest rewards, so adding this
 *  fits the established pattern. Cells that didn't change are
 *  untouched (no reference replacement, no field churn).
 *
 *  Occupancy: `isOccupied(c, r)` lets the caller mark dynamic
 *  blockers — the party's cell, live spawn roamers, placed
 *  encounter entities — as unwalkable for the purposes of THIS
 *  pass without having to fold them into the grid. Returning
 *  `true` for a coord excludes it from destination candidates.
 *
 *  RNG: each NPC consumes one roll to decide if it moves; movers
 *  consume one more roll to pick a direction. Deterministic given
 *  a seeded RNG (mulberry32 in the tests).
 *
 *  Returns one {@link NpcMove} entry per NPC that actually moved.
 *  Order matches grid scan order (row-major). Callers iterate the
 *  result to reposition overlays and re-run the quest-glow pass.
 */
export function runNpcWander(
  grid: SimGrid,
  isOccupied: (col: number, row: number) => boolean,
  rng: WanderRng,
): NpcMove[] {
  // Snapshot the candidate cells BEFORE mutating — otherwise an
  // NPC that moves earlier in the pass would be re-considered at
  // its new home later. Each snapshot entry also captures the
  // tag values, since we're about to clear them on the originating
  // cell.
  const candidates = findNpcCells(grid).map((p) => {
    const cell = grid[p.row]?.[p.col] as SimCell | undefined;
    return {
      col: p.col,
      row: p.row,
      npcId: cell?.npc,
      questId: cell?.quest,
    };
  });

  const moves: NpcMove[] = [];
  for (const npc of candidates) {
    // Roll #1: should this NPC move at all?
    if (rng() >= NPC_WANDER_CHANCE) continue;

    // Build the eligible neighbour set. Mutated state from
    // earlier moves in THIS same pass is visible because we read
    // the live grid: an NPC that moved into a cell two iterations
    // ago will show up as `cell.npc` set, blocking a later NPC
    // from drifting onto the same tile.
    const eligible: Position[] = [];
    for (const { dc, dr } of CARDINALS) {
      const c = npc.col + dc;
      const r = npc.row + dr;
      if (c < 0 || r < 0) continue;
      const row = grid[r];
      if (!row) continue;
      if (c >= row.length) continue;
      const cell = row[c] as SimCell | undefined;
      if (!isWanderDestination(cell)) continue;
      if (isOccupied(c, r)) continue;
      eligible.push({ col: c, row: r });
    }
    if (eligible.length === 0) continue;

    // Roll #2: pick one neighbour uniformly. Math.floor(rng()*n)
    // matches the spawn helper's selection convention.
    const pick = eligible[Math.floor(rng() * eligible.length)];

    // Swap the tag(s). Both `npc` and `quest` can be set on the
    // same cell — a person who also offers a quest — so we move
    // them together; the cell stays "the same entity", it just
    // sits on a different floor.
    const fromCell = grid[npc.row]?.[npc.col] as SimCell | undefined;
    const toCell = grid[pick.row]?.[pick.col] as SimCell | undefined;
    if (!fromCell || !toCell) continue;
    if (npc.npcId) {
      toCell.npc = npc.npcId;
      fromCell.npc = "";
    }
    if (npc.questId) {
      (toCell as SimCell & { quest?: string }).quest = npc.questId;
      (fromCell as SimCell & { quest?: string }).quest = "";
    }
    moves.push({
      from: { col: npc.col, row: npc.row },
      to: pick,
      npcId: npc.npcId,
      questId: npc.questId,
    });
  }
  return moves;
}
