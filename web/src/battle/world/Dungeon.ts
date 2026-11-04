/**
 * Procedural dungeon generator (web port).
 *
 * Mirrors `src/dungeon_generator.py` from the Python project — same
 * rooms-and-corridors algorithm, same difficulty / torch-density /
 * level-size dials so a dungeon defined in `dungeons.json` produces
 * a comparable map in the web build.
 *
 * **Algorithm.** Start with a wall-filled grid; carve rectangular
 * rooms at random positions with a 1-tile padding; connect each room
 * to the previous with an L-shaped corridor of variable width;
 * place stairs in the first room (entry) and optionally stairs-down
 * in the last; sprinkle chests and traps in the later rooms; place
 * torches against walls, then puddles + moss as cosmetic decoration.
 *
 * **Styles.** Every style carves the same generic TILE_DWALL /
 * TILE_DFLOOR grid; the dungeon→map converter (sim/dungeon/
 * dungeonLevelToMap.ts) paints it with the style's tileset:
 *   - `"dungeon"` — Dungeon Tileset, walls autotiled by neighbour.
 *   - `"cavern"`  — same, but roughened into natural rock
 *                   (`roughenCavern`) and painted with the Cave Tileset.
 *
 * **Persistence.** Generation is deterministic on a `seed` integer.
 * Callers seed with `(name, overworldCol, overworldRow) + level` so a
 * given dungeon entry produces the same layout every session — the
 * "generate once and save" requirement maps onto reproducible
 * regeneration plus a per-cell `tiles` grid that the cache mutates
 * in-place as the party explores (chests opened, traps triggered, etc.).
 *
 * The output `DungeonLevel` is a plain data object with no Phaser
 * dependencies so the generator stays unit-testable.
 */
import { mulberry32, type RNG, defaultRng } from "../rng";
import {
  TILE_DFLOOR,
  TILE_DDOOR, TILE_LOCKED_DOOR,
  TILE_WALL_TORCH,
} from "./Tiles";
import { sampleEncounter, type EncounterTemplate } from "./Encounters";

// ── Tile id constants used only by the generator ─────────────────
// These mirror src/settings.py ids that aren't already exported by
// Tiles.ts. We keep them local so the public surface of Tiles.ts
// stays narrow.
export const TILE_DWALL = 21;
export const TILE_STAIRS = 22;       // up / entrance
export const TILE_CHEST = 23;
export const TILE_TRAP = 24;
export const TILE_STAIRS_DOWN = 25;
export const TILE_ARTIFACT = 27;
/** Open pit / chasm floor — not walkable, but you can see across it.
 *  Carved inside rooms by `placePits`; the converter gives each pit
 *  cell its rim piece from the style's tileset. */
export const TILE_PIT = 28;
/** Room objects — block movement, never a route (see `placeObjects`).
 *  The converter paints them per style: pillar / stalagmite, rubble,
 *  throne. */
export const TILE_PILLAR = 30;
export const TILE_RUBBLE = 31;
export const TILE_THRONE = 35;
const TILE_PUDDLE = 32;
const TILE_MOSS = 33;

// Tiles that count as "wall" for door placement / torch adjacency.
const WALL_TILES: ReadonlySet<number> = new Set([TILE_DWALL]);

// ── Tunable types exposed via dungeons.json ──────────────────────
//
// These match the v2 data dictionary entries
// (docs/data_dictionary/dungeon.md, dungeon_level.md, monster.md)
// so the on-disk records flow into the generator with no adapter
// layer. `"boss"` joins the difficulty tiers as the per-floor boss
// band — meant for a climactic floor inside an otherwise-deadly
// dungeon, set via a Dungeon Level override.

/** Procedural dungeon styles.
 *   - `"dungeon"` — rooms-and-corridors painted with the Dungeon
 *     Tileset (directional walls autotiled by neighbour — see
 *     sim/dungeon/dungeonAutotile.ts).
 *   - `"cavern"` — rooms-and-corridors roughened into a cave (see
 *     `roughenCavern`) and painted with the Cave Tileset (autotiled
 *     like "dungeon"). */
export type DungeonStyle = "dungeon" | "cavern";

/** Every supported style, in editor display order. */
export const DUNGEON_STYLES: readonly DungeonStyle[] = ["dungeon", "cavern"];

/** Narrow an on-disk style value to a supported style. Anything else —
 *  including the retired legacy styles ("caves", "ruins", "forest",
 *  "custom") — falls back to `"dungeon"`. */
export function normalizeDungeonStyle(v: unknown): DungeonStyle {
  return v === "cavern" ? "cavern" : "dungeon";
}

export type Difficulty = "easy" | "normal" | "hard" | "deadly" | "boss";
export type LevelSize = "small" | "medium" | "large";
export type TorchDensity = "none" | "sparse" | "moderate" | "abundant";

export interface DifficultyProfile {
  minRooms: number;
  maxRooms: number;
  /** Inclusive level band for random encounter rolls. */
  encMin: number;
  encMax: number;
  /** Per-non-entrance-room probability of rolling an encounter. */
  encChance: number;
}

const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy:   { minRooms: 4,  maxRooms: 6,  encMin: 1, encMax: 2, encChance: 0.35 },
  normal: { minRooms: 6,  maxRooms: 10, encMin: 2, encMax: 4, encChance: 0.50 },
  hard:   { minRooms: 8,  maxRooms: 14, encMin: 3, encMax: 6, encChance: 0.65 },
  deadly: { minRooms: 10, maxRooms: 18, encMin: 5, encMax: 8, encChance: 0.80 },
  // Boss tier is tuned for a single climactic floor: a tighter
  // room count keeps the layout focused (the room-tested encounter
  // density translates into one or two big set-pieces), the
  // encounter band is pinned at the top of the cap, and the chance
  // is high enough that nearly every non-entrance room delivers a
  // fight. Use via a per-Level override, not as a parent default.
  boss:   { minRooms: 5,  maxRooms: 8,  encMin: 7, encMax: 8, encChance: 0.90 },
};

/**
 * Resolve the difficulty profile for a tier. The tier alone decides
 * the floor's rooms, encounter level band, and fight chance — floor
 * depth has no effect, so a 10-floor "easy" dungeon stays easy all
 * the way down. To make deeper floors harder, set a per-Level
 * `difficulty` override. Unknown tiers fall back to "normal".
 */
export function getDifficultyProfile(
  difficulty: Difficulty | string | undefined,
): DifficultyProfile {
  const tier = (difficulty as Difficulty) in DIFFICULTY_PROFILES
    ? (difficulty as Difficulty)
    : "normal";
  return { ...DIFFICULTY_PROFILES[tier] };
}

// (width, height) for each level_size category. Matches the Python
// _enter_module_dungeon mapping; the generator pads the height by
// BUFFER rows internally.
export const LEVEL_SIZES: Record<LevelSize, { width: number; height: number }> = {
  small:  { width: 30, height: 20 },
  medium: { width: 40, height: 30 },
  large:  { width: 60, height: 40 },
};

// v2 records carry `torch_density` as a 0..1 probability. The
// generator now consumes that probability directly via
// `torchProfileFromProbability` below — no banded enum lookup. The
// TorchDensity type stays exported for legacy callers (currently
// just the orphaned v1 dungeons-loader).

// ── Output shape ─────────────────────────────────────────────────

export interface DungeonMonster {
  /** Stable id used to remove this monster from the array on victory. */
  id: string;
  col: number;
  row: number;
  /** Catalog name (resolved against monsters.json). */
  name: string;
  /** Encounter roster. CombatScene receives this as monsterNames. */
  encounterNames: string[];
  /** Display name of the encounter template. */
  encounterName: string;
  /** Source EncounterTemplate id (from encounters.json) the generator
   *  sampled for this placement. Captured at sample time so the
   *  dungeon-bake feature in the editor can stamp real, persistable
   *  encounter ids onto the baked map cells (vs. the synthetic
   *  `__dungeon_enc_*__` ids the runtime uses). Optional because the
   *  procedural runtime path doesn't need it — only `dungeonBake`
   *  consumes it today. */
  encounterId?: string;
  /**
   * Quest this monster was placed for. Set by the dungeon's
   * quest-spawn pass for kill-step targets (e.g. Goblin's Nest's
   * "Wolves and Goblins" warbands); undefined for ordinary random
   * encounters. Used by the renderer to add a soft gold halo so the
   * player can see which sprites credit a quest, and by the spawn
   * pass to count "how many do I still owe" on re-entry.
   */
  questName?: string;
  /** Index of the kill step inside the quest definition. Combined
   *  with `questName`, this is the per-step identity used by the
   *  spawn top-up logic. */
  stepIdx?: number;
}

/**
 * One floor of a generated dungeon. The shape parallels
 * `DungeonData.to_dict()` from the Python game so a saved dungeon
 * (in a future save-to-disk) can be rebuilt without going through
 * the generator a second time.
 */
export interface DungeonLevel {
  name: string;
  width: number;
  height: number;
  /** [row][col] tile id grid. Mutated in-place as chests are opened
   *  and traps spring (matches the Python "replace tile with floor"
   *  behaviour so visited cells blend back into the map). */
  tiles: number[][];
  /** Cosmetic overlay layer (puddles, moss, wall torches). Keyed by
   *  "col,row" → tile id. Drawn on top of the base tile with a
   *  transparent sprite background. */
  decorations: Record<string, number>;
  /** Per-cell property overrides — mirrors the overworld TileMap's
   *  `tile_properties`. The generator currently leaves it empty. */
  tileProperties: Record<string, { walkable?: boolean }>;
  entryCol: number;
  entryRow: number;
  style: DungeonStyle;
  monsters: DungeonMonster[];
  /** "col,row" of chests already looted. */
  openedChests: Set<string>;
  /** "col,row" of traps already triggered. */
  triggeredTraps: Set<string>;
  /** "col,row" of traps the party has already spotted via the Detect
   *  Traps effect. Mirrors the Python game's `detected_traps` —
   *  detected traps render with a pulsing red overlay so the player
   *  can route around them. They still trigger if stepped on. */
  detectedTraps: Set<string>;
  /** Cells the party has stepped onto / seen — drives fog of war. */
  exploredTiles: Set<string>;
  /** "col,row" of stair tiles that exit directly to the overworld
   *  rather than ascending one level (set on the bottom floor of
   *  multi-level dungeons). */
  overworldExits: Set<string>;
  /** Quest collect-item placements keyed by "col,row". Populated by
   *  DungeonScene on entry when an active quest's collect step
   *  targets this dungeon — the scene paints a TILE_ARTIFACT at the
   *  recorded coords and looks up the quest credit when the party
   *  picks it up. Cleared per artifact on pickup so re-entry
   *  doesn't respawn the item. */
  questArtifacts: Record<string, { questName: string; stepIdx: number; itemName: string }>;
  /** Item id (an `is_chest: true` item) that every TILE_CHEST cell on
   *  this floor represents. Empty when the floor was generated with no
   *  loot configured (no chests placed). The dungeon→map converter
   *  stamps this onto each chest cell's `item` so the existing
   *  chest-open / contents pipeline resolves real loot. */
  chestItem: string;
  /** Room rectangles the generator carved, in carve order (index 0 is
   *  the entrance room). The converter uses them for per-room floor
   *  themes. Absent on levels saved before this field existed. */
  rooms?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Pit-fall landings: "col,row" of a pit on this floor → the cell on
   *  the floor below where a party that steps in lands. Only present
   *  when pits drop through (not on the bottom floor); a pit without
   *  an entry here is a solid chasm. Filled by the record wrapper,
   *  which can see the next floor. */
  pitLandings?: Record<string, [number, number]>;
  /** Cosmetic dials the converter reads (0–1). `floorVariety`: how much
   *  of the floor uses the tileset's alternate floors. `wallDecor`:
   *  how many brick faces carry a decoration. Absent → 0. */
  floorVariety?: number;
  wallDecor?: number;
}

// ── Internal helpers ─────────────────────────────────────────────

class Room {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  constructor(x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
  get x2(): number { return this.x + this.w; }
  get y2(): number { return this.y + this.h; }
  get center(): [number, number] {
    return [this.x + Math.floor(this.w / 2), this.y + Math.floor(this.h / 2)];
  }
  intersects(other: Room, padding = 1): boolean {
    return (
      this.x - padding < other.x2 + padding &&
      this.x2 + padding > other.x - padding &&
      this.y - padding < other.y2 + padding &&
      this.y2 + padding > other.y - padding
    );
  }
}

interface Grid {
  width: number;
  height: number;
  tiles: number[][];
  decorations: Record<string, number>;
  tileProperties: Record<string, { walkable?: boolean }>;
}

function makeGrid(width: number, height: number, fill: number): Grid {
  const tiles: number[][] = [];
  for (let r = 0; r < height; r++) {
    const row: number[] = [];
    for (let c = 0; c < width; c++) row.push(fill);
    tiles.push(row);
  }
  return { width, height, tiles, decorations: {}, tileProperties: {} };
}

function getTile(g: Grid, c: number, r: number): number {
  if (c < 0 || c >= g.width || r < 0 || r >= g.height) return -1;
  return g.tiles[r][c];
}

function setTile(g: Grid, c: number, r: number, id: number): void {
  if (c < 0 || c >= g.width || r < 0 || r >= g.height) return;
  g.tiles[r][c] = id;
}

function randInt(rng: RNG, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function randomChoice<T>(rng: RNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffleInPlace<T>(rng: RNG, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** Weighted choice with weights `[5, 3, 1]` for widths `[1, 2, 3]` —
 *  matches the Python tunnel-width distribution. */
function tunnelWidth(rng: RNG): number {
  const r = rng() * 9;
  if (r < 5) return 1;
  if (r < 8) return 2;
  return 3;
}

function carveRoom(g: Grid, room: Room, floor: number): void {
  for (let r = room.y; r < room.y2; r++) {
    for (let c = room.x; c < room.x2; c++) {
      setTile(g, c, r, floor);
    }
  }
}

function carveHTunnel(g: Grid, x1: number, x2: number, y: number, width: number, floor: number): void {
  const half = Math.floor(width / 2);
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  for (let c = lo; c <= hi; c++) {
    for (let dy = -half; dy < -half + width; dy++) {
      const r = y + dy;
      if (r >= 1 && r < g.height - 1) setTile(g, c, r, floor);
    }
  }
}

function carveVTunnel(g: Grid, y1: number, y2: number, x: number, width: number, floor: number): void {
  const half = Math.floor(width / 2);
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  for (let r = lo; r <= hi; r++) {
    for (let dx = -half; dx < -half + width; dx++) {
      const c = x + dx;
      if (c >= 1 && c < g.width - 1) setTile(g, c, r, floor);
    }
  }
}

function connectRooms(g: Grid, a: Room, b: Room, rng: RNG, floor: number): void {
  const [ax, ay] = a.center;
  const [bx, by] = b.center;
  const w1 = tunnelWidth(rng);
  const w2 = tunnelWidth(rng);
  if (rng() < 0.5) {
    carveHTunnel(g, ax, bx, ay, w1, floor);
    carveVTunnel(g, ay, by, bx, w2, floor);
  } else {
    carveVTunnel(g, ay, by, ax, w1, floor);
    carveHTunnel(g, ax, bx, by, w2, floor);
  }
}

const PASSABLE_FOR_DOORS: ReadonlySet<number> = new Set([
  TILE_DFLOOR,
  TILE_STAIRS, TILE_STAIRS_DOWN, TILE_CHEST, TILE_TRAP, TILE_ARTIFACT,
]);

/** Tiles `placeDoors` may treat as a corridor opening (so a door can
 *  form *next to* them) but must NEVER overwrite with a door. Stairs
 *  are placed BEFORE doors; an edge-placed entrance / descent stair
 *  carves a 1-wide trail from the map edge inward, which looks exactly
 *  like a corridor mouth to `placeDoors` and was getting clobbered
 *  with a door — silently destroying the only way down on small maps. Keeping them in `PASSABLE_FOR_DOORS`
 *  preserves connectivity; this set just protects the tile itself. */
const STAIR_TILES_NO_DOOR: ReadonlySet<number> = new Set([
  TILE_STAIRS,
  TILE_STAIRS_DOWN,
]);

/**
 * Collapse doors that touch another door. When a corridor crosses a
 * two-thick wall between rooms, `placeDoors` gives each room its own
 * door on its own wall ring — two doors stacked back to back, which
 * reads as a door-in-a-wall-in-a-wall. Keep the LOWER door (it sits in
 * the brick face you see in the 3/4 view) and turn the one above back
 * into open passage through the top of the wall. Side-by-side doors
 * can't form now that doors only go in horizontal walls; the second
 * pass is a safety net that keeps the WEST one.
 * Runs before locks are rolled. Opening a cell to floor can only add
 * connectivity, never remove it.
 */
function dedupeStackedDoors(g: Grid): void {
  const isDoor = (c: number, r: number) => getTile(g, c, r) === TILE_DDOOR;
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      if (!isDoor(c, r)) continue;
      if (isDoor(c, r + 1)) setTile(g, c, r, TILE_DFLOOR);
    }
  }
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      if (isDoor(c, r) && isDoor(c + 1, r)) setTile(g, c + 1, r, TILE_DFLOOR);
    }
  }
}

/**
 * Place doors flush against walls where corridors enter rooms. A
 * wall-ring tile becomes a door if it has been carved to floor, has a
 * cardinal neighbour inside the room, and is a 1-wide opening in a
 * horizontal wall (walls to its west and east). Openings in side walls
 * are left as plain gaps — see the note in the loop.
 *
 * `doorProbability` (0..1) gates whether each eligible opening actually
 * becomes a door — `1` places every door (the historical "doors are
 * architectural" behaviour, the default), `0` places none (an open
 * layout with no doorframes at all), in between rolls per
 * opening. Locked doors are a strict subset: `placeLockedDoors` runs
 * after this and can only upgrade doors that were placed here, so a
 * low door frequency naturally caps how many can be locked.
 */
function placeDoors(g: Grid, rooms: Room[], doorProbability: number, rng: RNG): void {
  // Fast exits: no doors at all, or every eligible opening (the common
  // case) — skip the per-opening roll.
  if (doorProbability <= 0) return;
  const allRoomTiles = new Set<string>();
  const roomTileSets: Set<string>[] = [];
  for (const room of rooms) {
    const tiles = new Set<string>();
    for (let r = room.y; r < room.y2; r++) {
      for (let c = room.x; c < room.x2; c++) {
        const k = `${c},${r}`;
        tiles.add(k);
        allRoomTiles.add(k);
      }
    }
    roomTileSets.push(tiles);
  }
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const tiles = roomTileSets[i];
    const ring: Array<[number, number]> = [];
    for (let c = room.x; c < room.x2; c++) {
      ring.push([c, room.y - 1]);
      ring.push([c, room.y2]);
    }
    for (let r = room.y; r < room.y2; r++) {
      ring.push([room.x - 1, r]);
      ring.push([room.x2, r]);
    }
    for (const [wc, wr] of ring) {
      const t = getTile(g, wc, wr);
      if (!PASSABLE_FOR_DOORS.has(t)) continue;
      // Never convert a stairs cell into a door — doing so destroys the
      // level transition (the bug that left small edge-transition maps
      // with no way down). The cell can still gate a door on a
      // NEIGHBOURING opening; we just protect this one tile.
      if (STAIR_TILES_NO_DOOR.has(t)) continue;
      if (allRoomTiles.has(`${wc},${wr}`)) continue;
      let connects = false;
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        if (tiles.has(`${wc + dc},${wr + dr}`)) { connects = true; break; }
      }
      if (!connects) continue;
      // Doors only go in HORIZONTAL walls (wall to the west and east,
      // the corridor running north–south), where the door art sits in
      // the brick face you see in the 3/4 view. An opening in a side
      // wall (wall above and below, the corridor running east–west)
      // stays an open gap: a door there reads as a door floating
      // between two stacked wall faces.
      const hWalls = WALL_TILES.has(getTile(g, wc - 1, wr)) && WALL_TILES.has(getTile(g, wc + 1, wr));
      if (!hWalls) continue;
      // Per-opening frequency roll. `>= 1` short-circuits to always-on
      // so the default path doesn't perturb the RNG stream (keeping
      // existing seeds' layouts identical).
      if (doorProbability < 1 && rng() >= doorProbability) continue;
      setTile(g, wc, wr, TILE_DDOOR);
    }
  }
}

/**
 * Replace the lone door of a single-entrance room with a locked door
 * — rolled per room against `lockProbability`. Single-entrance rooms
 * are the candidates because locking a multi-entrance room strands
 * nothing (the party just walks the other way). The entrance room
 * (index 0) is skipped so the dungeon entry is never gated.
 *
 * `p === 0` skips every room; `p >= 1` locks every candidate. Run
 * after `placeDoors`. The fixDisconnectedLockedDoors pass that
 * follows will demote any lock that turns out to strand a region
 * away from the entrance stairs.
 */
function placeLockedDoors(
  g: Grid,
  rooms: Room[],
  lockProbability: number,
  rng: RNG,
): void {
  if (!Number.isFinite(lockProbability) || lockProbability <= 0) return;
  for (let i = 0; i < rooms.length; i++) {
    if (i === 0) continue;
    const room = rooms[i];
    const ring: Array<[number, number]> = [];
    for (let c = room.x; c < room.x2; c++) {
      ring.push([c, room.y - 1]);
      ring.push([c, room.y2]);
    }
    for (let r = room.y; r < room.y2; r++) {
      ring.push([room.x - 1, r]);
      ring.push([room.x2, r]);
    }
    const doors = ring.filter(([c, r]) => getTile(g, c, r) === TILE_DDOOR);
    if (doors.length !== 1) continue;
    if (rng() >= lockProbability) continue;
    const [dc, dr] = doors[0];
    setTile(g, dc, dr, TILE_LOCKED_DOOR);
  }
}

const WALKABLE_FOR_BFS: ReadonlySet<number> = new Set([
  TILE_DFLOOR,
  TILE_STAIRS, TILE_STAIRS_DOWN, TILE_CHEST, TILE_TRAP, TILE_ARTIFACT, TILE_DDOOR,
]);

/**
 * Iteratively unlock locked doors that disconnect rooms from the
 * entrance. Treats regular doors as walkable but locked doors as
 * impassable; any room whose center is unreachable has its locked
 * doors downgraded to regular doors. Runs to a fixpoint.
 */
function fixDisconnectedLockedDoors(g: Grid, rooms: Room[], stairsCol: number, stairsRow: number): void {
  const bfs = (sc: number, sr: number): Set<string> => {
    const visited = new Set<string>();
    const queue: Array<[number, number]> = [[sc, sr]];
    while (queue.length > 0) {
      const [c, r] = queue.shift()!;
      const k = `${c},${r}`;
      if (visited.has(k)) continue;
      if (c < 0 || c >= g.width || r < 0 || r >= g.height) continue;
      if (!WALKABLE_FOR_BFS.has(getTile(g, c, r))) continue;
      visited.add(k);
      queue.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
    }
    return visited;
  };
  for (let pass = 0; pass < rooms.length; pass++) {
    const reachable = bfs(stairsCol, stairsRow);
    let allOk = true;
    for (const room of rooms) {
      const [cx, cy] = room.center;
      if (reachable.has(`${cx},${cy}`)) continue;
      allOk = false;
      for (let c = room.x; c < room.x2; c++) {
        for (const wr of [room.y - 1, room.y2]) {
          if (getTile(g, c, wr) === TILE_LOCKED_DOOR) setTile(g, c, wr, TILE_DDOOR);
        }
      }
      for (let r = room.y; r < room.y2; r++) {
        for (const wc of [room.x - 1, room.x2]) {
          if (getTile(g, wc, r) === TILE_LOCKED_DOOR) setTile(g, wc, r, TILE_DDOOR);
        }
      }
    }
    if (allOk) break;
  }
}

interface TorchDensityProfile {
  /** Manhattan spacing minimum between torches. */
  minSpacing: number;
  /** Cap on torch count, expressed as a multiplier of room count. */
  maxMultiplier: number;
  /** When true, also consider corridor-wall candidates. Kicks in at
   *  higher probabilities so dense dungeons get torches in the
   *  hallways too, not just inside rooms. */
  includeCorridors: boolean;
}

/**
 * Map a 0–1 torch probability into the three knobs the placement
 * loop reads. Linear in spirit; the constants are tuned so the v2
 * authored `torch_density` value reads as "fraction of eligible
 * walls that hold a torch" in practice — i.e. `0.05` is a sparse
 * scattering, `0.25` is a moderate dungeon, `1.0` is "every
 * eligible wall lit, corridors included."
 *
 * `p ≤ 0` produces a profile that places zero torches (the
 * `multiplier × roomCount` cap rounds to zero AND `minSpacing` is
 * effectively infinite so the placement loop never accepts a
 * candidate).
 */
export function torchProfileFromProbability(p: number): TorchDensityProfile {
  if (!Number.isFinite(p) || p <= 0) {
    return { minSpacing: 999, maxMultiplier: 0, includeCorridors: false };
  }
  const clamped = Math.min(1, Math.max(0, p));
  // `8 * p` caps at ~8 torches per room at p=1 — generous, since
  // the minSpacing rule still keeps them from clumping.
  const maxMultiplier = 8 * clamped;
  // Spacing tightens as density rises: p=0.05 → ~8 tiles apart,
  // p=0.5 → ~4 tiles apart, p=1 → 0 → clamped to 2 (the absolute
  // floor so adjacent torches don't share a light pool).
  const minSpacing = Math.max(2, Math.round(8 - 8 * clamped));
  // Beyond 0.4, the per-room candidate pool isn't dense enough to
  // hit the multiplier — fold corridor walls in so the dungeon
  // actually feels lit at higher settings.
  const includeCorridors = clamped >= 0.4;
  return { minSpacing, maxMultiplier, includeCorridors };
}

/**
 * Place wall torches, puddles, and moss on the decoration overlay
 * layer. Torches pick wall cells that have a floor neighbour so the
 * pool of light has somewhere to shine. Puddles and moss prefer cells
 * adjacent to walls (corridors / corners).
 */
function placeDecorations(
  g: Grid,
  rooms: Room[],
  torchProbability: number,
  floorTile: number,
  rng: RNG,
): void {
  const prof = torchProfileFromProbability(torchProbability);
  const maxTorches = Math.floor(rooms.length * prof.maxMultiplier);

  // ── Torch candidates: wall tiles bordering a floor tile ──
  const candidates: Array<[number, number]> = [];
  const isFloor = (c: number, r: number): boolean => getTile(g, c, r) === floorTile;
  const isWall  = (c: number, r: number): boolean => WALL_TILES.has(getTile(g, c, r));
  const offsets: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const room of rooms) {
    for (let c = room.x - 1; c <= room.x + room.w; c++) {
      for (const r of [room.y - 1, room.y + room.h]) {
        if (c < 0 || c >= g.width || r < 0 || r >= g.height) continue;
        if (!isWall(c, r)) continue;
        if (offsets.some(([dx, dy]) => isFloor(c + dx, r + dy))) {
          candidates.push([c, r]);
        }
      }
    }
    for (let r = room.y - 1; r <= room.y + room.h; r++) {
      for (const c of [room.x - 1, room.x + room.w]) {
        if (c < 0 || c >= g.width || r < 0 || r >= g.height) continue;
        if (!isWall(c, r)) continue;
        if (offsets.some(([dx, dy]) => isFloor(c + dx, r + dy))) {
          candidates.push([c, r]);
        }
      }
    }
  }
  if (prof.includeCorridors) {
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        if (!isWall(c, r)) continue;
        if (offsets.some(([dx, dy]) => isFloor(c + dx, r + dy))) {
          candidates.push([c, r]);
        }
      }
    }
  }

  // Dedupe and shuffle.
  const seen = new Set<string>();
  const unique: Array<[number, number]> = [];
  for (const [c, r] of candidates) {
    const k = `${c},${r}`;
    if (!seen.has(k)) { seen.add(k); unique.push([c, r]); }
  }
  shuffleInPlace(rng, unique);

  const placed: Array<[number, number]> = [];
  const isDoor = (c: number, r: number): boolean => {
    const t = getTile(g, c, r);
    return t === TILE_DDOOR || t === TILE_LOCKED_DOOR;
  };
  for (const [tc, tr] of unique) {
    if (placed.length >= maxTorches) break;
    let tooClose = false;
    for (const [pc, pr] of placed) {
      if (Math.abs(tc - pc) + Math.abs(tr - pr) < prof.minSpacing) { tooClose = true; break; }
    }
    if (tooClose) continue;
    if (offsets.some(([dx, dy]) => isDoor(tc + dx, tr + dy))) continue;
    // Not on the top of a thick wall (a wall sitting directly above a
    // brick face) — the renderer draws that as wall top / side strip,
    // never a face, so there's no face for the torch to hang on.
    const below = getTile(g, tc, tr + 1);
    const below2 = getTile(g, tc, tr + 2);
    if (WALL_TILES.has(below) && below2 !== -1 && !WALL_TILES.has(below2)) continue;
    g.decorations[`${tc},${tr}`] = TILE_WALL_TORCH;
    placed.push([tc, tr]);
  }

  // ── Puddles: small water patches on corridor / corner floors ──
  const floors: Array<[number, number]> = [];
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      if (getTile(g, c, r) === floorTile) floors.push([c, r]);
    }
  }
  const numPuddles = Math.max(2, Math.floor(rooms.length / 2));
  shuffleInPlace(rng, floors);
  let puddlesPlaced = 0;
  for (const [fc, fr] of floors) {
    if (puddlesPlaced >= numPuddles) break;
    const wallCount = offsets.reduce((s, [dx, dy]) => s + (isWall(fc + dx, fr + dy) ? 1 : 0), 0);
    if (wallCount >= 1 && rng() < 0.4) {
      g.decorations[`${fc},${fr}`] = TILE_PUDDLE;
      puddlesPlaced += 1;
    }
  }

  // ── Moss: floor-adjacent-to-wall tiles, but not on top of puddles ──
  const numMoss = Math.max(3, rooms.length);
  shuffleInPlace(rng, floors);
  let mossPlaced = 0;
  for (const [fc, fr] of floors) {
    if (mossPlaced >= numMoss) break;
    if (g.decorations[`${fc},${fr}`] !== undefined) continue;
    let wallCount = 0;
    for (const [dx, dy] of offsets) {
      const nc = fc + dx, nr = fr + dy;
      if (isWall(nc, nr)) wallCount += 1;
      else if (g.decorations[`${nc},${nr}`] === TILE_WALL_TORCH) wallCount += 1;
    }
    if (wallCount >= 1 && rng() < 0.35) {
      g.decorations[`${fc},${fr}`] = TILE_MOSS;
      mossPlaced += 1;
    }
  }
}

/**
 * Place a stair tile on the named edge and carve a short trail from
 * the perimeter inward to the nearest carved cell. Returns the stair
 * position, or null if every candidate column/row failed to reach a
 * carved tile.
 */
function placeEdgeStairs(
  g: Grid,
  edge: "north" | "south" | "east" | "west",
  tileId: number,
  floor: number,
  wallTile: number,
  rng: RNG,
  /** Bottom row the "south" edge anchors to. The generator works on a
   *  grid padded with BUFFER throwaway rows below the authored map;
   *  those rows are clipped out of the final floor. Anchoring the
   *  south stair to `g.height - 2` would drop it INTO that clipped
   *  zone — invisible + unreachable (the bug that left small maps with
   *  no way down). Callers pass the authored bottom row so the stair
   *  lands inside the visible map. */
  bottomRow: number = g.height - 2,
): { col: number; row: number } | null {
  const horizontal = edge === "north" || edge === "south";
  let fixedIdx: number;
  let step: number;
  if (edge === "south") { fixedIdx = bottomRow; step = -1; }
  else if (edge === "north") { fixedIdx = 1; step = 1; }
  else if (edge === "east") { fixedIdx = g.width - 2; step = -1; }
  else { fixedIdx = 1; step = 1; }

  const sweepSize = horizontal ? g.width : g.height;
  const sweepStart = Math.max(1, Math.floor(sweepSize / 3));
  const sweepEnd = Math.min(sweepSize - 1, Math.floor((2 * sweepSize) / 3));
  const centered: number[] = [];
  for (let i = sweepStart; i < sweepEnd; i++) centered.push(i);
  const outer: number[] = [];
  for (let i = 1; i < sweepStart; i++) outer.push(i);
  for (let i = sweepEnd; i < sweepSize - 1; i++) outer.push(i);
  shuffleInPlace(rng, centered);
  shuffleInPlace(rng, outer);
  const candidates = [...centered, ...outer];

  if (horizontal) {
    for (const c of candidates) {
      let r = fixedIdx;
      while (r > 0 && r < g.height - 1) {
        if (getTile(g, c, r) !== wallTile) {
          let tr = fixedIdx;
          while (tr !== r) {
            setTile(g, c, tr, floor);
            tr += step;
          }
          setTile(g, c, fixedIdx, tileId);
          return { col: c, row: fixedIdx };
        }
        r += step;
      }
    }
  } else {
    for (const r of candidates) {
      let c = fixedIdx;
      while (c > 0 && c < g.width - 1) {
        if (getTile(g, c, r) !== wallTile) {
          let tc = fixedIdx;
          while (tc !== c) {
            setTile(g, tc, r, floor);
            tc += step;
          }
          setTile(g, fixedIdx, r, tileId);
          return { col: fixedIdx, row: r };
        }
        c += step;
      }
    }
  }
  return null;
}

/** Floor cells an object may sit next to (its 8 neighbours must all be
 *  one of these): open floor and floor-level furniture. Doors are
 *  excluded so nothing crowds a doorway. */
const OBJECT_NEIGHBOUR_OK: ReadonlySet<number> = new Set([
  TILE_DFLOOR, TILE_TRAP, TILE_CHEST, TILE_STAIRS, TILE_STAIRS_DOWN, TILE_ARTIFACT,
]);

/**
 * Scatter room objects. Each plain floor cell whose 8 neighbours are
 * all open floor rolls `0.1 × objectProbability`; a hit becomes a
 * pillar (stalagmite in a cavern) or rubble. Because every neighbour
 * of an object is walkable, the ring around it is a connected loop —
 * an object can never cut a route — and two objects never touch.
 * Runs after every other placement pass so nothing lands on top of
 * stairs, chests, traps, monsters or the entry.
 */
function placeObjects(
  g: Grid,
  objectProbability: number,
  occupied: ReadonlySet<string>,
  rng: RNG,
): void {
  if (objectProbability <= 0) return;
  const chance = 0.1 * Math.min(1, objectProbability);
  for (let r = 1; r < g.height - 1; r++) {
    for (let c = 1; c < g.width - 1; c++) {
      if (getTile(g, c, r) !== TILE_DFLOOR) continue;
      if (occupied.has(`${c},${r}`)) continue;
      let open = true;
      for (let dr = -1; dr <= 1 && open; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if ((dr || dc) && !OBJECT_NEIGHBOUR_OK.has(getTile(g, c + dc, r + dr))) {
            open = false;
            break;
          }
        }
      }
      if (!open) continue;
      if (rng() >= chance) continue;
      setTile(g, c, r, rng() < 0.6 ? TILE_PILLAR : TILE_RUBBLE);
      delete g.decorations[`${c},${r}`];
    }
  }
}

/**
 * Boss floors get a throne: centred against the back (north) wall of
 * the last room. Only placed when the wall above it is solid (not a
 * doorway) and the cells beside and below it are open floor, so the
 * room's other routes still connect along the row in front of it.
 */
function placeThrone(g: Grid, room: Room, occupied: ReadonlySet<string>): void {
  const [cx] = room.center;
  const r = room.y;
  if (getTile(g, cx, r) !== TILE_DFLOOR || occupied.has(`${cx},${r}`)) return;
  if (getTile(g, cx, r - 1) !== TILE_DWALL) return;
  for (const [dc, dr] of [[-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
    if (!OBJECT_NEIGHBOUR_OK.has(getTile(g, cx + dc, r + dr))) return;
  }
  setTile(g, cx, r, TILE_THRONE);
  delete g.decorations[`${cx},${r}`];
}

/**
 * Carve pits (chasms) inside rooms. Each room past the entrance rolls
 * `pitProbability` for one pit: a rectangle (2×2 up to ~60% of the
 * room) or, sometimes, a single-cell hole.
 *
 * Safety rule — a pit is only placed where:
 *   - every cell it covers is plain floor (no stairs, chest, trap,
 *     artifact, door, monster, or the entry cell), and
 *   - the 1-cell ring around it is entirely walkable.
 * The ring is a connected loop, so any route that used to cross the
 * pit's footprint can walk around it instead: a pit can never cut a
 * floor in two or strand the stairs. Runs last, after every other
 * placement pass, so nothing is ever dropped into a pit.
 */
function placePits(
  g: Grid,
  rooms: Room[],
  pitProbability: number,
  occupied: ReadonlySet<string>,
  rng: RNG,
): void {
  if (pitProbability <= 0) return;
  const walkable = (c: number, r: number): boolean => {
    const t = getTile(g, c, r);
    return t !== undefined && WALKABLE_FOR_BFS.has(t);
  };
  const fits = (x0: number, y0: number, pw: number, ph: number): boolean => {
    for (let r = y0 - 1; r <= y0 + ph; r++) {
      for (let c = x0 - 1; c <= x0 + pw; c++) {
        const inside = c >= x0 && c < x0 + pw && r >= y0 && r < y0 + ph;
        if (inside) {
          if (getTile(g, c, r) !== TILE_DFLOOR) return false;
          if (occupied.has(`${c},${r}`)) return false;
        } else if (!walkable(c, r)) {
          return false;
        }
      }
    }
    return true;
  };
  for (let i = 1; i < rooms.length; i++) {
    if (rng() >= pitProbability) continue;
    const room = rooms[i];
    // Interior span that keeps a 1-cell floor ring inside the room.
    const spanW = room.w - 2;
    const spanH = room.h - 2;
    if (spanW < 1 || spanH < 1) continue;
    const canRect = spanW >= 2 && spanH >= 2;
    for (let attempt = 0; attempt < 8; attempt++) {
      let pw = 1;
      let ph = 1;
      if (canRect && rng() >= 0.25) {
        pw = randInt(rng, 2, Math.max(2, Math.min(spanW, Math.round(room.w * 0.6))));
        ph = randInt(rng, 2, Math.max(2, Math.min(spanH, Math.round(room.h * 0.6))));
      }
      const x0 = randInt(rng, room.x + 1, room.x + room.w - 1 - pw);
      const y0 = randInt(rng, room.y + 1, room.y + room.h - 1 - ph);
      if (!fits(x0, y0, pw, ph)) continue;
      for (let r = y0; r < y0 + ph; r++) {
        for (let c = x0; c < x0 + pw; c++) {
          setTile(g, c, r, TILE_PIT);
          delete g.decorations[`${c},${r}`];
        }
      }
      break;
    }
  }
}

/**
 * Cavern post-process — bites random notches out of the walls that
 * border open floor so rooms and corridors read as natural rock, not
 * cut stone. CARVE-ONLY (wall → floor), so it can never disconnect a
 * path or wall in a door. Skips the map border, torches, and walls
 * next to doors (a notch beside a door would let the party walk
 * around it).
 */
function roughenCavern(g: Grid, rng: RNG): void {
  const isDoor = (c: number, r: number) => {
    const t = getTile(g, c, r);
    return t === TILE_DDOOR || t === TILE_LOCKED_DOOR;
  };
  const picks: Array<[number, number]> = [];
  for (let r = 1; r < g.height - 1; r++) {
    for (let c = 1; c < g.width - 1; c++) {
      if (getTile(g, c, r) !== TILE_DWALL) continue;
      if (g.decorations[`${c},${r}`] !== undefined) continue;
      let floorN = 0;
      let nearDoor = false;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (isDoor(c + dc, r + dr)) nearDoor = true;
        }
      }
      if (nearDoor) continue;
      for (const [dc, dr] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
        if (getTile(g, c + dc, r + dr) === TILE_DFLOOR) floorN++;
      }
      // Bumps on the rock face: one or two open sides, ~30% chance.
      if (floorN >= 1 && floorN <= 2 && rng() < 0.3) picks.push([c, r]);
    }
  }
  // Apply after the scan so one notch doesn't snowball into the next.
  for (const [c, r] of picks) setTile(g, c, r, TILE_DFLOOR);
}

// ── Public API ───────────────────────────────────────────────────

export interface GenerateLevelOptions {
  name: string;
  width: number;
  height: number;
  style: DungeonStyle;
  difficulty: Difficulty;
  /** 0-based floor index. Does not affect difficulty — the
   *  `difficulty` tier alone sets the encounter band. */
  floorIdx: number;
  /** When true, place stairs-down in the last room. */
  placeStairsDown: boolean;
  /** Probability (0..1) that a single-entrance room's lone door is
   *  locked. Locking only applies to doors that `doorProbability`
   *  actually placed — at low door frequency there are simply fewer
   *  doors to lock. At `0` no doors are locked; at `1` every eligible
   *  placed door is locked; in between the lock state is rolled per
   *  room. The connectivity-fix pass still runs to make sure a
   *  critical locked door never strands a region. Matches v2's
   *  `dungeons.json` `locked_doors` field. */
  lockProbability: number;
  /** Probability (0..1) that each eligible room opening gets a door.
   *  `1` (the default the wrapper passes) reproduces the historical
   *  "doors are architectural, always placed" behaviour; `0` places
   *  no doors at all; in between rolls per opening. Matches v2's
   *  `dungeons.json` `doors` field. Optional — absent reads as `1`. */
  doorProbability?: number;
  /** Probability (0..1) that each room past the entrance gets a pit.
   *  Absent / 0 → no pits (the historical layout). See `placePits`. */
  pitProbability?: number;
  /** Clutter: chance (×10%) that each open floor cell with open floor
   *  all around it gets a room object (pillar / stalagmite / rubble).
   *  `0` = none. See `placeObjects`. */
  objectProbability?: number;
  /** Recorded on the level for the converter — see
   *  `DungeonLevel.floorVariety` / `wallDecor`. */
  floorVariety?: number;
  wallDecor?: number;
  /** Place the entrance + exit stairs at the map EDGE (`true`, carving
   *  a trail inward) or in interior rooms (`false`). Absent → `false`. */
  edgeTransitions?: boolean;
  /** Probability (0..1) per eligible wall that a torch is placed.
   *  Drives the three internal knobs (spacing, count multiplier,
   *  whether to consider corridor walls). Matches v2's
   *  `dungeons.json` `torch_density` field. */
  torchProbability: number;
  /** Item id (an `is_chest: true` item) to place chests of, or "" /
   *  undefined for NO chests. Chests are opt-in: when this is empty
   *  the chest pass is skipped entirely regardless of
   *  `chestProbability`. The id is stamped onto the level's
   *  `chestItem` so the dungeon→map converter binds each chest cell to
   *  this item (and thus its authored `contents`). */
  chestItemId?: string;
  /** Probability (0..1) a chest is placed in each eligible room (rooms
   *  past the entrance). Only consulted when `chestItemId` is set.
   *  Matches v2's `dungeons.json` `loot.chest_frequency` field. */
  chestProbability?: number;
  /** Encounter table (loaded from encounters.json). When omitted no
   *  monsters are placed. */
  encounters?: Record<string, EncounterTemplate[]>;
  /** Encounter area key. Defaults to "dungeon". */
  encounterArea?: string;
  /** Optional encounter theme. When set, the random-encounter spawner
   *  only draws encounters whose `theme` matches (e.g. an "undead"
   *  dungeon spawns only undead encounters), falling back to the full
   *  pool if the theme has none in the level band. Empty / unset → no
   *  theme restriction. */
  encounterTheme?: string;
  /**
   * Lookup: monster catalog name → difficulty tag from monsters.json.
   * When supplied, the random-encounter spawner prunes each rolled
   * encounter's roster to monsters whose individual `difficulty`
   * matches the dungeon's tier (strict match — `easy ↔ easy`,
   * `normal ↔ normal`, …). Encounters whose roster empties out are
   * skipped. Without this lookup, only the encounter-`level` band
   * filter applies, which can let a level-6 encounter mix hard /
   * deadly monsters into a "normal" dungeon (the bug this guards
   * against).
   */
  monsterDifficulty?: (name: string) => string | undefined;
  /** Monsters the caller wants guaranteed to appear on this floor —
   *  typically driven by active quest kill-steps targeting the
   *  matching `(dungeon, level)`. After the normal encounter
   *  placement loop runs, the generator checks the placed roster
   *  for each id here; any that didn't naturally land get a
   *  force-placed encounter chosen from the pool. Empty / omitted =
   *  no guarantees beyond what the encounter sampler produces. */
  requiredMonsterIds?: ReadonlyArray<string>;
  /** Deterministic seed. Required so dungeons regenerate identically
   *  across sessions. */
  seed: number;
}

/**
 * Generate one floor of a procedural dungeon. Pure function — output
 * depends only on `opts` and the seeded RNG. Mutated `DungeonLevel`
 * fields (openedChests, etc.) start empty.
 */
export function generateDungeonLevel(opts: GenerateLevelOptions): DungeonLevel {
  const rng = mulberry32(opts.seed);
  const { width, height, style, difficulty } = opts;
  const profile = getDifficultyProfile(difficulty);

  // Every style carves the same generic numeric grid; the dungeon→map
  // converter paints it with the style's tileset.
  const wallTile = TILE_DWALL;
  const floorTile = TILE_DFLOOR;

  // BUFFER trails the Python "extra rows for HUD visibility" trick — the
  // generator works on a slightly taller grid so corridors near the
  // bottom edge don't get clipped when the HUD bar floats over the map.
  const BUFFER = 3;
  const totalHeight = height + BUFFER;
  const grid = makeGrid(width, totalHeight, wallTile);

  // ── Carve rooms ──
  // Room dims + target count scale with the grid area. The default
  // profile assumes a "normal-sized" 32×32 grid; a 16×16 grid can't
  // physically fit 6 rooms at 4–8 size + 1-cell padding, so without
  // scaling the loop hits maxAttempts with only 1–2 rooms placed
  // and the player lands in a sealed entrance room with no exits.
  const minGridDim = Math.min(width, height);
  const small = minGridDim < 24;
  const roomMin = small ? 3 : 4;
  const roomMax = small
    ? Math.max(roomMin + 1, Math.floor(minGridDim / 3))
    : 8;
  // Area-based cap on room count. Average room footprint with
  // padding is roughly (roomMid + 2)^2; we use that to compute how
  // many rooms could plausibly fit before falling back to the
  // difficulty profile's min/max.
  const roomMid = (roomMin + roomMax) / 2 + 2;
  const areaCap = Math.max(
    2,
    Math.floor((width * height) / (roomMid * roomMid)),
  );
  const targetMin = Math.min(profile.minRooms, areaCap);
  const targetMax = Math.min(profile.maxRooms, areaCap);
  const rooms: Room[] = [];
  const numRooms = Math.max(
    targetMin,
    randInt(rng, targetMin, targetMax),
  );
  const maxAttempts = numRooms * 20;
  let attempts = 0;
  while (rooms.length < numRooms && attempts < maxAttempts) {
    attempts += 1;
    const w = randInt(rng, roomMin, roomMax);
    const h = randInt(rng, roomMin, roomMax);
    const x = randInt(rng, 1, width - w - 1);
    const y = randInt(rng, 1, height - h - 1);
    const room = new Room(x, y, w, h);
    if (rooms.some((other) => room.intersects(other, 1))) continue;
    carveRoom(grid, room, floorTile);
    if (rooms.length > 0) connectRooms(grid, rooms[rooms.length - 1], room, rng, floorTile);
    rooms.push(room);
  }

  // Top-up pass — when the first loop exits short of the target
  // (typical on tight grids where many candidate boxes get rejected
  // by `intersects`), try once more with the minimum room size + no
  // padding so a few extra rooms slip in. Prevents the
  // "single-room floor with no monsters" failure mode.
  if (rooms.length < Math.min(3, targetMin)) {
    const topUpTarget = Math.min(3, targetMin);
    let extraAttempts = 0;
    while (rooms.length < topUpTarget && extraAttempts < 200) {
      extraAttempts += 1;
      const w = roomMin;
      const h = roomMin;
      const x = randInt(rng, 1, width - w - 1);
      const y = randInt(rng, 1, height - h - 1);
      const room = new Room(x, y, w, h);
      if (rooms.some((other) => room.intersects(other, 0))) continue;
      carveRoom(grid, room, floorTile);
      if (rooms.length > 0) {
        connectRooms(grid, rooms[rooms.length - 1], room, rng, floorTile);
      }
      rooms.push(room);
    }
  }

  // Bail-out: a malformed dimension combination could starve the room
  // sampler. Fall back to a minimal 1-room dungeon at center.
  if (rooms.length === 0) {
    const fallback = new Room(2, 2, Math.max(4, width - 4), Math.max(4, height - 4));
    carveRoom(grid, fallback, floorTile);
    rooms.push(fallback);
  }

  // ── Entrance + exit transition placement ──
  // `edgeTransitions` decides WHERE transitions go: the map edge
  // (carving a trail inward) or interior rooms (the default).
  const edgeTransitions = opts.edgeTransitions ?? false;
  const edgeUpTile = TILE_STAIRS;
  const edgeDownTile = TILE_STAIRS_DOWN;

  // ── Entrance stairs ──
  let stairsCol = 0;
  let stairsRow = 0;
  let entranceEdge: "north" | "south" | "east" | "west" | null = null;
  if (edgeTransitions) {
    const edges: Array<"north" | "south" | "east" | "west"> = ["north", "east", "south", "west"];
    shuffleInPlace(rng, edges);
    for (const e of edges) {
      const placed = placeEdgeStairs(
        grid, e, edgeUpTile, floorTile, wallTile, rng,
        // Authored bottom row — keep a south-edge entrance inside the
        // visible map (BUFFER rows below are clipped from the floor).
        height - 1,
      );
      if (placed) {
        stairsCol = placed.col;
        stairsRow = placed.row;
        entranceEdge = e;
        break;
      }
    }
  }
  if (entranceEdge === null) {
    // Interior placement — the default for non-edge dungeons, and the
    // fallback when every edge sweep failed.
    const [cc, cr] = rooms[0].center;
    stairsCol = cc;
    stairsRow = cr;
    setTile(grid, stairsCol, stairsRow, TILE_STAIRS);
  }

  // ── Chests in the later rooms ──
  // Opt-in loot: only place chests when the author configured a chest
  // item. Each eligible room (index 2+, i.e. not the entrance / first
  // connector) rolls `chestProbability` for a chest. The placed
  // TILE_CHEST cells all represent `chestItemId`; the dungeon→map
  // converter stamps that id onto each chest cell so the existing
  // chest-open / contents pipeline delivers real loot.
  const chestItemId = opts.chestItemId ?? "";
  if (chestItemId) {
    const chestProb = opts.chestProbability ?? 0;
    for (let i = 2; i < rooms.length; i++) {
      if (rng() < chestProb) {
        const room = rooms[i];
        const cx = room.x + randomChoice(rng, [1, room.w - 2]);
        const cy = room.y + randomChoice(rng, [1, room.h - 2]);
        if (getTile(grid, cx, cy) === floorTile) setTile(grid, cx, cy, TILE_CHEST);
      }
    }
  }

  // ── Traps near the centre of non-entrance rooms ──
  for (let i = 1; i < rooms.length; i++) {
    if (rng() < 0.35) {
      const room = rooms[i];
      let [tx, ty] = room.center;
      tx += randInt(rng, -1, 1);
      ty += randInt(rng, -1, 1);
      if (getTile(grid, tx, ty) === floorTile) setTile(grid, tx, ty, TILE_TRAP);
    }
  }

  // ── Random encounters ──
  const monsters: DungeonMonster[] = [];
  if (opts.encounters) {
    for (let i = 1; i < rooms.length; i++) {
      if (rng() >= profile.encChance) continue;
      const room = rooms[i];
      let [mx, my] = room.center;
      mx += randInt(rng, -1, 1);
      my += randInt(rng, -1, 1);
      if (getTile(grid, mx, my) !== floorTile) continue;
      // Strict per-monster difficulty match — a "normal" dungeon
      // only accepts monsters tagged "normal". The level-band filter
      // above is kept (it shapes the candidate encounter pool) but
      // the per-monster tier is what the user actually sees.
      const allowedDifficulties: ReadonlySet<string> = new Set([opts.difficulty]);
      const enc = sampleEncounter(opts.encounters, opts.encounterArea ?? "dungeon", {
        minLevel: profile.encMin,
        maxLevel: profile.encMax,
        rng,
        allowedDifficulties,
        monsterDifficulty: opts.monsterDifficulty,
        theme: opts.encounterTheme,
      });
      if (!enc) continue;
      monsters.push({
        id: `m-${opts.seed}-${i}`,
        col: mx,
        row: my,
        name: enc.monsterPartyTile,
        encounterNames: enc.monsters,
        encounterName: enc.name,
        encounterId: enc.id,
      });
    }
  }

  // ── Required-monster guarantee ──
  // After the random pass runs, any monster id the caller flagged
  // as required (typically the target of an active quest kill-step
  // for this dungeon + floor) must show up at least once. We scan
  // the already-placed roster, then for each missing id pick an
  // encounter from the area pool that contains it and force-place
  // it in an unused room (not the entrance). Without this a player
  // who accepts "Kill the Giant Rats" can roll a floor that has
  // zero rats, with no way to make progress.
  if (
    opts.requiredMonsterIds &&
    opts.requiredMonsterIds.length > 0 &&
    opts.encounters
  ) {
    const areaPool = opts.encounters[opts.encounterArea ?? "dungeon"] ?? [];
    const placedMonsterIds = new Set<string>();
    for (const m of monsters) {
      for (const id of m.encounterNames) placedMonsterIds.add(id);
    }
    // Track which rooms we've already dropped a monster in so the
    // forced encounters don't pile on the same cell.
    const usedRooms = new Set<number>();
    for (let i = 1; i < rooms.length; i++) {
      const r = rooms[i];
      const [rcx, rcy] = r.center;
      if (monsters.some((m) => m.col === rcx && m.row === rcy)) {
        usedRooms.add(i);
      }
    }
    for (const requiredId of opts.requiredMonsterIds) {
      if (placedMonsterIds.has(requiredId)) continue;
      // Find an encounter in the area pool whose roster contains
      // the required id. Prefer encounters in the floor's level
      // band, but fall back to anything that includes the monster
      // if no band match exists (better to force a slightly off-
      // band fight than to fail the quest objective entirely).
      const containing = areaPool.filter((e) =>
        e.monsters.includes(requiredId),
      );
      if (containing.length === 0) continue;
      const inBand = containing.filter(
        (e) => e.level >= profile.encMin && e.level <= profile.encMax,
      );
      const pool = inBand.length > 0 ? inBand : containing;
      const enc = pool[Math.floor(rng() * pool.length)];
      // Pick the first un-used non-entrance room.
      let placedAt: { col: number; row: number } | null = null;
      for (let i = 1; i < rooms.length; i++) {
        if (usedRooms.has(i)) continue;
        const r = rooms[i];
        let [mx, my] = r.center;
        mx += randInt(rng, -1, 1);
        my += randInt(rng, -1, 1);
        if (getTile(grid, mx, my) !== floorTile) {
          // Fall back to room center if the jittered cell isn't floor.
          mx = r.center[0];
          my = r.center[1];
          if (getTile(grid, mx, my) !== floorTile) continue;
        }
        placedAt = { col: mx, row: my };
        usedRooms.add(i);
        break;
      }
      // Last-resort fallback: drop into the entrance room when no
      // other room is usable. Avoids the actual stairs cell so the
      // creature doesn't sit on top of the spawn point. This is the
      // safety net for the "tiny dungeon, only one room" failure
      // mode — without it, accepting a kill-step on a dungeon that
      // produced a single-room floor would silently fail to place
      // the target monster and the player'd find an empty room.
      if (!placedAt && rooms.length > 0) {
        const r = rooms[0];
        for (let dy = 0; dy < r.h && !placedAt; dy++) {
          for (let dx = 0; dx < r.w && !placedAt; dx++) {
            const mx = r.x + dx;
            const my = r.y + dy;
            if (getTile(grid, mx, my) !== floorTile) continue;
            if (mx === stairsCol && my === stairsRow) continue;
            placedAt = { col: mx, row: my };
          }
        }
      }
      if (!placedAt) continue;
      monsters.push({
        id: `m-${opts.seed}-q-${requiredId}`,
        col: placedAt.col,
        row: placedAt.row,
        name: enc.monsterPartyTile,
        encounterNames: enc.monsters,
        encounterName: enc.name,
        encounterId: enc.id,
        // Mark this as a quest-required placement so the renderer
        // can paint the soft gold halo the DungeonMonster doc
        // comment describes — the player sees which sprites are
        // "credit toward an active quest". Stored as a generic
        // "quest-target" marker (we don't have a specific quest
        // name from the caller — the kill-step is identified by
        // the monster id, not the quest's display name). The
        // renderer only checks truthiness today, so any non-empty
        // string suffices; downstream features can re-key off the
        // monster id encoded here.
        questName: `__quest_target_${requiredId}`,
      });
      placedMonsterIds.add(requiredId);
    }
  }

  // ── Stairs down ──
  // Edge placement when `edgeTransitions` is on (a different edge than
  // the entrance, when possible); otherwise the last room's centre.
  if (opts.placeStairsDown && rooms.length >= 2) {
    let placed: { col: number; row: number } | null = null;
    if (edgeTransitions) {
      const edges: Array<"north" | "south" | "east" | "west"> = ["north", "east", "south", "west"];
      const remaining = edges.filter((e) => e !== entranceEdge);
      shuffleInPlace(rng, remaining);
      for (const e of remaining) {
        placed = placeEdgeStairs(
          grid, e, edgeDownTile, floorTile, wallTile, rng,
          // Authored bottom row — exclude the BUFFER padding so a
          // south-edge archway stays inside the visible map.
          height - 1,
        );
        if (placed) break;
      }
    }
    if (!placed) {
      const [sc, sr] = rooms[rooms.length - 1].center;
      setTile(grid, sc, sr, TILE_STAIRS_DOWN);
    }
  }

  // ── Doors + locked doors + connectivity check ──
  // `doorProbability` decides what fraction of room entries actually
  // get a door (default 1 → "doors are architectural, always placed",
  // preserving historical layouts; 0 → an open layout with none).
  // `lockProbability` then upgrades a fraction of the *placed* doors to
  // locked: p=0 → no locks (matching the v2 `locked_doors: 0` author
  // intent "doors exist, none locked"); p=1 → every eligible door
  // locks (the connectivity pass below still demotes locks that would
  // strand a region).
  placeDoors(grid, rooms, opts.doorProbability ?? 1, rng);
  dedupeStackedDoors(grid);
  placeLockedDoors(grid, rooms, opts.lockProbability, rng);
  fixDisconnectedLockedDoors(grid, rooms, stairsCol, stairsRow);

  // ── Decorations (overlay layer) ──
  placeDecorations(grid, rooms, opts.torchProbability, floorTile, rng);

  // ── Overworld exit ──
  // We used to drop an extra stairs-UP tile mid-floor on the bottom
  // level as a supposed "overworld exit." But a stairs-up on any
  // floor below the top links UPWARD one level (see
  // dungeonLevelToMap.patchStairsLink — TILE_STAIRS at floorIdx > 0
  // → previous floor, only floor 0's links to the overworld). So on
  // the bottom floor it was just a SECOND stairs-up to the same place
  // as the entrance stairs — redundant and confusing, never an actual
  // overworld shortcut. Removed: the party leaves a multi-level
  // dungeon by ascending the entrance stairs floor by floor, exactly
  // as the single remaining stairs-up on each floor already does.
  // `overworldExits` stays in the level shape (it round-trips through
  // the save serialiser) but is always empty now.
  const overworldExits = new Set<string>();

  // ── Cavern post-process: rough, irregular rock walls ──
  if (style === "cavern") roughenCavern(grid, rng);

  // ── Pits — last, so they can only take plain, unoccupied floor ──
  const occupied = new Set<string>([`${stairsCol},${stairsRow}`]);
  for (const m of monsters) occupied.add(`${m.col},${m.row}`);
  placePits(grid, rooms, opts.pitProbability ?? 0, occupied, rng);

  // ── Room objects, then a boss floor's throne ──
  if (difficulty === "boss" && style === "dungeon" && rooms.length >= 2) {
    placeThrone(grid, rooms[rooms.length - 1], occupied);
  }
  placeObjects(grid, opts.objectProbability ?? 0, occupied, rng);

  return {
    name: opts.name,
    width: grid.width,
    height: grid.height,
    tiles: grid.tiles,
    decorations: grid.decorations,
    tileProperties: grid.tileProperties,
    entryCol: stairsCol,
    entryRow: stairsRow,
    style,
    monsters,
    openedChests: new Set<string>(),
    triggeredTraps: new Set<string>(),
    detectedTraps: new Set<string>(),
    exploredTiles: new Set<string>(),
    overworldExits,
    questArtifacts: {},
    chestItem: chestItemId,
    rooms: rooms.map((rm) => ({ x: rm.x, y: rm.y, w: rm.w, h: rm.h })),
    floorVariety: opts.floorVariety ?? 0,
    wallDecor: opts.wallDecor ?? 0,
  };
}

export interface GenerateDungeonOptions {
  name: string;
  style: DungeonStyle;
  numLevels: number;
  difficulty: Difficulty;
  levelSize: LevelSize;
  /** v2-unit 0..1 torch probability — see
   *  `GenerateLevelOptions.torchProbability`. */
  torchProbability: number;
  /** v2-unit 0..1 lock probability — see
   *  `GenerateLevelOptions.lockProbability`. */
  lockProbability: number;
  /** Seeds level N as `seedBase + N` for reproducibility. */
  seedBase: number;
  /** Encounter table (loaded from encounters.json). Optional. */
  encounters?: Record<string, EncounterTemplate[]>;
  /** Forwarded to each level for per-monster difficulty filtering.
   *  See `GenerateLevelOptions.monsterDifficulty` for the contract. */
  monsterDifficulty?: (name: string) => string | undefined;
}

/**
 * Generate every floor of a multi-level dungeon. Stairs-up on floor 0
 * is the entrance (links to the overworld); every deeper floor's
 * stairs-up links one level up. Stairs-down on floors 0..N-2 descend
 * to the next level. The party leaves by ascending the stairs-up
 * back to floor 0 and out — there's no separate bottom-floor exit.
 *
 * NB: the v2-native `generateDungeonFromRecord` wrapper in
 * `sim/dungeon/` is the preferred entry point — it reads the
 * Dungeon record directly and honours per-Level overrides. This
 * function is kept for tests and legacy callers that already
 * supply a flat options bundle.
 */
export function generateDungeon(opts: GenerateDungeonOptions): DungeonLevel[] {
  const size = LEVEL_SIZES[opts.levelSize] ?? LEVEL_SIZES.medium;
  const numLevels = Math.max(1, Math.floor(opts.numLevels));
  const out: DungeonLevel[] = [];
  for (let li = 0; li < numLevels; li++) {
    const lname = numLevels > 1 ? `${opts.name} - Floor ${li + 1}` : opts.name;
    out.push(generateDungeonLevel({
      name: lname,
      width: size.width,
      height: size.height,
      style: opts.style,
      difficulty: opts.difficulty,
      floorIdx: li,
      placeStairsDown: li < numLevels - 1,
      lockProbability: opts.lockProbability,
      torchProbability: opts.torchProbability,
      encounters: opts.encounters,
      encounterArea: "dungeon",
      monsterDifficulty: opts.monsterDifficulty,
      seed: (opts.seedBase + li) >>> 0,
    }));
  }
  return out;
}

/**
 * Stable seed derived from a dungeon's identity on the overworld. Same
 * (name, col, row) → same seed, so a re-entry mid-session and a load
 * after a future save both regenerate the identical layout.
 *
 * 32-bit FNV-1a is used for the string portion so the result is
 * platform-stable (no reliance on JS engine string hashing).
 */
export function dungeonSeed(name: string, overworldCol: number, overworldRow: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= overworldCol & 0xffff;
  h = Math.imul(h, 0x01000193) >>> 0;
  h ^= overworldRow & 0xffff;
  h = Math.imul(h, 0x01000193) >>> 0;
  return h >>> 0;
}

// ── Quest monster placement ─────────────────────────────────────

/** Subset of the kill-step shape `placeQuestKillMonsters` consumes.
 *  Mirrors `Quests.activeKillStepsForLocation`'s return rows so the
 *  scene can pipe the helper's output straight in without reshaping. */
export interface QuestKillSpawnRow {
  questName: string;
  stepIdx: number;
  /** How many encounters of this step still need to be killed
   *  (`target_count - already_killed`). */
  remaining: number;
  /** Encounter template to clone — usually pulled via
   *  `Quests.rosterFor(encounterTable, step.encounter)`. The `id`
   *  field is optional for backwards compatibility with hand-built
   *  template literals, but real `rosterFor` results carry it and
   *  the dungeon-bake feature in the editor depends on it to stamp
   *  real encounter ids onto baked map cells. */
  template: {
    id?: string;
    name: string;
    monsters: string[];
    monsterPartyTile: string;
  };
}

/**
 * Place quest-required monsters into a multi-floor dungeon for every
 * active kill step targeting it. Mirrors `TownScene.spawnInteriorMonstersIfNeeded`
 * but for procedural dungeons.
 *
 * Distribution rule: step N drops onto floor `min(stepIdx, levels.length - 1)`,
 * so step 0 is on the entry floor, step 1 on floor 1, and so on,
 * with later steps clamped to the deepest floor. For Goblin's Nest
 * (2 floors), the "kill 3 warbands" step lands on floor 0 and the
 * "kill the war-leader" step lands on floor 1.
 *
 * Idempotent on re-entry: if an active step already has N monsters
 * placed in `level.monsters` (matched by `questName + stepIdx`), the
 * helper only tops up the missing copies. So re-entering after
 * killing one of three warbands respawns nothing — it adds the
 * remaining two only on the first entry.
 *
 * `isWalkable(col, row, levelIdx)` defers to the scene's tile-
 * walkability rules (per-cell overrides, etc.). `entryByLevel` is the per-floor entry tile — we exclude it
 * so a quest monster can't spawn on top of where the player drops in.
 */
/**
 * Sweep every floor of `levels` and remove quest monsters whose
 * `(questName, stepIdx)` isn't in `activeStepKeys`. Catches:
 *
 *   - Monsters from steps the player has already completed (a
 *     stale 4th warband from older code that placed too many; a
 *     boss spawn whose step is now complete because the player
 *     killed enough warbands and the boss step never had a target).
 *   - Monsters from quests that are now `turned_in` — the quest
 *     is over, the dungeon shouldn't still glow with its targets.
 *   - Monsters whose questName references a quest that no longer
 *     exists in the data (a module rename / deletion edge case).
 *
 * Random (non-quest) monsters are untouched. Idempotent: calling
 * twice with the same active set is a no-op the second time.
 *
 * Pass `activeStepKeys = new Set(steps.map(s => `${s.questName}|${s.stepIdx}`))`
 * — same shape both this helper and the placement helper consume.
 */
export function cleanupCompletedQuestMonsters(
  levels: DungeonLevel[],
  activeStepKeys: ReadonlySet<string>,
): void {
  for (const lvl of levels) {
    lvl.monsters = lvl.monsters.filter((m) => {
      if (m.questName == null || typeof m.stepIdx !== "number") return true;
      return activeStepKeys.has(`${m.questName}|${m.stepIdx}`);
    });
  }
}

export function placeQuestKillMonsters(
  levels: DungeonLevel[],
  rows: readonly QuestKillSpawnRow[],
  isWalkable: (col: number, row: number, levelIdx: number) => boolean,
  rng: () => number = Math.random,
): void {
  if (levels.length === 0) return;
  // Track which floors we've already stripped of random encounters
  // this pass so two quest steps targeting the same floor don't
  // run the filter twice (once is enough; the second `some` check
  // would short-circuit anyway).
  const stripped = new Set<number>();
  for (const row of rows) {
    if (row.remaining <= 0) continue;
    if (!row.template.monsters.length) continue;
    const floorIdx = Math.min(row.stepIdx, levels.length - 1);
    const lvl = levels[floorIdx];
    // **Strip random encounters from any floor that gets quest
    // monsters.** The procedural generator's random pool would
    // otherwise sit alongside the quest spawns — for a low-level
    // dungeon like Goblin's Nest, the random table is dominated by
    // Cellar Rats / Rat Nest (weight 60 of ~85 total), so the
    // player saw their 4 quest-mandated wolves / goblins PLUS ~4
    // random rat encounters. The quest steps are the dungeon's
    // intended content; random rolls dilute the theme. Idempotent:
    // the `.some()` guard means re-entries (where random monsters
    // are already gone) don't cost the filter walk again.
    if (!stripped.has(floorIdx) && lvl.monsters.some((m) => m.questName == null)) {
      lvl.monsters = lvl.monsters.filter((m) => m.questName != null);
    }
    stripped.add(floorIdx);

    // ── Cleanup pass for stale / over-spawned quest monsters ──
    //
    // Older versions of this helper distributed quest monsters
    // differently (everything on floor 0 with no step-based
    // clamping; or no `remaining` cap). A cached dungeon generated
    // under that code carries stale state — misplaced step-N
    // monsters on the wrong floor, or more than `target_count`
    // copies on the right floor. Without cleanup, the player keeps
    // seeing the legacy artifacts even though the new placement
    // math is correct. Two-step heal:
    //
    //   1. Remove this step's monsters from every non-target floor.
    //      They'll get re-spawned in the right place by the top-up
    //      below if `remaining` says so.
    for (let i = 0; i < levels.length; i++) {
      if (i === floorIdx) continue;
      levels[i].monsters = levels[i].monsters.filter(
        (m) => !(m.questName === row.questName && m.stepIdx === row.stepIdx),
      );
    }
    //   2. Cap this step's monsters on the target floor at
    //      `remaining`. If a prior run over-spawned (e.g. 4 copies
    //      when the quest only wanted 3), drop the excess so the
    //      player doesn't fight more than the quest demands.
    let kept = 0;
    lvl.monsters = lvl.monsters.filter((m) => {
      if (m.questName === row.questName && m.stepIdx === row.stepIdx) {
        kept += 1;
        return kept <= row.remaining;
      }
      return true;
    });

    // How many of this step's monsters are now on the target floor
    // (post-cleanup, all step-N monsters live on the target floor).
    const have = lvl.monsters.filter(
      (m) => m.questName === row.questName && m.stepIdx === row.stepIdx,
    ).length;
    const needed = row.remaining - have;
    if (needed <= 0) continue;
    // Build the candidate cell pool — every walkable tile that
    // isn't the entry stair and isn't already occupied by a
    // monster (random or quest).
    const occupied = new Set<string>();
    occupied.add(`${lvl.entryCol},${lvl.entryRow}`);
    for (const m of lvl.monsters) occupied.add(`${m.col},${m.row}`);
    const pool: Array<[number, number]> = [];
    for (let r = 0; r < lvl.height; r++) {
      for (let c = 0; c < lvl.width; c++) {
        if (!isWalkable(c, r, floorIdx)) continue;
        if (occupied.has(`${c},${r}`)) continue;
        pool.push([c, r]);
      }
    }
    let nextN = lvl.monsters.length;
    for (let n = 0; n < needed; n++) {
      if (pool.length === 0) break;
      const idx = Math.floor(rng() * pool.length);
      const [c, r] = pool.splice(idx, 1)[0];
      lvl.monsters.push({
        id: `q-${row.questName}-${row.stepIdx}-${nextN++}`,
        col: c,
        row: r,
        name: row.template.monsterPartyTile,
        encounterNames: [...row.template.monsters],
        encounterName: row.template.name,
        encounterId: row.template.id,
        questName: row.questName,
        stepIdx: row.stepIdx,
      });
    }
  }
}
