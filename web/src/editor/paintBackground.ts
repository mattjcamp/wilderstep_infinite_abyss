/**
 * Map editor: what a freshly painted cell should use as its
 * `background_sprite`.
 *
 * Painting a tile over an existing one carries the replaced tile down
 * as the new cell's background, so placing a chair, a column or a rug
 * on a floor keeps that floor showing through the transparent parts of
 * the new tile, instead of the palette entry's generic default.
 *
 * Rules, in order:
 *  - Nothing there (or the replaced cell has no sprite) → the brush's
 *    own palette background.
 *  - Same sprite as the brush (dragging back over a cell you just
 *    painted, repainting a tile in place) → keep whatever background
 *    the cell already has, falling back to the brush's.
 *  - The brush tile is fully opaque (a floor, a solid wall face) → the
 *    background could never show, so don't record one: just the
 *    brush's palette background.
 *  - The replaced tile is itself see-through and has a background of
 *    its own (e.g. swapping one rug edge piece for another, or a wall
 *    strip standing on parquet) → reuse that background. A cell has
 *    only one background layer, so carrying the see-through tile down
 *    would leave its transparent parts showing the void.
 *  - Otherwise → the replaced tile's sprite.
 */
export interface PaintCellLike {
  sprite?: string;
  background_sprite?: string;
}

/** `true` = fully opaque, `false` = has transparent pixels,
 *  `undefined` = not known yet (texture still loading). */
export type OpacityLookup = (sprite: string) => boolean | undefined;

export function inheritedBackground(
  existing: PaintCellLike | null | undefined,
  brush: PaintCellLike,
  isOpaque: OpacityLookup,
): string | undefined {
  const own = brush.background_sprite || undefined;
  const under = existing?.sprite;
  if (!existing || !under) return own;
  if (under === brush.sprite) return existing.background_sprite || own;
  if (brush.sprite && isOpaque(brush.sprite) === true) return own;
  if (isOpaque(under) === false && existing.background_sprite) {
    return existing.background_sprite;
  }
  return under;
}
