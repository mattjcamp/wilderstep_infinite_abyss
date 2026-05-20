/**
 * buildArenaCells — snapshot a window of a source grid into the
 * 18×16 arena matrix CombatScene consumes.
 *
 * Status: NOT WIRED into the play flow today. The play side
 * intentionally omits `arenaCells` from PlayCombatHost, which lets
 * the combat scene fall back to its generic green-field arena. This
 * helper is held in reserve for when the encounter record gains an
 * `arenaId` field (or similar) and the host can pick a dedicated
 * authored arena map per encounter.
 *
 * Why the cropping logic exists. The combat scene renders a 18×16
 * grid (ARENA_COLS × ARENA_ROWS) and, when given an `arenaCells`
 * matrix, paints those cells with their actual map sprites + honours
 * per-cell `walkable` and `obstructs` flags during movement and
 * line-of-sight. Without the matrix the scene falls back to a
 * generic green field. When an authored arena map lands, the host
 * will pass that map's full grid here and crop a window around the
 * trigger cell so the fight reads as taking place in the right
 * environment.
 *
 * Cropping rules:
 *
 *   - The window is sized exactly to the arena (18×16). When the
 *     world map is smaller, the matrix's edges fill with `null` so
 *     the scene's default fill paints those cells.
 *   - Centering biases toward the encounter cell. The cell that
 *     triggered combat lands as close to the arena center as the
 *     edges of the world map allow — combat doesn't require the
 *     trigger cell to be at any particular position, but visually
 *     anchoring the action where the player was makes the transition
 *     feel less arbitrary.
 *   - Out-of-bounds world coords map to `null` rather than synthetic
 *     "open ground" cells. The scene already treats `null` as "use
 *     default fill", which matches what we want.
 *
 * The matrix only carries fields the scene reads: sprite, walkable,
 * obstructs, lightSource, lightRange. Everything else on the world
 * cell (npc, counter, encounter, dungeon, link, locked) is dropped —
 * combat doesn't trigger those interactions.
 */

import { withBase } from "@/battle/world/Module";
import { ARENA_COLS, ARENA_ROWS } from "@/battle/combat/Arena";
import type { ArenaCellInfo } from "@/battle/world/Maps";

/** Structural subset of a world cell — matches both the editor's
 *  `TileType` and the play side's `PlayCell` shape. We don't import
 *  either to avoid coupling; the renderer only reads these fields. */
interface WorldCell {
  sprite?: string;
  walkable?: boolean;
  obstructs?: boolean;
  light_source?: boolean;
  light_range?: number;
  /** Per-cell particle animation key — "torch", "fire", "fairy",
   *  "smoke", or "none". CombatScene renders the matching
   *  ANIMATION_CONFIGS emitter centred on the cell. Carried through
   *  verbatim so the same `light_source` torch tiles authored on the
   *  map keep their flame animation when the arena uses that map. */
  animation?: string | null;
}

type WorldGrid = ReadonlyArray<ReadonlyArray<WorldCell | null | undefined>>;

/** Build an `ArenaCellInfo` from one world cell. Sprite is base-
 *  prefixed + routed under `/sprites/` so the Phaser loader pulls
 *  the right file. Missing flags get sensible defaults — open
 *  ground, no obstruction, no light. */
export function toArenaCell(cell: WorldCell): ArenaCellInfo {
  const rawSprite = cell.sprite;
  const sprite =
    typeof rawSprite === "string" && rawSprite.length > 0
      ? withBase(`/sprites/${rawSprite}`)
      : null;
  return {
    sprite,
    walkable: cell.walkable !== false,
    obstructs: cell.obstructs === true,
    lightSource: cell.light_source ? true : undefined,
    lightRange:
      typeof cell.light_range === "number" ? cell.light_range : undefined,
    animation:
      typeof cell.animation === "string" && cell.animation.length > 0
        ? cell.animation
        : undefined,
  };
}

/**
 * Build an 18×16 matrix from a custom arena map — meant for spawn /
 * encounter `custom_map` resolution where the map IS the arena (not
 * a window into the overworld).
 *
 * Placement: the source map's `(0, 0)` cell lands at arena `(1, 1)`
 * — inside the perimeter wall ring that CombatScene paints
 * unconditionally for every `isWall(col, row)` cell. Without that
 * offset, the map's leftmost column + topmost row would be hidden
 * behind the wall.
 *
 * Effective canvas: the source map paints into the **interior**
 * 16×14 region (arena cols 1..16, rows 1..14). Source cells past
 * that bound silently truncate; smaller-than-16×14 maps null-pad
 * (which the scene's default fill picks up).
 */
export function buildCustomArenaCells(
  grid: WorldGrid,
): (ArenaCellInfo | null)[][] {
  const matrix: (ArenaCellInfo | null)[][] = [];
  for (let r = 0; r < ARENA_ROWS; r++) {
    const row: (ArenaCellInfo | null)[] = [];
    const srcRow = r - 1;
    const sourceRow = srcRow >= 0 ? grid[srcRow] : undefined;
    for (let c = 0; c < ARENA_COLS; c++) {
      const srcCol = c - 1;
      const cell = sourceRow?.[srcCol];
      if (!cell || srcCol < 0) {
        row.push(null);
        continue;
      }
      row.push(toArenaCell(cell));
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Build an 18×16 (rows × cols) `(ArenaCellInfo | null)[][]` matrix
 * cropped from `grid` and centered on `(triggerCol, triggerRow)`.
 *
 * The window is positioned so the trigger cell lands as close to the
 * arena center as possible without indexing past the world map's
 * edges. World-coord cells beyond the map's bounds map to `null`,
 * letting the scene's default fill paint those positions — useful
 * when the player triggers combat near a corner.
 */
export function buildArenaCells(
  grid: WorldGrid,
  triggerCol: number,
  triggerRow: number,
): (ArenaCellInfo | null)[][] {
  const worldHeight = grid.length;
  const worldWidth = grid[0]?.length ?? 0;

  // Center the arena on the trigger cell, then clamp so the window
  // doesn't run past the map's left/top edge. Right/bottom clipping
  // is handled implicitly by the null-fill loop below.
  const centerCol = Math.floor(ARENA_COLS / 2);
  const centerRow = Math.floor(ARENA_ROWS / 2);
  let originCol = triggerCol - centerCol;
  let originRow = triggerRow - centerRow;
  // Bias back toward the world map if the window would start
  // negative — a fight near (1, 0) shouldn't show 8 columns of empty
  // off-grid space before the player's tiles begin.
  if (originCol < 0) originCol = 0;
  if (originRow < 0) originRow = 0;
  // Pull the window inward on the right/bottom edges too — a fight
  // near (worldW-1, worldH-1) should anchor against the map's edge
  // rather than show empty space to the right of the action.
  if (originCol + ARENA_COLS > worldWidth) {
    originCol = Math.max(0, worldWidth - ARENA_COLS);
  }
  if (originRow + ARENA_ROWS > worldHeight) {
    originRow = Math.max(0, worldHeight - ARENA_ROWS);
  }

  const matrix: (ArenaCellInfo | null)[][] = [];
  for (let r = 0; r < ARENA_ROWS; r++) {
    const row: (ArenaCellInfo | null)[] = [];
    const worldRow = originRow + r;
    const sourceRow = grid[worldRow];
    for (let c = 0; c < ARENA_COLS; c++) {
      const worldCol = originCol + c;
      const cell = sourceRow?.[worldCol];
      if (!cell) {
        row.push(null);
        continue;
      }
      row.push(toArenaCell(cell));
    }
    matrix.push(row);
  }
  return matrix;
}
