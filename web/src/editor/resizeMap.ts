/**
 * Map resize — pure grid/reference transforms behind the editor's
 * "Resize Map" dialog.
 *
 * A resize only GROWS a map (shrinking would orphan painted content;
 * it's deliberately unsupported). New space can be added on any of
 * the four edges. Adding rows/columns on the bottom/right is free —
 * every existing coordinate keeps meaning. Adding on the top/left
 * shifts the whole grid down/right by the added amount, which
 * invalidates anything that stored a coordinate INTO this map:
 *
 *   - `cell.link { map_id, x, y }` on any map (including this one —
 *     self-links are legal) where `map_id` is the resized map.
 *     `x` is the column, `y` the row (see MapSimulation's traversal:
 *     `teleport(link.x, link.y)`).
 *   - `cell.pressure_plate { map_id, col, row, tile_id }` targeting
 *     the resized map.
 *   - party.json's `start_position { map_id, col, row }` when the
 *     party starts on the resized map.
 *
 * The helpers here are pure (inputs are never mutated) so they can be
 * unit-tested without the editor. MapEditor owns persistence: it
 * feeds the current maps-file list through these and writes the
 * result via its usual draft/publish path.
 *
 * Types are structural (minimal fields + index signature) rather than
 * importing MapEditor's TileType/MapRecord — those interfaces are not
 * exported, and the transforms only touch the fields declared here.
 */

/** Hard per-dimension cap — mirrors the New Map form's validation
 *  (MapsBrowse: width/height 1–256). */
export const MAX_MAP_DIM = 256;

/** Cells added per edge. All non-negative; all zero = no-op. */
export interface ResizeEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Minimal cell shape the resize transforms read/write. Real cells
 *  are MapEditor's TileType — the index signature carries every other
 *  field through untouched. */
export interface ResizeCell {
  id: string;
  walkable?: boolean;
  link?: { map_id: string; x: number; y: number } | null;
  pressure_plate?: {
    map_id: string;
    col: number;
    row: number;
    tile_id: string;
  } | null;
  [k: string]: unknown;
}

export interface ResizeMapRecord {
  id: string;
  width: number;
  height: number;
  grid: ResizeCell[][];
  [k: string]: unknown;
}

/** Fields a fill tile must NOT carry into freshly-created cells.
 *  When the dominant tile is resolved from a painted cell (no palette
 *  entry with that id), the cell may have per-cell customizations —
 *  an NPC standing on it, a link, on-step text. Stamping those into
 *  hundreds of new cells would duplicate gameplay content, so the
 *  fill template is scrubbed down to pure terrain. */
const FILL_SCRUB_FIELDS = [
  "link",
  "pressure_plate",
  "npc",
  "item",
  "encounter",
  "spawn",
  "counter",
  "quest",
  "dungeon",
  "trap_id",
  "text",
] as const;

/** Deep-ish copy of a cell suitable for use as a fill template: the
 *  nested link/pressure_plate objects are the only non-scalar fields,
 *  and both get scrubbed anyway. Reference-type leftovers (flags)
 *  are cloned via JSON so painting one new cell never aliases
 *  another. */
export function sanitizeFillCell(cell: ResizeCell): ResizeCell {
  const copy = JSON.parse(JSON.stringify(cell)) as ResizeCell;
  for (const f of FILL_SCRUB_FIELDS) {
    if (f === "text") {
      // `text` is a required TileType field — blank it rather than
      // deleting so the cell shape matches palette-fresh cells.
      if (typeof copy.text === "string") copy.text = "";
      continue;
    }
    delete copy[f];
  }
  return copy;
}

/** Most common WALKABLE cell id in the grid — the map's "ground".
 *  Falls back to the most common id overall (a map that is all wall
 *  still resolves something), then null for an empty grid. Ties break
 *  toward the id encountered first in row-major order, which keeps
 *  the choice stable across calls. */
export function dominantGroundTileId(
  grid: ReadonlyArray<ReadonlyArray<ResizeCell>>,
): string | null {
  const walkable = new Map<string, number>();
  const all = new Map<string, number>();
  for (const row of grid) {
    for (const cell of row) {
      all.set(cell.id, (all.get(cell.id) ?? 0) + 1);
      if (cell.walkable) {
        walkable.set(cell.id, (walkable.get(cell.id) ?? 0) + 1);
      }
    }
  }
  const pick = (m: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of m) {
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    return best;
  };
  return pick(walkable) ?? pick(all);
}

/** Validate a proposed resize. Returns an error string, or null when
 *  the edges are applicable to the given dimensions. */
export function resizeValidationError(
  width: number,
  height: number,
  edges: ResizeEdges,
): string | null {
  const vals = [edges.top, edges.right, edges.bottom, edges.left];
  if (vals.some((v) => !Number.isInteger(v) || v < 0)) {
    return "Edge values must be whole numbers ≥ 0.";
  }
  const newW = width + edges.left + edges.right;
  const newH = height + edges.top + edges.bottom;
  if (newW === width && newH === height) {
    return "Add at least one row or column.";
  }
  if (newW > MAX_MAP_DIM || newH > MAX_MAP_DIM) {
    return `Maps are capped at ${MAX_MAP_DIM}×${MAX_MAP_DIM} (requested ${newW}×${newH}).`;
  }
  return null;
}

/** Grow `map` by `edges`, filling new cells with copies of
 *  `fillCell`. Returns a NEW record (fresh grid, updated
 *  width/height); the input is untouched. Existing cells are carried
 *  by reference — the editor deep-copies on persist, and the grid
 *  array itself is new, so in-place paint semantics are preserved.
 *
 *  NOTE: this only moves the grid. When `edges.left/top > 0`, run
 *  {@link shiftRefsIntoMap} over the full maps list (including the
 *  record this returns) and {@link shiftPartyStart} over party.json
 *  afterwards, or every stored coordinate into this map dangles. */
export function resizeMapRecord(
  map: ResizeMapRecord,
  edges: ResizeEdges,
  fillCell: ResizeCell,
): ResizeMapRecord {
  const err = resizeValidationError(map.width, map.height, edges);
  if (err) throw new Error(err);
  const newW = map.width + edges.left + edges.right;
  const newH = map.height + edges.top + edges.bottom;
  const fresh = (): ResizeCell =>
    JSON.parse(JSON.stringify(fillCell)) as ResizeCell;
  const grid: ResizeCell[][] = [];
  for (let r = 0; r < newH; r++) {
    const row: ResizeCell[] = [];
    const srcR = r - edges.top;
    for (let c = 0; c < newW; c++) {
      const srcC = c - edges.left;
      const src =
        srcR >= 0 && srcR < map.height && srcC >= 0 && srcC < map.width
          ? map.grid[srcR]?.[srcC]
          : undefined;
      row.push(src ?? fresh());
    }
    grid.push(row);
  }
  return { ...map, width: newW, height: newH, grid };
}

/** Shift every stored coordinate that points INTO `targetMapId` by
 *  (+dCol, +dRow) — links and pressure plates on every map in `maps`,
 *  including the resized map itself (self-references are legal).
 *  Returns a new list; maps with no matching refs are passed through
 *  by reference so the caller can cheaply detect what changed via
 *  identity. Second element is the number of refs updated. */
export function shiftRefsIntoMap(
  maps: ReadonlyArray<ResizeMapRecord>,
  targetMapId: string,
  dCol: number,
  dRow: number,
): [ResizeMapRecord[], number] {
  if (dCol === 0 && dRow === 0) return [[...maps], 0];
  let total = 0;
  const out = maps.map((m) => {
    let mapChanged = false;
    const grid = m.grid.map((row) =>
      row.map((cell) => {
        let next = cell;
        if (cell.link && cell.link.map_id === targetMapId) {
          next = {
            ...next,
            link: {
              ...cell.link,
              x: cell.link.x + dCol,
              y: cell.link.y + dRow,
            },
          };
        }
        if (
          cell.pressure_plate &&
          cell.pressure_plate.map_id === targetMapId
        ) {
          next = {
            ...next,
            pressure_plate: {
              ...cell.pressure_plate,
              col: cell.pressure_plate.col + dCol,
              row: cell.pressure_plate.row + dRow,
            },
          };
        }
        if (next !== cell) {
          mapChanged = true;
          total++;
        }
        return next;
      }),
    );
    return mapChanged ? { ...m, grid } : m;
  });
  return [out, total];
}

/** party.json shape the shift reads — everything else rides the
 *  index signature. */
export interface PartyFileLike {
  start_position?: { map_id: string; col: number; row: number };
  [k: string]: unknown;
}

/** Shift the party's start position when it sits on the resized map.
 *  Returns the (new) file and whether anything changed; the input is
 *  untouched. */
export function shiftPartyStart(
  party: PartyFileLike,
  targetMapId: string,
  dCol: number,
  dRow: number,
): [PartyFileLike, boolean] {
  const sp = party.start_position;
  if (
    (dCol === 0 && dRow === 0) ||
    !sp ||
    sp.map_id !== targetMapId ||
    typeof sp.col !== "number" ||
    typeof sp.row !== "number"
  ) {
    return [party, false];
  }
  return [
    {
      ...party,
      start_position: { ...sp, col: sp.col + dCol, row: sp.row + dRow },
    },
    true,
  ];
}
