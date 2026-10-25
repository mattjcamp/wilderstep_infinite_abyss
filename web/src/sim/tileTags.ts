/**
 * Water is a tile BEHAVIOUR (boats sail on it, NPCs won't wander onto
 * it), carried by the `water: true` field on palette tiles and map
 * cells. Tags are free-form editor groupings only.
 *
 * Older data marked water through the tag instead (`tag: "water"`, or a
 * nested tag ending in ": water"), so that is still honoured.
 */
export function isWaterTag(tag: string | null | undefined): boolean {
  if (!tag) return false;
  const segs = tag.split(":");
  return segs[segs.length - 1].trim().toLowerCase() === "water";
}

/** True when a tile / cell behaves as water. */
export function isWaterCell(
  cell: { water?: unknown; tag?: string | null } | null | undefined,
): boolean {
  if (!cell) return false;
  return cell.water === true || isWaterTag(cell.tag);
}
