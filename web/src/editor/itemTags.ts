/**
 * Shared grouping for item pickers across the editor (the character
 * sheet's equip-slot pickers, the map cell inspector's Item picker,
 * the dungeon chest picker, the quest step editor, …). One helper so
 * every item dropdown presents the same Category optgroups in the
 * same order, with members sorted by display name.
 *
 * Mirrors the role mapTags.ts plays for map lists — the items just
 * group on their `category` field instead of free-form tags.
 *
 * Note: items also carry a finer-grained `item_type` (sword, bow, …).
 * We intentionally group by category only for now; `item_type` is
 * kept on the item shape so a second grouping level can be re-added
 * later without re-threading the data.
 */

/** Group label used when an item carries no `category`. */
export const UNCATEGORIZED = "(uncategorized)";

/** Minimal shape the grouper needs. Any catalog item satisfies it. */
export interface GroupableItem {
  id: string;
  name?: string;
  /** Primary bucket — "weapons", "armors", "general", … */
  category?: string;
  /** Finer-grained discriminator — "sword", "bow", "potion", …
   *  Reserved; not currently used for grouping. */
  item_type?: string;
}

/** A single optgroup: a display label and its sorted members. */
export interface ItemGroup<T> {
  label: string;
  items: T[];
}

/** "general" → "General", "quest_items" → "Quest Items". */
function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The optgroup label for a category: the title-cased category, or
 *  UNCATEGORIZED when the item has no category. */
export function itemGroupLabel(category?: string): string {
  return category && category.trim()
    ? titleCase(category.trim())
    : UNCATEGORIZED;
}

/** Missing keys sort after present ones, so the "(uncategorized)"
 *  bucket lands at the bottom. */
function cmpKey(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return a.localeCompare(b);
}

/**
 * Bucket items into Category optgroups. Groups come back ordered by
 * category (alphabetically, with missing category last); members
 * within a group sort by display name.
 */
export function groupItemsByCategory<T extends GroupableItem>(
  items: ReadonlyArray<T>,
): Array<ItemGroup<T>> {
  const groups = new Map<string, { catKey: string; items: T[] }>();
  for (const it of items) {
    const catKey = it.category && it.category.trim() ? it.category.trim() : "";
    const label = itemGroupLabel(catKey || undefined);
    let g = groups.get(label);
    if (!g) {
      g = { catKey, items: [] };
      groups.set(label, g);
    }
    g.items.push(it);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => cmpKey(a.catKey, b.catKey))
    .map(([label, g]) => ({
      label,
      items: g.items
        .slice()
        .sort((x, y) => (x.name ?? x.id).localeCompare(y.name ?? y.id)),
    }));
}
