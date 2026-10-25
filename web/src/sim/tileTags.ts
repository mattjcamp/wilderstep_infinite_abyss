/**
 * Tile tags are editor groupings that nest on ":" ("overview: water"
 * shows as Overview › Water in the Tile Palette). The engine reads one
 * tag meaning — water — from the LAST segment, so a tile can sit in any
 * group and still behave as water (boats sail on it, NPCs avoid it).
 */
export function isWaterTag(tag: string | null | undefined): boolean {
  if (!tag) return false;
  const segs = tag.split(":");
  return segs[segs.length - 1].trim().toLowerCase() === "water";
}
