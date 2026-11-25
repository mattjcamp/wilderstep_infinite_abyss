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
 *     you look at across the room. Floor only to the NORTH → the same
 *     face (the top and bottom face art was identical, so there is one
 *     face piece).
 *   - Floor to the EAST only → `dungeon_wall_left` (thin strip on the
 *     cell's left edge, the room's floor showing to its right).
 *     Floor to the WEST only → `dungeon_wall_right`. Floor on both
 *     sides → `dungeon_wall_divider`. Strips get the floor as their
 *     `background_sprite` so the transparent part reads as room.
 *   - Only a DIAGONAL floor (a room's outer corner) → face.
 *   - Never two faces stacked: a wall directly above a face is the
 *     wall's top surface, re-pieced from its sides — divider / strip
 *     where floor is beside it, otherwise solid rock.
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
 * A palette may leave out the junction pieces (divider, corners, tees);
 * those cells then use the closest piece it has — a side strip for a
 * divider, the plain face for a corner or tee (see PIECE_FALLBACK).
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

type Piece =
  | "faceTop" | "left" | "right" | "divider"
  | "cornerTl" | "cornerTr" | "tDown" | "tUp" | "rock";

/** Tilesets the autotiler can paint with (palette-id prefixes). */
export type WallTileset = "dungeon" | "cave" | "deep_ones_hall" | "manor" | "volcanic";

/** Palette ids for one tileset's wall pieces. The tilesets share piece
 *  names under their own prefix (`dungeon_wall_top` / `cave_wall_top`,
 *  …), so one set of rules autotiles all of them. The one exception is
 *  the Deep Ones Hall face: its plain brick is `deep_ones_hall_wall`
 *  (its `wall_top` is a carved glyph panel, used as decoration). */
export function tilesetWallIds(prefix: WallTileset): Record<Piece, string> {
  return {
    faceTop: prefix === "deep_ones_hall" ? "deep_ones_hall_wall" : `${prefix}_wall_top`,
    left: `${prefix}_wall_left`,
    right: `${prefix}_wall_right`,
    divider: `${prefix}_wall_divider`,
    cornerTl: `${prefix}_wall_corner_tl`,
    cornerTr: `${prefix}_wall_corner_tr`,
    tDown: `${prefix}_wall_t_down`,
    tUp: `${prefix}_wall_t_up`,
    rock: `${prefix}_pit_centre`,
  };
}

/** Palette ids the autotiler paints with for the Dungeon Tileset. */
export const DUNGEON_TILESET_WALL_IDS = tilesetWallIds("dungeon");
/** …and for the Cave Tileset. */
export const CAVE_TILESET_WALL_IDS = tilesetWallIds("cave");
/** …and for the Deep Ones Hall tileset. */
export const DEEP_ONES_HALL_WALL_IDS = tilesetWallIds("deep_ones_hall");

const PIECE_LABELS: Record<Piece, string> = {
  faceTop: "Wall, Top",
  left: "Wall, Left",
  right: "Wall, Right",
  divider: "Wall, Divider",
  cornerTl: "Wall, Corner Top Left",
  cornerTr: "Wall, Corner Top Right",
  tDown: "Wall, T (down)",
  tUp: "Wall, T (up)",
  rock: "Solid Rock",
};

const TILESET_NAMES: Record<WallTileset, string> = {
  dungeon: "Dungeon",
  cave: "Cave",
  deep_ones_hall: "Deep Ones Hall",
  manor: "Manor",
  volcanic: "Volcanic Tubes",
};

const STRIPS: ReadonlySet<Piece> = new Set(["left", "right", "divider"]);

/** What to paint when a tileset's palette doesn't carry a piece (the
 *  module trimmed it): the closest piece it does have. A divider (floor
 *  both sides) becomes a side strip; corners and tees become the plain
 *  face. Followed until a piece the palette has (or nothing to try). */
const PIECE_FALLBACK: Partial<Record<Piece, Piece>> = {
  divider: "left",
  cornerTl: "faceTop",
  cornerTr: "faceTop",
  tDown: "faceTop",
  tUp: "faceTop",
};
const FACES: ReadonlySet<Piece> = new Set(["faceTop"]);

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
    /** Which tileset's pieces to paint with. Default: Dungeon. */
    tileset?: WallTileset;
  },
): void {
  const ids = tilesetWallIds(opts.tileset ?? "dungeon");
  const label = (p: Piece) =>
    p === "rock" ? PIECE_LABELS.rock
      : `${TILESET_NAMES[opts.tileset ?? "dungeon"]} ${PIECE_LABELS[p]}`;
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
        : n ? "faceTop"
        : e && w ? "divider"
        : e ? "left"
        : w ? "right"
        : diag ? "faceTop"
        : "rock";
    }
  }

  // Pass 1b — never stack two brick faces. In the 3/4 view a wall
  // only shows its face once; a wall directly above another face is
  // that wall's top surface (two rooms separated by a two-thick wall,
  // or a thick wall ending beside open floor). Re-piece it from its
  // side neighbours instead: floor on both sides → divider, on one
  // side → that side's strip, none → solid rock. Bottom-up so each
  // decision sees the final piece below it.
  for (let r = h - 2; r >= 0; r--) {
    for (let c = 0; c < grid[r].length; c++) {
      if (piece[r][c] !== "faceTop" || piece[r + 1]?.[c] !== "faceTop") continue;
      const e = open(r, c + 1), w = open(r, c - 1);
      piece[r][c] = e && w ? "divider" : e ? "left" : w ? "right" : "rock";
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

  // Substitute pieces the palette doesn't have (see PIECE_FALLBACK).
  // Without a sprite map (tests, headless) every piece counts as present.
  const has = (p: Piece) => !opts.sprites || opts.sprites.has(ids[p]);
  const available = (p: Piece): Piece => {
    let q = p;
    for (let i = 0; i < 4 && !has(q); i++) {
      const next = PIECE_FALLBACK[q];
      if (!next) break;
      q = next;
    }
    return q;
  };

  // Paint.
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const raw = piece[r][c];
      if (!raw) continue;
      const p = available(raw);
      const cell = grid[r][c];
      const paletteId = ids[p];
      const sprite = opts.sprites?.get(paletteId);
      if (sprite) cell.sprite = sprite;
      if (!opts.keepId?.(cell)) {
        cell.id = paletteId;
        cell.name = label(p);
      }
      // Strips sit on the room's floor; faces / corners / tees get the
      // solid-rock black behind their transparent mortar so the gaps
      // read as deep shadow regardless of the renderer's backdrop.
      const rockSprite = opts.sprites?.get(ids.rock);
      if (STRIPS.has(p) && opts.floorSprite) cell.background_sprite = opts.floorSprite;
      else if (p !== "rock" && rockSprite) cell.background_sprite = rockSprite;
      else delete cell.background_sprite;
    }
  }
}
