/**
 * Map editor Eraser: what an erased cell becomes.
 *
 * An erased cell holds no tile at all — no sprite, no background, no
 * link / counter / encounter / NPC / item — so it renders as the map's
 * black backdrop in both the editor and the game (WorldRenderer skips
 * cells with an empty `sprite`). It's solid void: not walkable, and it
 * doesn't block light (there's nothing there to block it).
 *
 * The id `empty` has no Tile Palette entry on purpose; the cell is
 * plain data, like any painted cell.
 */
export const EMPTY_TILE_ID = "empty";

export interface EmptyCell {
  id: string;
  name: string;
  tag: string;
  sprite: string;
  walkable: boolean;
  obstructs: boolean;
  boat: boolean;
  locked: boolean;
  light_source: boolean;
  light_range: number;
  animation: string;
  counter: null;
  encounter: null;
  spawn: null;
}

export function emptyCell(): EmptyCell {
  return {
    id: EMPTY_TILE_ID,
    name: "Empty",
    tag: "",
    sprite: "",
    walkable: false,
    obstructs: false,
    boat: false,
    locked: false,
    light_source: false,
    light_range: 0,
    animation: "none",
    counter: null,
    encounter: null,
    spawn: null,
  };
}

/** True when erasing `cell` would change nothing (already empty and
 *  carrying no extra data) — lets a drag over erased cells skip work
 *  and keeps them out of the undo step. */
export function isErased(
  cell: Record<string, unknown> | null | undefined,
): boolean {
  if (!cell) return false;
  const blank = emptyCell() as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(cell), ...Object.keys(blank)]);
  for (const k of keys) {
    const a = cell[k];
    const b = blank[k];
    if (a === b) continue;
    // Absent / null / undefined optional fields all mean "nothing here".
    if ((a === undefined || a === null) && (b === undefined || b === null))
      continue;
    return false;
  }
  return true;
}
