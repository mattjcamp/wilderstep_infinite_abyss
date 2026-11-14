/**
 * Shared tag-tree ordering + grouping for map lists across the editor
 * (MapsBrowse's tag tree, the Map Editor cell inspector's Link map
 * picker, …). One comparator so every surface presents tags in the
 * same order.
 */

export const UNTAGGED = "(untagged)";

/** Tags nest on ":" — the same convention the Tile Palette uses. A map
 *  tagged "Hallowmere: House" files under Hallowmere › House. */
export const TAG_SEP = ":";

/** Default tag order used when a module's maps.json has no
 *  `tag_order`. These are the organizational backbone of a module's
 *  map set (the broad "what kind of place is this" buckets). Matched
 *  case-insensitively against top-level tag paths. */
export const PINNED_TAGS = ["overview", "town", "buildings", "outside"];

/** Split a tag into its trimmed, non-empty path segments. */
export function tagSegments(tag: string): string[] {
  return tag
    .split(TAG_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Canonical form of a tag path: segments joined with ": ". Lets
 *  "Hallowmere:House" and "Hallowmere : House" land in the same group. */
export function normalizeTag(tag: string): string {
  return tagSegments(tag).join(`${TAG_SEP} `);
}

/** Human label for a tag path: "Hallowmere: House" → "Hallowmere › House". */
export function tagLabel(tag: string): string {
  return tagSegments(tag).join(" › ") || tag;
}

/** True when `tag` is `path` itself or nested anywhere beneath it. */
export function tagIsUnder(tag: string, path: string): boolean {
  const t = normalizeTag(tag).toLowerCase();
  const p = normalizeTag(path).toLowerCase();
  return t === p || t.startsWith(`${p}${TAG_SEP} `);
}

/** Every path from the root down to `tag` ("a: b: c" → ["a", "a: b",
 *  "a: b: c"]). Used to expand ancestors when deep-linking. */
export function tagAncestors(tag: string): string[] {
  const segs = tagSegments(tag);
  return segs.map((_, i) => segs.slice(0, i + 1).join(`${TAG_SEP} `));
}

/** Position of `path` in a tag order list (case-insensitive), or -1. */
function orderIndex(order: ReadonlyArray<string>, path: string): number {
  const p = normalizeTag(path).toLowerCase();
  return order.findIndex((o) => normalizeTag(o).toLowerCase() === p);
}

/** Whether a tag path is pinned in `order`. */
export function isTagPinned(order: ReadonlyArray<string>, path: string): boolean {
  return orderIndex(order, path) !== -1;
}

/** Compare two SIBLING tag paths: pinned paths first (in `order`
 *  order), then the rest alphabetically, "(untagged)" always last. */
function compareSiblings(
  a: string,
  b: string,
  order: ReadonlyArray<string>,
): number {
  if (a === UNTAGGED) return b === UNTAGGED ? 0 : 1;
  if (b === UNTAGGED) return -1;
  const pa = orderIndex(order, a);
  const pb = orderIndex(order, b);
  if (pa !== -1 || pb !== -1) {
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  }
  const la = tagSegments(a).pop() ?? a;
  const lb = tagSegments(b).pop() ?? b;
  return la.localeCompare(lb);
}

/** Build a tag comparator for full (possibly nested) tag paths that
 *  orders them the way the tree renders: walk segment by segment,
 *  compare the first differing level as siblings, parents before
 *  their children. */
export function makeTagComparator(
  order: ReadonlyArray<string> = PINNED_TAGS,
): (a: string, b: string) => number {
  return (a, b) => {
    if (a === UNTAGGED || b === UNTAGGED) return compareSiblings(a, b, order);
    const sa = tagSegments(a);
    const sb = tagSegments(b);
    const n = Math.min(sa.length, sb.length);
    for (let i = 0; i < n; i++) {
      if (sa[i].toLowerCase() === sb[i].toLowerCase()) continue;
      return compareSiblings(
        sa.slice(0, i + 1).join(`${TAG_SEP} `),
        sb.slice(0, i + 1).join(`${TAG_SEP} `),
        order,
      );
    }
    return sa.length - sb.length;
  };
}

/** Tag ordering with the default order (PINNED_TAGS): pinned tags
 *  first, then the rest alphabetically, then "(untagged)". Nested
 *  paths sort as the tree renders them. */
export const compareTags = makeTagComparator(PINNED_TAGS);

/** The tag order a maps file declares (`tag_order`), or the default. */
export function effectiveTagOrder(file: unknown): string[] {
  const raw = (file as { tag_order?: unknown } | null)?.tag_order;
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  }
  return [...PINNED_TAGS];
}

/** Pin (append to the end of the order) or unpin a tag path. */
export function setTagPinned(
  order: ReadonlyArray<string>,
  path: string,
  pinned: boolean,
): string[] {
  const idx = orderIndex(order, path);
  if (pinned) return idx === -1 ? [...order, normalizeTag(path)] : [...order];
  return order.filter((_, i) => i !== idx);
}

/** Move a pinned tag one place up (-1) or down (+1) among its pinned
 *  SIBLINGS (same parent). Returns the order unchanged when it can't
 *  move. Only the two swapped entries change position, so pins under
 *  other parents keep their relative order. */
export function moveTagPin(
  order: ReadonlyArray<string>,
  path: string,
  dir: -1 | 1,
): string[] {
  const segs = tagSegments(path);
  const parent = segs.slice(0, -1).join(`${TAG_SEP} `).toLowerCase();
  const siblingIdx = order
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => {
      const s = tagSegments(o);
      return (
        s.length === segs.length &&
        s.slice(0, -1).join(`${TAG_SEP} `).toLowerCase() === parent
      );
    })
    .map(({ i }) => i);
  const self = orderIndex(order, path);
  const pos = siblingIdx.indexOf(self);
  const other = siblingIdx[pos + dir];
  if (pos === -1 || other === undefined) return [...order];
  const next = [...order];
  [next[self], next[other]] = [next[other], next[self]];
  return next;
}

/** A node in a nested tag tree. A node can hold both child nodes AND
 *  records that sit directly at its level. */
export interface TagNode<T> {
  /** This segment's label (e.g. "House"). */
  label: string;
  /** Full normalized path ("Hallowmere: House") — the stable key. */
  path: string;
  records: T[];
  children: TagNode<T>[];
}

/**
 * Build the nested tag tree. A record carrying several tags appears
 * under each of them; untagged records land in a trailing "(untagged)"
 * node. Siblings sort pinned-first per `order`, then alphabetically;
 * records within a node sort by display name.
 */
export function buildTagTree<T extends { tags?: string[]; name?: string; id: string }>(
  records: ReadonlyArray<T>,
  order: ReadonlyArray<string> = PINNED_TAGS,
): TagNode<T>[] {
  const root: TagNode<T> = { label: "", path: "", records: [], children: [] };
  const byPath = new Map<string, TagNode<T>>();
  for (const r of records) {
    const tags =
      Array.isArray(r.tags) && r.tags.some((t) => tagSegments(t).length > 0)
        ? r.tags
        : [UNTAGGED];
    const placed = new Set<string>();
    for (const tag of tags) {
      const segs = tag === UNTAGGED ? [UNTAGGED] : tagSegments(tag);
      if (segs.length === 0) continue;
      let parent = root;
      let path = "";
      for (const seg of segs) {
        path = path ? `${path}${TAG_SEP} ${seg}` : seg;
        const key = path.toLowerCase();
        let node = byPath.get(key);
        if (!node) {
          node = { label: seg, path, records: [], children: [] };
          byPath.set(key, node);
          parent.children.push(node);
        }
        parent = node;
      }
      const key = parent.path.toLowerCase();
      if (!placed.has(key)) {
        placed.add(key);
        parent.records.push(r);
      }
    }
  }
  const sort = (nodes: TagNode<T>[]): void => {
    nodes.sort((a, b) => compareSiblings(a.path, b.path, order));
    for (const n of nodes) {
      n.records.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
      sort(n.children);
    }
  };
  sort(root.children);
  return root.children;
}

/** Distinct records in a node's subtree (a record filed under two
 *  child tags of the same parent counts once). */
export function tagNodeRecords<T extends { id: string }>(node: TagNode<T>): T[] {
  const seen = new Map<string, T>();
  const walk = (n: TagNode<T>): void => {
    for (const r of n.records) if (!seen.has(r.id)) seen.set(r.id, r);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return [...seen.values()];
}

/** Every node path in a tag tree. */
export function collectTagPaths<T>(nodes: ReadonlyArray<TagNode<T>>): string[] {
  const out: string[] = [];
  const walk = (ns: ReadonlyArray<TagNode<T>>): void => {
    for (const n of ns) {
      out.push(n.path);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Group records by (full) tag for a flat grouped picker — e.g. an
 * <optgroup> per tag. A record carrying several tags appears under
 * each; untagged records land in "(untagged)". Groups come back in
 * tree order (see makeTagComparator); members sort by display name.
 * Keys are normalized tag paths — render them with {@link tagLabel}.
 */
export function groupByTags<T extends { tags?: string[]; name?: string; id: string }>(
  records: ReadonlyArray<T>,
  order: ReadonlyArray<string> = PINNED_TAGS,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const r of records) {
    const tags = Array.isArray(r.tags)
      ? r.tags.map(normalizeTag).filter(Boolean)
      : [];
    for (const tag of tags.length > 0 ? [...new Set(tags)] : [UNTAGGED]) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(r);
    }
  }
  const keys = [...groups.keys()].sort(makeTagComparator(order));
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
 * {@link UNTAGGED} to target maps with no tags. A nested path also
 * takes every map tagged beneath it ("Hallowmere" includes
 * "Hallowmere: House"). A map is removed in
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
    const tags = Array.isArray(m.tags) ? m.tags.filter((t) => tagSegments(t).length > 0) : [];
    return tag === UNTAGGED
      ? tags.length === 0
      : tags.some((t) => tagIsUnder(t, tag));
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

/**
 * Id for a copy of map `srcId` — `<base>_<n>`, where `<base>` is `srcId`
 * with any trailing `_copy` / `_<digits>` segments stripped and `n` is one
 * more than the highest number already used with that base (min 2).
 * Copying a copy therefore never grows the id, and numbers count up:
 *
 *   stone_house_1        → stone_house_2 (or _7 if _2…_6 exist)
 *   hut_7                → hut_8
 *   armory_1_copy_2_copy → armory_2 (legacy ids collapse too)
 *   otto_inn             → otto_inn_2
 *
 * `existing` is every id already in use (inherited + own).
 */
export function nextCopyId(srcId: string, existing: ReadonlySet<string>): string {
  let base = srcId;
  for (;;) {
    const stripped = base.replace(/_(?:copy|\d+)$/, "");
    if (stripped === base || stripped.length === 0) break;
    base = stripped;
  }
  let n = 2;
  const prefix = `${base}_`;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    if (/^\d+$/.test(rest)) n = Math.max(n, Number(rest) + 1);
  }
  while (existing.has(`${base}_${n}`)) n++; // defensive
  return `${base}_${n}`;
}
