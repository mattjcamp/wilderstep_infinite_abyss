/**
 * Shorter labels for a group of tiles in the Map Editor's Tile Palette.
 *
 * Tiles in one palette group usually share a long name prefix
 * ("Dungeon Wall, Corner Top Left", "Dungeon Wall, Divider", …), which
 * left no room for the part that tells them apart. This drops the
 * words every name in the group starts with; the editor shows the
 * shared prefix once, above the list.
 */
export function shortTileLabels(names: readonly string[]): {
  prefix: string;
  labels: string[];
} {
  if (names.length < 2) return { prefix: "", labels: [...names] };
  const words = names.map((n) => n.split(/(?<=\s)/)); // keep trailing spaces
  let k = 0;
  for (;;) {
    const w = words[0][k];
    if (w === undefined || !/\s$/.test(w)) break;
    if (!words.every((ws) => ws[k] === w && ws.length > k + 1)) break;
    k++;
  }
  if (k === 0) return { prefix: "", labels: [...names] };
  const prefix = words[0].slice(0, k).join("");
  return {
    prefix: prefix.trim().replace(/[,:;-]$/, ""),
    labels: names.map((n) => n.slice(prefix.length)),
  };
}
