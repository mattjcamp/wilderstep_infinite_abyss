/**
 * Pure Spawn helpers — port of the v1 monster-spawn loop into v2's
 * simulator. v1 keyed every spawn off the *tile id* (e.g. 66 = Monster
 * Spawn, 75 = Man Eater Lair); v2 keys them off a `spawn` id stored on
 * the painted cell, looked up against the module's spawns.json catalog.
 *
 * Spawn behavior, summarised: a cell carrying a `spawn` id is a
 * monster lair. On every party step, each lair within scan range rolls
 * its own `spawn_chance`. On success it picks a monster from
 * `spawn_monsters` and drops it on an open neighbour cell, where it
 * joins a roaming list that pursues the party one step at a time.
 *
 * Stepping onto the lair tile starts the *boss fight* (the
 * `boss_monsters` roster). Winning at the lair destroys it: the cell
 * reverts to a normal walkable tile and the lair never spawns again.
 * A roamer catching the party starts a smaller fight against just
 * that roamer's roster; winning removes the roamer but doesn't
 * destroy the lair.
 *
 * All side-effect-free. The simulation (MapSimulation.ts) composes
 * these with the live grid + bridge.
 */

import type { Position, SimEncounterRef } from "./types";

/** Catalog entry from spawns.json. Same shape v1 used (snake_case
 *  matches the JSON on disk so callers can pass raw merged records
 *  straight through with a single cast). */
export interface SimSpawn {
  /** Catalog id — snake_case, matches the `spawn` field stored on
   *  painted cells (and the key in spawns.json). */
  id: string;
  /** Display name shown in the encounter banner. */
  name: string;
  /** Flavour text used by the encounter banner. Optional. */
  description?: string;
  /** Roster the per-step roller picks from. Monster ids (snake_case).
   *  Duplicate entries weight the random pick. Empty = lair never
   *  produces roamers (useful for "boss only" lairs). */
  spawn_monsters: string[];
  /** Percent chance per step (1..100). v1 default = 20. */
  spawn_chance: number;
  /** Chebyshev radius around the lair the loop considers crowded.
   *  When the count of roamers from this lair within the radius is
   *  ≥ max_spawned, the lair takes the step off. */
  spawn_radius: number;
  /** Hard cap on simultaneous roamers tied to this lair. */
  max_spawned: number;
  /** Composition of the boss fight when the party steps on the lair. */
  boss_monsters: string[];
  xp_reward: number;
  gold_reward: number;
  loot: string[];
  /** Optional id of a Map (from maps.json) that should back this
   *  lair's boss fight as the battle arena. Null / undefined falls
   *  back to the generic green-field arena. Authored via the editor's
   *  MapPicker on the `custom_map` field. */
  custom_map?: string | null;
}

/** A live roamer on the map — a monster that one of the lairs spat
 *  out. Drawn by the host as a sprite at (col,row). */
export interface SimRoamer {
  /** Stable id so resolving an encounter can remove the right entry. */
  id: string;
  /** Catalog monster id (snake_case). The host resolves a sprite from
   *  this via the monsters catalog. */
  monsterId: string;
  col: number;
  row: number;
  /** "col,row" of the lair tile that bore this roamer. Used by the
   *  destroy-lair path to remove every roamer tied to it. */
  sourceKey: string;
  /** Resolved sprite path (e.g. "monster/goblin.png") if the catalog
   *  was hooked up at construction. Optional so a sim without a
   *  loaded monsters catalog still produces working roamers — the
   *  host just won't have a sprite to draw. */
  sprite?: string;
}

/** RNG contract — a Math.random-style function returning [0, 1). The
 *  v1 helpers and tests share this shape. */
export type SpawnRng = () => number;

/** A cell as seen by the spawn pass — only the bits the pass reads.
 *  Defined here (rather than reusing SimCell) so the helpers stay
 *  decoupled from the larger grid type. */
export interface SpawnCellInfo {
  walkable: boolean;
  /** True when the cell blocks line of sight (walls, dense foliage,
   *  closed doors, etc.). Mirrors the `obstructs` field on SimCell
   *  and the map-tile palette; consumed by {@link hasLineOfSight}
   *  and {@link canPursue}. */
  obstructs?: boolean;
  /** When set, the cell holds a spawn catalog id. */
  spawn?: string;
  /** When set, the cell carries a placed encounter (drives the
   *  one-shot roaming-encounter pursuit). */
  encounter?: string;
}

/** Chebyshev radius (in tiles) inside which a monster will pursue the
 *  party — *and only when LOS is also clear*. v1 had no awareness gate
 *  at all; v2 pulls one in so players can break contact by ducking
 *  behind a wall or putting distance between themselves and a roamer.
 *  Tune by adjusting this constant; the call sites in MapSimulation
 *  read it through {@link canPursue}. */
export const PURSUIT_RADIUS = 8;

/** A live placed encounter — one is seeded per painted encounter cell
 *  on sim start. Carries the encounter id (so combat can read the
 *  full roster) plus the lead sprite the host draws while it roams. */
export interface SimPlacedEncounter {
  /** Stable id so resolving the encounter can remove the right entry.
   *  Built from the source cell coords by default (one encounter per
   *  cell). */
  id: string;
  /** Catalog id from encounters.json — looked up by the host when
   *  resolving combat. */
  encounterId: string;
  col: number;
  row: number;
  /** "col,row" of the cell the encounter started on. Used to suppress
   *  the static cell overlay while the entity is active. */
  sourceKey: string;
  /** Lead-sprite path (matches v2's `encounter.monster_party_tile`).
   *  Optional so a missing sprite degrades to the host's placeholder. */
  sprite?: string;
  /** Optional sprite tint (packed RGB, e.g. 0xffe580) — propagated
   *  from the encounter record's `tint` field. Used today by
   *  quest-target dungeon placements to render a soft gold halo.
   *  Falsy = no tint override, sprite renders with the cell's
   *  lighting tint only. */
  tint?: number;
}

/**
 * Per-step roll from a single lair. Mirrors v1's `_spawn_from_spawn_tiles`
 * loop body for one tile:
 *   1. Skip when `random.randint(1, 100) > spawn_chance`.
 *   2. Skip when the count of roamers already tied to this lair
 *      (within `spawn_radius` Chebyshev) meets `max_spawned`.
 *   3. Try the lair's own cell, then the 8 neighbours, in shuffled
 *      order. Pick the first one that is walkable, not the party
 *      cell, not adjacent to the party (Manhattan > 1 keeps the
 *      spawn out of the party's face), and not occupied by another
 *      roamer.
 *
 * Returns the new roamer on success, or null on any skip. The caller
 * owns appending it to its roamer list.
 */
export function trySpawnRoamer(args: {
  lair: { col: number; row: number };
  spawn: SimSpawn;
  party: Position;
  existing: ReadonlyArray<SimRoamer>;
  isWalkable: (col: number, row: number) => boolean;
  rng: SpawnRng;
  /** monsterId → sprite path. Optional — when missing or returning
   *  undefined the roamer just lacks a sprite (host falls back to a
   *  placeholder). */
  spriteFor?: (monsterId: string) => string | undefined;
  /** Provider for unique roamer ids. Defaults to a coord+rng-based
   *  string so two simultaneous spawns from the same lair don't
   *  collide. */
  makeId?: () => string;
}): SimRoamer | null {
  const { lair, spawn, party, existing, isWalkable, rng } = args;
  if (spawn.spawn_monsters.length === 0) return null;

  // 1. Chance roll.
  if (Math.floor(rng() * 100) + 1 > spawn.spawn_chance) return null;

  // 2. Crowding cap — count *this lair's* roamers within radius. We
  //    deliberately ignore roamers from other lairs so two adjacent
  //    lairs don't choke each other out.
  const sourceKey = `${lair.col},${lair.row}`;
  const radius = spawn.spawn_radius;
  let nearby = 0;
  for (const r of existing) {
    if (r.sourceKey !== sourceKey) continue;
    if (
      Math.max(Math.abs(r.col - lair.col), Math.abs(r.row - lair.row)) <=
      radius
    ) {
      nearby += 1;
    }
  }
  if (nearby >= spawn.max_spawned) return null;

  // 3. Pick a target cell.
  const offsets: Array<[number, number]> = [
    [0, 0],
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  // Fisher–Yates with the supplied rng so tests are reproducible.
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = offsets[i];
    offsets[i] = offsets[j];
    offsets[j] = tmp;
  }

  const chosenMonster =
    spawn.spawn_monsters[
      Math.floor(rng() * spawn.spawn_monsters.length)
    ];

  for (const [dc, dr] of offsets) {
    const sc = lair.col + dc;
    const sr = lair.row + dr;
    if (!isWalkable(sc, sr)) continue;
    if (sc === party.col && sr === party.row) continue;
    if (Math.abs(sc - party.col) + Math.abs(sr - party.row) <= 1) continue;
    if (existing.some((r) => r.col === sc && r.row === sr)) continue;
    const idMaker =
      args.makeId ??
      (() =>
        `roam-${lair.col}-${lair.row}-${Math.floor(rng() * 1e9)}`);
    return {
      id: idMaker(),
      monsterId: chosenMonster,
      col: sc,
      row: sr,
      sourceKey,
      sprite: args.spriteFor?.(chosenMonster),
    };
  }
  return null;
}

/**
 * Cardinal pursuit step. Picks the N/S/E/W direction that most
 * reduces Chebyshev distance to the party. Returns the new position,
 * or the same position when no direction improves on the current one
 * (the roamer pauses rather than thrashing back and forth).
 *
 * `blocked` lets the caller veto specific cells without re-checking
 * the grid — used by the simulator to keep two roamers from
 * stacking onto the same tile.
 */
export function roamStep(
  roamer: { col: number; row: number },
  party: Position,
  isWalkable: (col: number, row: number) => boolean,
  blocked?: (col: number, row: number) => boolean,
): Position {
  const here: Position = { col: roamer.col, row: roamer.row };
  const startDist = Math.max(
    Math.abs(here.col - party.col),
    Math.abs(here.row - party.row),
  );
  if (startDist === 0) return here;
  const dirs: Array<[number, number]> = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  let best = here;
  let bestDist = startDist;
  for (const [dc, dr] of dirs) {
    const nc = here.col + dc;
    const nr = here.row + dr;
    if (!isWalkable(nc, nr)) continue;
    if (blocked && blocked(nc, nr)) continue;
    const d = Math.max(
      Math.abs(nc - party.col),
      Math.abs(nr - party.row),
    );
    if (d < bestDist) {
      bestDist = d;
      best = { col: nc, row: nr };
    }
  }
  return best;
}

/** Bresenham line-of-sight check between two grid cells. Returns true
 *  when no cell along the straight line between source and destination
 *  has `obstructs: true`. The source and destination cells themselves
 *  are not tested — a monster standing inside a wall (shouldn't
 *  happen) still sees out, and a wall's outward face still reads as
 *  visible. Out-of-grid cells are treated as non-obstructing so the
 *  helper is safe for partial maps; callers gating on bounds should
 *  do so separately.
 *
 *  Mirrors the closed-over LOS logic in `sim/lighting.ts` so vision
 *  agrees with what the player can actually see lit up. */
export function hasLineOfSight(
  grid: ReadonlyArray<
    ReadonlyArray<{ obstructs?: boolean } | null | undefined>
  >,
  srcCol: number,
  srcRow: number,
  dstCol: number,
  dstRow: number,
): boolean {
  if (srcCol === dstCol && srcRow === dstRow) return true;
  const dx = Math.abs(dstCol - srcCol);
  const dy = Math.abs(dstRow - srcRow);
  const sx = srcCol < dstCol ? 1 : -1;
  const sy = srcRow < dstRow ? 1 : -1;
  let err = dx - dy;
  let c = srcCol;
  let r = srcRow;
  const maxSteps = dx + dy + 2;
  for (let i = 0; i < maxSteps; i++) {
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      c += sx;
    }
    if (e2 < dx) {
      err += dx;
      r += sy;
    }
    if (c === dstCol && r === dstRow) return true;
    const cell = grid[r]?.[c];
    if (cell?.obstructs) return false;
  }
  return false;
}

/** True when a monster at (col,row) can sense and reach the party for
 *  pursuit this step: Chebyshev distance ≤ {@link PURSUIT_RADIUS} AND
 *  line of sight is clear. Used to gate {@link roamStep} at the
 *  simulator call sites — when this returns false the monster doesn't
 *  move; it sits where it is until the party either steps back into
 *  range or back into view. Collision detection is unaffected: a
 *  monster already adjacent to the party still triggers the
 *  encounter on the caller's existing `roamerCollidesWithParty`
 *  check. */
export function canPursue(
  monster: { col: number; row: number },
  party: Position,
  grid: ReadonlyArray<
    ReadonlyArray<{ obstructs?: boolean } | null | undefined>
  >,
  options?: { radius?: number },
): boolean {
  const radius = options?.radius ?? PURSUIT_RADIUS;
  const dist = Math.max(
    Math.abs(monster.col - party.col),
    Math.abs(monster.row - party.row),
  );
  if (dist > radius) return false;
  return hasLineOfSight(grid, monster.col, monster.row, party.col, party.row);
}

/** Find every painted spawn cell in the grid. Returns each lair's
 *  position alongside the matching SimSpawn record (or null when the
 *  cell references a spawn id the catalog doesn't define — useful
 *  signal for the caller to log, but never throws). Destroyed lairs
 *  the caller already knows about should be filtered out before
 *  consulting the pass. */
export function findLairs(
  grid: ReadonlyArray<ReadonlyArray<SpawnCellInfo | null | undefined>>,
  catalog: ReadonlyMap<string, SimSpawn>,
): Array<{ col: number; row: number; spawn: SimSpawn }> {
  const out: Array<{ col: number; row: number; spawn: SimSpawn }> = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const id = cell?.spawn;
      if (!id) continue;
      const sp = catalog.get(id);
      if (!sp) continue;
      out.push({ col: c, row: r, spawn: sp });
    }
  }
  return out;
}

/** True when (col,row) is the party's cell or Chebyshev-adjacent to it.
 *  Used to decide whether a freshly-stepped roamer collided with the
 *  party (the v1 rule that closing the distance to 0 OR 1 starts the
 *  fight). */
export function roamerCollidesWithParty(
  roamer: { col: number; row: number },
  party: Position,
): boolean {
  return (
    Math.max(
      Math.abs(roamer.col - party.col),
      Math.abs(roamer.row - party.row),
    ) <= 1
  );
}

/** Seed placed-encounter roamers from the grid — one entity per cell
 *  whose `encounter` id resolves in the catalog. Unknown ids drop
 *  silently. Defeated cells (passed in via `excluded`) are skipped so
 *  re-entering the simulator after a victory doesn't respawn them.
 *  Each entity starts on its source cell; the caller drives the
 *  pursuit pass after that. */
export function findPlacedEncounters(
  grid: ReadonlyArray<ReadonlyArray<SpawnCellInfo | null | undefined>>,
  catalog: ReadonlyMap<string, SimEncounterRef>,
  excluded?: ReadonlySet<string>,
): SimPlacedEncounter[] {
  const out: SimPlacedEncounter[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const id = cell?.encounter;
      if (!id) continue;
      const sourceKey = `${c},${r}`;
      if (excluded?.has(sourceKey)) continue;
      const enc = catalog.get(id);
      if (!enc) continue;
      out.push({
        id: `placed-${c}-${r}`,
        encounterId: id,
        col: c,
        row: r,
        sourceKey,
        sprite: enc.monster_party_tile,
        tint: enc.tint,
      });
    }
  }
  return out;
}

/** One request fed to {@link findQuestPlacedEncounters}: a kill step
 *  wants `count` copies of `encounterId` placed on the current map.
 *  Mirrors the shape returned by `Quests.activeKillStepsAt`. */
export interface QuestPlacementRequest {
  /** Stable quest id (used to compose the placed-encounter id). */
  questId: string;
  /** Step index inside the quest. */
  stepIdx: number;
  /** Encounter catalog id the step wants cleared. */
  encounterId: string;
  /** How many copies of `encounterId` still need to be on the map.
   *  Typically `step.count - already_killed`. */
  count: number;
}

/** Default tint applied to quest-driven placed encounters — a soft
 *  gold halo, multiplied with the cell's lighting tint at draw time.
 *  Matches the value the dungeon generator uses for quest-target
 *  monsters so all quest-related spawns read the same colour. */
export const QUEST_TARGET_TINT = 0xffe580;

/**
 * Place `request.count` copies of each request's encounter on random
 * walkable cells, returning the resulting {@link SimPlacedEncounter}
 * rows. The caller is responsible for assembling `walkable` from its
 * grid (minus the party spawn, NPC homes, painted encounter cells,
 * any other reservations).
 *
 * Cells are consumed from `walkable` as they're picked, so the same
 * cell never receives two quest spawns and the same list can be
 * passed alongside a static `findPlacedEncounters` pass without
 * collisions (caller filters its own static-encounter cells out
 * first).
 *
 * Requests whose encounter id is unknown to the catalog drop
 * silently — the helper logs nothing, since validation belongs at
 * the catalog-load boundary, not in the placement pass.
 *
 * Pure — no grid mutation, no global RNG. `rng` defaults to
 * `Math.random`; tests pass a deterministic generator so a placement
 * assertion can pin a known cell.
 */
export function findQuestPlacedEncounters(
  requests: ReadonlyArray<QuestPlacementRequest>,
  catalog: ReadonlyMap<string, SimEncounterRef>,
  walkable: Array<[number, number]>,
  options?: { rng?: () => number; tint?: number },
): SimPlacedEncounter[] {
  const rng = options?.rng ?? Math.random;
  const tint = options?.tint ?? QUEST_TARGET_TINT;
  const out: SimPlacedEncounter[] = [];
  for (const req of requests) {
    const enc = catalog.get(req.encounterId);
    if (!enc) continue;
    for (let n = 0; n < req.count; n++) {
      if (walkable.length === 0) return out;
      const idx = Math.floor(rng() * walkable.length);
      const [c, r] = walkable.splice(idx, 1)[0];
      out.push({
        id: `q-${req.questId}-${req.stepIdx}-${n}`,
        encounterId: req.encounterId,
        col: c,
        row: r,
        sourceKey: `${c},${r}`,
        sprite: enc.monster_party_tile,
        tint: enc.tint ?? tint,
      });
    }
  }
  return out;
}
