/**
 * Convert a v1 `DungeonLevel` (numeric-tile grid + decorations +
 * stairs metadata) into a v2-shaped map record the simulator can
 * mount. Pure — no DOM / Phaser dependencies.
 *
 * Each cell of the input grid maps onto a `DungeonTilePrototype`
 * (see tileMapping.ts) which is deep-cloned and patched with
 * per-cell extras:
 *   - Stairs cells (up / down / forest archway) get a `link` field
 *     pointing at a synthetic neighbour map id so the simulator's
 *     existing link traversal fires on step. The host wires the
 *     synthetic ids to the actual floor-swap behaviour.
 *   - Cells that fall in `decorations` apply a torch / wall-torch
 *     overlay (light source). Cosmetic puddles / moss are dropped
 *     since the simulator doesn't use them.
 *
 * The resulting `DungeonMapRecord` is intentionally compatible with
 * the editor's `MapRecord` so the same Phaser scene + simulator can
 * render it without a code branch.
 */

import {
  TILE_FOREST_ARCHWAY_DOWN,
  TILE_FOREST_ARCHWAY_UP,
  TILE_WALL_TORCH,
} from "@/v1battle/world/Tiles";
import {
  TILE_CHEST,
  TILE_STAIRS,
  TILE_STAIRS_DOWN,
} from "@/v1battle/world/Dungeon";
import { TILE_DFLOOR } from "@/v1battle/world/Tiles";
import type { DungeonLevel, DungeonStyle } from "@/v1battle/world/Dungeon";
import { prototypeForTileId, type DungeonTilePrototype } from "./tileMapping";

/** A dungeon-level cell. Compatible with the editor's `TileType` and
 *  the simulator's `SimCell` — both consume this subset of fields. */
export interface DungeonMapCell extends DungeonTilePrototype {}

/** Link target for stairs-up at floor index 0 — the host wires this
 *  id to "exit the dungeon and resume the overworld sim". */
export const EXIT_TO_OVERWORLD_MAP_ID = "__dungeon_exit__";

/** Build the synthetic map id used to thread floors together via
 *  `tile.link.map_id`. Stable per dungeon so re-entering produces
 *  the same wiring. The MapEditor's dungeon-session bookkeeping
 *  intercepts these ids — they never resolve to a real authored
 *  map. */
export function floorMapId(dungeonId: string, floorIdx: number): string {
  return `__dungeon_${dungeonId}_f${floorIdx}__`;
}

/** Output shape. Mirrors enough of the editor's `MapRecord` to feed
 *  the same Phaser preload pass + the simulator. The `tags` carry a
 *  `dungeon` marker so any future filtering knows this isn't a
 *  hand-painted map. */
export interface DungeonMapRecord {
  id: string;
  name: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  grid: DungeonMapCell[][];
}

export interface DungeonLevelToMapOptions {
  dungeonId: string;
  /** 0-based floor index. Drives the stairs-up link target — F0
   *  exits to the overworld; F1+ goes back to the previous floor. */
  floorIdx: number;
  /** Total floor count for the dungeon. Used to decide whether
   *  stairs-down link to the next floor or to the overworld (bottom-
   *  floor exit). */
  totalFloors: number;
}

/** Convert one floor. The output grid is `[row][col]` to match the
 *  editor's authoring convention. */
export function dungeonLevelToMap(
  level: DungeonLevel,
  opts: DungeonLevelToMapOptions,
): DungeonMapRecord {
  const { dungeonId, floorIdx, totalFloors } = opts;
  const style: DungeonStyle = level.style;
  const grid: DungeonMapCell[][] = [];

  // The generator's tile grid carries a few "buffer" rows past the
  // declared height (see Dungeon.ts: `const BUFFER = 3;`). We respect
  // the level's *declared* dimensions and clip the buffer so the
  // simulator's grid lines up with what authoring expected.
  const renderHeight = level.height;
  const renderWidth = level.width;

  for (let r = 0; r < renderHeight; r++) {
    const row: DungeonMapCell[] = [];
    for (let c = 0; c < renderWidth; c++) {
      const tileId = level.tiles[r]?.[c] ?? -1;
      // Chests render as a "placed item" overlay on top of the
      // style's floor, not as a cell whose own sprite is the chest
      // art. With the chest sprite's background pixels alpha-zero,
      // the floor shows through naturally — the chest reads as
      // sitting on the floor, not floating in a void. Stairs and
      // other "placed" things could follow this same pattern
      // later; today only chests get it.
      const isChest = tileId === TILE_CHEST;
      const lookupId = isChest ? TILE_DFLOOR : tileId;
      const proto = prototypeForTileId(lookupId, style);
      // Fallback to a wall when the generator emitted an unmapped
      // tile id — safer than a walkable floor since we don't know
      // what the cell was supposed to be.
      const base: DungeonMapCell = proto
        ? cloneProto(proto)
        : cloneProto(prototypeForTileId(0, style) ?? FALLBACK_WALL);
      if (isChest) {
        // Identity bits carry over so the rest of the system can
        // tell "this is a chest cell" — walkability stays true (the
        // party can step onto a chest to interact), the sprite
        // stays the floor's, and an overlay carries the chest art.
        base.id = "chest";
        base.name = "Chest";
        base.placedItemSprite = "map/chest_tile.png";
      }
      patchStairsLink(base, tileId, dungeonId, floorIdx, totalFloors);
      patchTileProperties(base, level, c, r);
      patchDecoration(base, level, c, r, style);
      row.push(base);
    }
    grid.push(row);
  }

  // Walking onto monster positions kicks off combat through the
  // placed-encounter subsystem. We do that by stamping an
  // `encounter` id onto each cell that holds a `DungeonMonster`.
  // The simulator's encounter pursuit picks them up at mount time.
  for (const m of level.monsters) {
    const cell = grid[m.row]?.[m.col];
    if (!cell) continue;
    // The encounter id mirrors the per-monster `encounterName` so
    // the host can resolve it back to a real encounter record. Falls
    // back to a synthesized id when the generator only carried a
    // monster name.
    if (m.encounterNames.length > 0) {
      // Use a per-cell unique synthetic id so two adjacent encounters
      // don't collapse into one. The host's encounter catalog must
      // include matching entries — see DungeonSimMount where we
      // synthesize them.
      cell.encounter = `__dungeon_enc_${m.id}__`;
    }
  }

  return {
    id: floorMapId(dungeonId, floorIdx),
    name: level.name,
    description: "",
    tags: ["dungeon"],
    width: renderWidth,
    height: renderHeight,
    grid,
  };
}

/** Roll-up summary of every placed encounter on a floor. Hosts pass
 *  this into the simulator's encounter catalog so each
 *  `__dungeon_enc_*__` id the cells reference resolves to a real
 *  roster. The host owns the encounter monster names; this helper
 *  just hands back the (id, name, monsters[]) tuples in one pass.
 *  Pure — no dependency on the simulator types. */
export function dungeonEncounterRefs(level: DungeonLevel): Array<{
  id: string;
  name: string;
  monsters: string[];
}> {
  return level.monsters.map((m) => ({
    id: `__dungeon_enc_${m.id}__`,
    name: m.encounterName,
    monsters: m.encounterNames.length > 0
      ? [...m.encounterNames]
      : [m.name],
  }));
}

// ── internals ──────────────────────────────────────────────────────

const FALLBACK_WALL: DungeonTilePrototype = {
  id: "dungeon_wall",
  name: "Dungeon Wall",
  tag: "dungeon",
  walkable: false,
  obstructs: true,
  light_source: false,
  light_range: 0,
  sprite: "map/stone_wall.png",
  boat: false,
  locked: false,
  text: "",
  animation: "none",
  counter: "",
  encounter: "",
  spawn: "",
  item: "",
  quest: "",
  dungeon: "",
  npc: "",
  link: null,
};

function cloneProto(p: DungeonTilePrototype): DungeonMapCell {
  return { ...p, link: p.link ? { ...p.link } : null };
}

/** Stairs cells need a `link.map_id` so the simulator's existing
 *  link-traversal path fires on step. The `x`/`y` in the link
 *  describe *where on the destination map* the party should land —
 *  this matches the editor's link convention. For dungeon transitions
 *  the host swaps maps wholesale, so the coords are best-effort
 *  (host pins to the destination floor's matching stairs cell). */
function patchStairsLink(
  cell: DungeonMapCell,
  tileId: number,
  dungeonId: string,
  floorIdx: number,
  totalFloors: number,
): void {
  // Up — exit to previous floor, or to overworld at floor 0.
  if (tileId === TILE_STAIRS || tileId === TILE_FOREST_ARCHWAY_UP) {
    if (floorIdx === 0) {
      cell.link = { map_id: EXIT_TO_OVERWORLD_MAP_ID, x: 0, y: 0 };
    } else {
      cell.link = {
        map_id: floorMapId(dungeonId, floorIdx - 1),
        x: 0,
        y: 0,
      };
    }
    return;
  }
  // Down — descend, or exit at the bottom of a multi-level dungeon.
  if (tileId === TILE_STAIRS_DOWN || tileId === TILE_FOREST_ARCHWAY_DOWN) {
    if (floorIdx >= totalFloors - 1) {
      cell.link = { map_id: EXIT_TO_OVERWORLD_MAP_ID, x: 0, y: 0 };
    } else {
      cell.link = {
        map_id: floorMapId(dungeonId, floorIdx + 1),
        x: 0,
        y: 0,
      };
    }
    return;
  }
}

/** The generator's per-cell `tileProperties` overrides (today: forest
 *  tree-wall walkability flips) apply on top of the prototype's
 *  walkability default. Same field shape v1 used; we copy through. */
function patchTileProperties(
  cell: DungeonMapCell,
  level: DungeonLevel,
  col: number,
  row: number,
): void {
  const key = `${col},${row}`;
  const overrides = level.tileProperties[key];
  if (!overrides) return;
  if (typeof overrides.walkable === "boolean") {
    cell.walkable = overrides.walkable;
  }
}

/** Decoration layer — only the wall-torch matters for the
 *  simulator (it's a light source). Puddles / moss are visual-only
 *  and silently ignored since v2 doesn't render the decoration
 *  channel yet. */
function patchDecoration(
  cell: DungeonMapCell,
  level: DungeonLevel,
  col: number,
  row: number,
  _style: DungeonStyle,
): void {
  const key = `${col},${row}`;
  const decoTile = level.decorations[key];
  if (decoTile === TILE_WALL_TORCH) {
    cell.light_source = true;
    // Dungeon torches throw a 5-tile light pool — matches the
    // `WALL_TORCH_PROTO` default in `tileMapping.ts`. Authoring
    // convention: overworld torches stay smaller; dungeon torches
    // are the bigger source.
    cell.light_range = 5;
    // The underlying wall sprite stays in place — the particle
    // emitter (`animation: "torch"`) renders the flame on top so
    // the torch reads as "mounted on this wall" rather than
    // replacing the wall with a composite that may not match the
    // surrounding style. v1's wall_torch.png was authored against
    // overworld brick walls; dungeon stone walls would clash.
    cell.animation = "torch";
  }
}
