/**
 * Multi-tile palette pieces (a building split into parts) are shown in
 * the Map Editor's Tile Palette as the assembled picture rather than a
 * list of near-identical names. Parts are recognised by their sprite
 * file name: `…_r<row>c<col>.png`, as written by the tile-set splitters.
 */

/** Minimal tile shape this helper needs. */
export interface PartTile {
  id: string;
  sprite?: string;
}

/** Row/col of a multi-tile part, read from its sprite file name
 *  (`…_r<row>c<col>.png`, as written by the tile-set splitters). */
const PART_RE = /_r(\d+)c(\d+)\.png$/;

/** When every tile in a group is a part of one multi-tile piece, the
 *  grid to show them in (null = show the ordinary list). */
export function multiTileLayout<T extends PartTile>(
  tiles: T[],
): { cols: number; cells: (T | null)[] } | null {
  if (tiles.length < 2) return null;
  const parts: Array<{ t: T; r: number; c: number }> = [];
  for (const t of tiles) {
    const m = PART_RE.exec(t.sprite || "");
    if (!m) return null;
    parts.push({ t, r: Number(m[1]), c: Number(m[2]) });
  }
  const rows = Math.max(...parts.map((p) => p.r)) + 1;
  const cols = Math.max(...parts.map((p) => p.c)) + 1;
  if (rows * cols > 24) return null;
  const cells: (T | null)[] = Array(rows * cols).fill(null);
  for (const p of parts) {
    if (cells[p.r * cols + p.c]) return null;   // two parts claim one spot
    cells[p.r * cols + p.c] = p.t;
  }
  return { cols, cells };
}
