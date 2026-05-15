/**
 * Pure helpers for the battle simulation kernel — distance, range,
 * targeting, RNG.
 *
 * Kept Phaser-free and React-free so the same helpers can drive tests
 * and (eventually) the /play scene.
 */

import type { BattleCombatant, BattlePos } from "./types";
import { MELEE_RANGE } from "./types";

/** Chebyshev distance — the relevant metric on a grid where
 *  diagonals count the same as orthogonal steps. Matches v1's
 *  movement rules. */
export function chebyshev(a: BattlePos, b: BattlePos): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/** True when `attacker` is close enough to hit `target` with the
 *  given reach. For ranged attacks pass a large `reach`. */
export function inRange(
  attacker: BattlePos,
  target: BattlePos,
  reach: number,
): boolean {
  return chebyshev(attacker, target) <= reach;
}

/** Pick the nearest live combatant on the opposing side. Returns
 *  null when none are left (kernel handles the implied victory /
 *  defeat). On a tie the lowest-id combatant wins so the AI behaves
 *  deterministically across runs. */
export function nearestEnemy(
  from: BattleCombatant,
  combatants: ReadonlyArray<BattleCombatant>,
): BattleCombatant | null {
  let best: BattleCombatant | null = null;
  let bestDist = Infinity;
  for (const c of combatants) {
    if (c.dead || c.side === from.side) continue;
    const d = chebyshev(from.pos, c.pos);
    if (d < bestDist || (d === bestDist && best && c.id < best.id)) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Predicate the kernel calls to decide whether a tile can be
 *  entered. Hosts that drive the kernel from a real map pass a
 *  function that consults the map's walkable + obstructs fields;
 *  the simple HTML preview can omit it (every in-bounds cell is
 *  walkable). */
export type WalkablePredicate = (col: number, row: number) => boolean;

/** Step one cell from `from` toward `target` — Chebyshev semantics
 *  mean each axis moves independently by ±1. Returns the new
 *  position. Stops short of occupied cells so two combatants don't
 *  stack; if every neighbor toward the target is blocked, returns
 *  the original position so the caller can attack-in-place if in
 *  range. Honors the optional walkable predicate when present. */
export function stepToward(
  from: BattlePos,
  target: BattlePos,
  occupied: ReadonlySet<string>,
  bounds: { cols: number; rows: number },
  walkable?: WalkablePredicate,
): BattlePos {
  const dc = Math.sign(target.col - from.col);
  const dr = Math.sign(target.row - from.row);
  // Candidate moves in preference order: diagonal first, then one
  // axis, then the other. Always tries to close distance, never
  // walks backwards or stalls if a better step exists.
  const tries: BattlePos[] = [
    { col: from.col + dc, row: from.row + dr },
    { col: from.col + dc, row: from.row },
    { col: from.col, row: from.row + dr },
  ];
  for (const cand of tries) {
    if (cand.col === from.col && cand.row === from.row) continue;
    if (cand.col < 0 || cand.col >= bounds.cols) continue;
    if (cand.row < 0 || cand.row >= bounds.rows) continue;
    if (occupied.has(posKey(cand))) continue;
    if (walkable && !walkable(cand.col, cand.row)) continue;
    return cand;
  }
  return from;
}

/** Stable key for hashing positions into a Set. */
export function posKey(p: BattlePos): string {
  return `${p.col},${p.row}`;
}

/** Roll an N-sided die. Deterministic seedable RNG can replace this
 *  later; for now `Math.random()` is fine for the editor preview. */
export function rollDie(sides: number): number {
  if (sides <= 0) return 0;
  return 1 + Math.floor(Math.random() * sides);
}

/** Roll `n` `sides`-sided dice and add `bonus`. Min damage clamps to
 *  the floor (so a -10 STR fighter still hits for at least 1). */
export function rollDamage(
  dice: number,
  sides: number,
  bonus: number,
  minDamage = 1,
): number {
  let total = bonus;
  for (let i = 0; i < dice; i++) total += rollDie(sides);
  return Math.max(minDamage, total);
}

/** d20 attack roll. Mirrors v1 — attack succeeds when
 *  d20 + attackBonus ≥ target.ac. Returns the raw roll AND whether
 *  it hit so the UI can show e.g. "16 vs AC 12 — hit!". */
export function rollAttack(
  attackBonus: number,
  targetAc: number,
): { roll: number; total: number; hit: boolean } {
  const roll = rollDie(20);
  const total = roll + attackBonus;
  return { roll, total, hit: total >= targetAc };
}

/** Return the set of currently-occupied cell keys so movement
 *  helpers can avoid stacking. */
export function occupiedCells(
  combatants: ReadonlyArray<BattleCombatant>,
): Set<string> {
  const out = new Set<string>();
  for (const c of combatants) {
    if (!c.dead) out.add(posKey(c.pos));
  }
  return out;
}

/** Standard D&D-style ability modifier — same formula the character
 *  sheet uses. Re-exported here so the kernel doesn't depend on the
 *  editor module. */
export function abilityMod(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

/** Number of unblocked steps `mover` can take toward `target`,
 *  capped at `maxSteps`. Walks one Chebyshev cell at a time using
 *  `stepToward`, updating the occupied set as it moves. Returns the
 *  ending position and the actual step count taken. Optionally
 *  consults a walkable predicate so combatants on a real map can't
 *  walk through walls or water. */
export function walkToward(
  mover: BattleCombatant,
  target: BattlePos,
  combatants: ReadonlyArray<BattleCombatant>,
  bounds: { cols: number; rows: number },
  maxSteps: number,
  walkable?: WalkablePredicate,
): { pos: BattlePos; steps: number } {
  let pos = mover.pos;
  let steps = 0;
  // Build the occupied set once; we mutate it as we walk so
  // intermediate positions don't conflict with the mover's own
  // history.
  const occupied = occupiedCells(combatants);
  occupied.delete(posKey(mover.pos));
  for (let i = 0; i < maxSteps; i++) {
    if (chebyshev(pos, target) <= MELEE_RANGE) break;
    const next = stepToward(pos, target, occupied, bounds, walkable);
    if (next.col === pos.col && next.row === pos.row) break; // stuck
    occupied.delete(posKey(pos));
    occupied.add(posKey(next));
    pos = next;
    steps++;
  }
  return { pos, steps };
}
