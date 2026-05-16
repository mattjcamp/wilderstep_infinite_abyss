/**
 * Map loader for the v2 module's maps.json — narrow surface used by
 * the battle simulator's arena picker.
 *
 * v2's map model stores each cell as a full inline tile record
 * (sprite, walkable, obstructs, etc.) so the simulator only needs to
 * read `sprite` per cell to render a battle arena. Walls + walkability
 * remain hardcoded by `Arena.ts` (isWall) for now — the picker only
 * swaps the FLOOR sprite. A later pass can promote per-cell walkable
 * into combat-pathing.
 *
 * Maps are flagged for use as battle arenas via the `"battle_screen_arena"`
 * tag in `Map.tags[]`. `loadArenaMaps()` filters on that tag so the
 * simulator's picker only surfaces purpose-built arenas, not the
 * overworld / dungeon / interior maps an author may also have.
 */

import { modulePath } from "./Module";

/** Single cell carried in a v2 map's grid. Only the fields the
 *  simulator actually reads are typed; the rest round-trip through
 *  the index signature so a future render path can pick them up
 *  without breaking the loader. */
export interface ArenaMapCell {
  /** Folder-relative sprite path, e.g. "map/grass1.png". Resolves to
   *  `/sprites/<sprite>` at render time. */
  sprite?: string;
  /** Whether the cell is passable. Reserved — combat pathing still
   *  uses Arena.ts's hardcoded perimeter wall. */
  walkable?: boolean;
  /** Other tile fields (counter, encounter, light_source, …) ride
   *  through unchanged so future renderers can read them. */
  [k: string]: unknown;
}

export interface ArenaMap {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  width: number;
  height: number;
  grid: ArenaMapCell[][];
}

interface RawMap {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  width?: number;
  height?: number;
  grid?: ArenaMapCell[][];
}

interface RawMapsFile {
  _comment?: string;
  maps?: RawMap[];
}

/** Tag value flagged on maps that are intended to back a battle
 *  arena. The simulator's picker filters on this. */
export const ARENA_TAG = "battle_screen_arena";

/**
 * Compact arena cell the simulator + CombatScene consume. Carries
 * just the three fields combat cares about right now:
 *
 *   - `sprite`     — already-resolved /sprites/… URL for the floor.
 *                    `null` falls back to the scene's default fill.
 *   - `walkable`   — true if a combatant can stand on the cell.
 *                    Movement (tryMove, monster AI step) refuses
 *                    `walkable === false` cells.
 *   - `obstructs`  — true if the cell blocks a straight line for
 *                    projectiles / spells. Range + damage-cast
 *                    targeting walks Bresenham and rejects targets
 *                    whose intermediate cells obstruct.
 *
 * Defaults when a cell is missing or malformed: walkable=true,
 * obstructs=false, sprite=null — i.e. "open ground with default
 * appearance" — so a partial map degrades gracefully into the
 * legacy arena.
 */
export interface ArenaCellInfo {
  sprite: string | null;
  walkable: boolean;
  obstructs: boolean;
}

let _flatCache: ArenaMap[] | null = null;

function fromRaw(raw: RawMap): ArenaMap | null {
  if (!raw.id || !raw.name) return null;
  const grid = Array.isArray(raw.grid) ? raw.grid : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [];
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    tags,
    width: typeof raw.width === "number" ? raw.width : grid[0]?.length ?? 0,
    height: typeof raw.height === "number" ? raw.height : grid.length,
    grid,
  };
}

/** Flat list of every map in `modules/<id>/maps.json`. Cached for the
 *  session — call `_clearMapsCache()` between module switches. */
export async function loadAllMaps(): Promise<ArenaMap[]> {
  if (_flatCache) return _flatCache;
  const url = modulePath("maps.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as RawMapsFile;
  const out: ArenaMap[] = [];
  for (const r of raw.maps ?? []) {
    const m = fromRaw(r);
    if (m) out.push(m);
  }
  _flatCache = out;
  return out;
}

/** Only the maps an author has flagged as a battle arena. Used by the
 *  BattleSimLauncher map picker. */
export async function loadArenaMaps(): Promise<ArenaMap[]> {
  const all = await loadAllMaps();
  return all.filter((m) => m.tags.includes(ARENA_TAG));
}

/** Test-only cache reset. */
export function _clearMapsCache(): void {
  _flatCache = null;
}
