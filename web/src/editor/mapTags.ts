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

/** Shape the bulk-delete planner needs from a map record. */
interface DeletableMap {
  id: string;
  name?: string;
  tags?: string[];
  grid?: ReadonlyArray<ReadonlyArray<{ link?: { map_id?: string } | null } | null>>;
}

/** Result of {@link planTagDelete}. */
export interface TagDeletePlan<T> {
  /** Maps in this module's OWN file carrying the tag — these get
   *  removed. */
  toDelete: T[];
  /** Maps carrying the tag that come from a parent module (inherited
   *  via `extends`). They can't be removed from here — the merge
   *  would bring them straight back — so they're reported, not
   *  deleted. */
  inherited: T[];
  /** The module's own maps list after the delete. */
  remainingOwn: T[];
  /** Surviving maps (own or inherited) with at least one cell whose
   *  `link.map_id` points at a deleted map, with the link count. */
  brokenLinks: Array<{ id: string; name: string; count: number }>;
}

/**
 * Plan a "delete every map under this tag" operation. `tag` may be
 * {@link UNTAGGED} to target maps with no tags. A map is removed in
 * full even when it carries other tags too — callers should say so.
 *
 * `resolved` is the merged view (inherited + own); `own` is this
 * module's own maps list (what actually gets written back).
 */
export function planTagDelete<T extends DeletableMap>(
  tag: string,
  resolved: ReadonlyArray<T>,
  own: ReadonlyArray<T>,
): TagDeletePlan<T> {
  const hasTag = (m: T) => {
    const tags = Array.isArray(m.tags) ? m.tags : [];
    return tag === UNTAGGED ? tags.length === 0 : tags.includes(tag);
  };
  const ownIds = new Set(own.map((m) => m.id));
  const toDelete = own.filter(hasTag);
  const deleteIds = new Set(toDelete.map((m) => m.id));
  const inherited = resolved.filter((m) => hasTag(m) && !ownIds.has(m.id));
  const remainingOwn = own.filter((m) => !deleteIds.has(m.id));
  const brokenLinks: TagDeletePlan<T>["brokenLinks"] = [];
  for (const m of resolved) {
    if (deleteIds.has(m.id) || !Array.isArray(m.grid)) continue;
    let count = 0;
    for (const row of m.grid) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const target = cell?.link?.map_id;
        if (target && deleteIds.has(target)) count++;
      }
    }
    if (count > 0) brokenLinks.push({ id: m.id, name: m.name ?? m.id, count });
  }
  return { toDelete, inherited, remainingOwn, brokenLinks };
}
