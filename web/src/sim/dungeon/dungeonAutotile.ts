/**
 * Wall autotiling for the `"dungeon"` style — the new Dungeon Tileset.
 *
 * The procedural generator carves rooms out of solid wall, so every
 * wall cell starts as the same generic block. The Dungeon Tileset is
 * drawn in 3/4 view and needs each wall to pick its piece from its
 * neighbours, following the same conventions as the hand-built
 * dungeon maps:
 *
 *   - Floor to the SOUTH → brick face (`dungeon_wall_top`): the wall
 *     you look at across the room. Floor only to the NORTH → face too
 *     (`dungeon_wall_bottom`).
 *   - Floor to the EAST only → `dungeon_wall_left` (thin strip on the
 *     cell's left edge, the room's floor showing to its right).
 *     Floor to the WEST only → `dungeon_wall_right`. Floor on both
 *     sides → `dungeon_wall_divider`. Strips get the floor as their
 *     `background_sprite` so the transparent part reads as room.
 *   - Only a DIAGONAL floor (a room's outer corner) → face.
 *   - No floor around at all → solid rock (`dungeon_pit_centre`, a
 *     flat near-black), the classic roguelike void. Faces, corners
 *     and tees also get that black as their `background_sprite`, so
 *     the gaps in their mortar read as shadow.
 *
 * Second pass — junctions: a face sitting on top of a strip becomes
 * the matching corner / tee (`wall_left` below → `corner_tl`,
 * `wall_right` → `corner_tr`, `divider` → `t_down`); a face with a
 * divider above becomes `t_up`.
 *
 * Only cells the converter marks as walls are touched; their
 * walkable / obstructs / light / animation fields are preserved (a
 * wall torch stays a lit, animated wall — it just gets the right
 * piece of wall art).
 */

/** Minimal cell surface the autotiler reads / writes. */
export interface AutotileCell {
  id: string;
  name: string;
  sprite: string;
  walkable: boolean;
  background_sprite?: string;
}

/** Palette ids the autotiler paints with. */
export const DUNGEON_TILESET_WALL_IDS = {
  faceTop: "dungeon_wall_top",
  faceBottom: "dungeon_wall_bottom",
  left: "dungeon_wall_left",
  right: "dungeon_wall_right",
  divider: "dungeon_wall_divider",
  cornerTl: "dungeon_wall_corner_tl",
  cornerTr: "dungeon_wall_corner_tr",
  tDown: "dungeon_wall_t_down",
  tUp: "dungeon_wall_t_up",
  rock: "dungeon_pit_centre",
} as const;

type Piece = keyof typeof DUNGEON_TILESET_WALL_IDS;

const NAMES: Record<Piece, string> = {
  faceTop: "Dungeon Wall, Top",
  faceBottom: "Dungeon Wall, Bottom",
  left: "Dungeon Wall, Left",
  right: "Dungeon Wall, Right",
  divider: "Dungeon Wall, Divider",
  cornerTl: "Dungeon Wall, Corner Top Left",
  cornerTr: "Dungeon Wall, Corner Top Right",
  tDown: "Dungeon Wall, T (down)",
  tUp: "Dungeon Wall, T (up)",
  rock: "Solid Rock",
};

const STRIPS: ReadonlySet<Piece> = new Set(["left", "right", "divider"]);
const FACES: ReadonlySet<Piece> = new Set(["faceTop", "faceBottom"]);

/** Pick the wall piece for every cell where `isWall(cell)` holds.
 *  `isOpen(cell)` = the party can be there (floor, door, stairs…).
 *  Mutates the grid in place. `sprites` maps palette id → sprite. */
export function autotileDungeonWalls<C extends AutotileCell>(
  grid: C[][],
  opts: {
    isWall: (cell: C) => boolean;
    sprites: ReadonlyMap<string, string> | undefined;
    /** Floor sprite drawn under the thin strip walls. */
    floorSprite: string;
    /** Keep the cell's own id (e.g. "wall_torch") instead of the
     *  piece's palette id. */
    keepId?: (cell: C) => boolean;
  },
): void {
  const h = grid.length;
  const at = (r: number, c: number): C | undefined => grid[r]?.[c];
  const open = (r: number, c: number): boolean => {
    const cell = at(r, c);
    return !!cell && !opts.isWall(cell);
  };

  // Pass 1 — classify by which neighbours are open.
  const piece: (Piece | null)[][] = grid.map((row) => row.map(() => null));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!opts.isWall(grid[r][c])) continue;
      const n = open(r - 1, c), s = open(r + 1, c), e = open(r, c + 1), w = open(r, c - 1);
      const diag =
        open(r - 1, c - 1) || open(r - 1, c + 1) || open(r + 1, c - 1) || open(r + 1, c + 1);
      piece[r][c] =
        s ? "faceTop"
        : n ? "faceBottom"
        : e && w ? "divider"
        : e ? "left"
        : w ? "right"
        : diag ? "faceTop"
        : "rock";
    }
  }

  // Pass 2 — faces meeting strips become corners / tees.
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const p = piece[r][c];
      if (!p || !FACES.has(p)) continue;
      const below = piece[r + 1]?.[c] ?? null;
      const above = piece[r - 1]?.[c] ?? null;
      if (below === "left") piece[r][c] = "cornerTl";
      else if (below === "right") piece[r][c] = "cornerTr";
      else if (below === "divider") piece[r][c] = "tDown";
      else if (above === "divider") piece[r][c] = "tUp";
    }
  }

  // Paint.
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const p = piece[r][c];
      if (!p) continue;
      const cell = grid[r][c];
      const paletteId = DUNGEON_TILESET_WALL_IDS[p];
      const sprite = opts.sprites?.get(paletteId);
      if (sprite) cell.sprite = sprite;
      if (!opts.keepId?.(cell)) {
        cell.id = paletteId;
        cell.name = NAMES[p];
      }
      // Strips sit on the room's floor; faces / corners / tees get the
      // solid-rock black behind their transparent mortar so the gaps
      // read as deep shadow regardless of the renderer's backdrop.
      const rockSprite = opts.sprites?.get(DUNGEON_TILESET_WALL_IDS.rock);
      if (STRIPS.has(p) && opts.floorSprite) cell.background_sprite = opts.floorSprite;
      else if (p !== "rock" && rockSprite) cell.background_sprite = rockSprite;
      else delete cell.background_sprite;
    }
  }
}
