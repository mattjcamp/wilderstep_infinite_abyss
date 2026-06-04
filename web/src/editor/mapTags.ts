/**
 * Shared tag-tree ordering + grouping for map lists across the editor
 * (MapsBrowse's tag tree, the Map Editor cell inspector's Link map
 * picker, …). One comparator so every surface presents tags in the
 * same order.
 */

export const UNTAGGED = "(untagged)";

/** Tags pinned to the top of any tag-grouped map list, in this exact
 *  order. These are the organizational backbone of a module's map set
 *  (the broad "what kind of place is this" buckets); everything else
 *  sorts alphabetically after them, with "(untagged)" always last. */
export const PINNED_TAGS = ["overview", "town", "buildings", "outside"];

/** Tag ordering: pinned tags first (in PINNED_TAGS order), then the
 *  rest alphabetically, then "(untagged)". */
export function compareTags(a: string, b: string): number {
  if (a === UNTAGGED) return 1;
  if (b === UNTAGGED) return -1;
  const pa = PINNED_TAGS.indexOf(a);
  const pb = PINNED_TAGS.indexOf(b);
  if (pa !== -1 || pb !== -1) {
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  }
  return a.localeCompare(b);
}

/**
 * Group records by tag for a tag-tree or grouped picker. A record
 * carrying several tags appears under each of them (so a shared map —
 * a town and its interiors, say — is findable under every tag it
 * carries); untagged records land in the "(untagged)" bucket. Groups
 * come back in compareTags order; members within a group sort by
 * display name.
 */
export function groupByTags<T extends { tags?: string[]; name?: string; id: string }>(
  records: ReadonlyArray<T>,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const r of records) {
    const tags =
      Array.isArray(r.tags) && r.tags.length > 0 ? r.tags : [UNTAGGED];
    for (const tag of tags) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(r);
    }
  }
  const keys = [...groups.keys()].sort(compareTags);
  return keys.map((k) => [
    k,
    groups
      .get(k)!
      .slice()
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
  ]);
}
