/**
 * Inventory stacking helpers used by the play-time stash + per-character
 * inventories.
 *
 * Convention:
 *   - `entry.charges` on an inventory entry is the QUANTITY of items in
 *     that stack (e.g. `{ item: "torch", charges: 7 }` = 7 torches).
 *     A missing `charges` field is treated as quantity = 1 (legacy
 *     `{ item: "torch" }` entries pre-stacking).
 *   - The items.json catalog also has a `charges` field — that one
 *     means the per-USE effect (e.g. a Torch burns for 150 steps when
 *     lit). The two values live in different places and never get
 *     confused: catalog.charges is read at use-time; entry.charges is
 *     read at display-time and mutated on add/consume.
 *   - Whether a given item id stacks at all is gated on the catalog's
 *     `stackable: true` flag (set in items.json — Torch, Arrows,
 *     Lockpicks, Potions, etc.). Non-stackable items (weapons, armor,
 *     unique magic items) stay as one-entry-per-copy and the helpers
 *     fall back to simple push/splice on those.
 *
 * The helpers RETURN a new array — callers reassign or commit the
 * value into a save. They don't mutate the input array, mirroring how
 * PlayPartyScreenOverlay's existing handlers (handleUseStashItem,
 * handleSendStashItem) build a `nextInv` copy before committing.
 */

/** Inventory entry shape used by the save + every UI consumer.
 *
 *  `durability` is a per-instance wear counter for non-stackable gear
 *  (weapons, armor). Stackable rows ignore it. When an equipped item is
 *  unequipped or displaced, its current durability rides back onto the
 *  inventory entry so wear travels with the object across equip /
 *  unequip / send-to-character / return-to-stash. */
export interface InventoryEntry {
  item: string;
  charges?: number;
  durability?: number;
}

/** Minimum catalog shape the helpers consult — kept loose so callers
 *  can pass a PartyItemRef, an Item from battle/world/Items, or a
 *  hand-built lookup map's value. */
export interface StackableItemRef {
  id: string;
  stackable?: boolean;
  /** Catalog charges — semantic is "per-use effect" (e.g. burn
   *  duration). Helpers DO NOT read this — they're just plumbing. */
  charges?: number;
}

/** True when the item catalog flags the id as stackable. Unknown ids
 *  default to NOT stackable — safer than the other direction (one
 *  rogue catalog typo can't silently merge two unrelated weapons). */
export function isStackable(
  itemId: string,
  items: ReadonlyArray<StackableItemRef> | ReadonlyMap<string, StackableItemRef>,
): boolean {
  let def: StackableItemRef | undefined;
  if (items instanceof Map) {
    def = items.get(itemId);
  } else {
    def = (items as ReadonlyArray<StackableItemRef>).find(
      (i) => i.id === itemId,
    );
  }
  return !!def?.stackable;
}

/** Quantity of an inventory entry. Reads `entry.charges` for
 *  stackable items (falls back to 1 when absent so legacy entries
 *  without a charges field still render as a single item). For
 *  non-stackable items the helper always returns 1 — `charges` on a
 *  non-stackable entry historically meant per-instance durability,
 *  not quantity, and we don't want to surface that as "Sword (12)"
 *  in the inventory list. */
export function quantityOf(
  entry: InventoryEntry,
  items: ReadonlyArray<StackableItemRef> | ReadonlyMap<string, StackableItemRef>,
): number {
  if (!isStackable(entry.item, items)) return 1;
  const q = entry.charges ?? 1;
  return q > 0 ? q : 0;
}

/** How many physical units one "bundle" grant of `itemId` adds to an
 *  inventory. Stackable items pay out the catalog's `charges` count
 *  (Arrows / Bolts / Stones bundle of 20, Lockpicks bundle of 5, …);
 *  non-stackable items always add 1, because the catalog `charges`
 *  field on those is per-instance durability, not a bundle quantity.
 *  Unknown ids and non-positive / absent charge counts fall back to 1.
 *
 *  Single source of truth for the bundle rule the General Store
 *  purchase flow, the Gnome Tinker craft, and the Ranger arrow/bolt
 *  craft all share — so a "20 Arrows" payout looks identical no matter
 *  which surface produced it. */
export function bundleSizeFor(
  itemId: string,
  items:
    | ReadonlyArray<StackableItemRef>
    | ReadonlyMap<string, StackableItemRef>,
): number {
  if (!isStackable(itemId, items)) return 1;
  let def: StackableItemRef | undefined;
  if (items instanceof Map) {
    def = items.get(itemId);
  } else {
    def = (items as ReadonlyArray<StackableItemRef>).find(
      (i) => i.id === itemId,
    );
  }
  const c = def?.charges;
  return typeof c === "number" && c > 0 ? c : 1;
}

/** Append `count` of `itemId` to an inventory. For stackable items,
 *  merges into the first existing entry with the same id. For
 *  non-stackable, appends a fresh entry (one row per copy — old
 *  behavior preserved). Returns a NEW array; caller assigns / commits.
 *  `count` defaults to 1; callers that purchase a bundle (e.g. a
 *  quiver of 20 arrows) pass the bundle size explicitly.
 *
 *  `durability` is an optional per-instance wear value that rides
 *  along when a non-stackable item lands in inventory (typically used
 *  by the equip/unequip path to preserve wear). Ignored for stackable
 *  items, and ignored when `count > 1` for non-stackables (those are
 *  bundle additions of fresh gear). */
export function addToInventory(
  inv: ReadonlyArray<InventoryEntry>,
  itemId: string,
  items: ReadonlyArray<StackableItemRef> | ReadonlyMap<string, StackableItemRef>,
  count = 1,
  durability?: number,
): InventoryEntry[] {
  if (count <= 0) return inv.map((e) => ({ ...e }));
  if (!isStackable(itemId, items)) {
    // Non-stackable: one entry per copy. The historical shape was
    // `{ item }` with no charges field; preserve that so callers that
    // walked the inventory looking for stackable rows don't trip.
    // When the caller threads a durability value (single-copy add,
    // typical of the unequip / displace path), stamp it on the new
    // row so wear travels with the item.
    const next = inv.map((e) => ({ ...e }));
    for (let i = 0; i < count; i++) {
      const fresh: InventoryEntry = { item: itemId };
      if (count === 1 && typeof durability === "number") {
        fresh.durability = durability;
      }
      next.push(fresh);
    }
    return next;
  }
  const next = inv.map((e) => ({ ...e }));
  const existingIdx = next.findIndex((e) => e.item === itemId);
  if (existingIdx >= 0) {
    const existing = next[existingIdx];
    next[existingIdx] = {
      ...existing,
      charges: (existing.charges ?? 1) + count,
    };
    return next;
  }
  next.push({ item: itemId, charges: count });
  return next;
}

/** Remove one unit from the entry at `stashIndex`. For stackable
 *  entries the row's `charges` decrements by 1; when the count
 *  reaches zero the row gets spliced out. For non-stackable entries
 *  the row is spliced unconditionally (one copy → gone). Returns a
 *  NEW array. Returns the input unchanged when stashIndex is out of
 *  range. */
export function consumeOneFromInventory(
  inv: ReadonlyArray<InventoryEntry>,
  stashIndex: number,
  items: ReadonlyArray<StackableItemRef> | ReadonlyMap<string, StackableItemRef>,
): InventoryEntry[] {
  if (stashIndex < 0 || stashIndex >= inv.length) {
    return inv.map((e) => ({ ...e }));
  }
  const entry = inv[stashIndex];
  if (!isStackable(entry.item, items)) {
    return inv.filter((_, i) => i !== stashIndex).map((e) => ({ ...e }));
  }
  const next = inv.map((e) => ({ ...e }));
  const cur = next[stashIndex];
  const after = (cur.charges ?? 1) - 1;
  if (after <= 0) {
    return next.filter((_, i) => i !== stashIndex);
  }
  next[stashIndex] = { ...cur, charges: after };
  return next;
}

/** Remove up to `count` copies of `itemId` from an inventory by id.
 *  Stack-aware: stackable rows have their `charges` decremented (the
 *  row is spliced when it hits zero); non-stackable items splice one
 *  row per copy. Best-effort — when the inventory holds fewer than
 *  `count`, every copy it does hold is removed and the shortfall is
 *  silently ignored (callers that need a hard "must have N" check
 *  should validate with {@link quantityOf} first). Returns a NEW
 *  array; never mutates the input. `count` defaults to 1.
 *
 *  This is the inverse of {@link addToInventory} and the shared home
 *  for "consume by id" — the quest step "Return Item" reward and any
 *  other id-keyed removal route through it so the stacking rules stay
 *  in one place. */
export function removeFromInventory(
  inv: ReadonlyArray<InventoryEntry>,
  itemId: string,
  items: ReadonlyArray<StackableItemRef> | ReadonlyMap<string, StackableItemRef>,
  count = 1,
): InventoryEntry[] {
  if (count <= 0) return inv.map((e) => ({ ...e }));
  let next: InventoryEntry[] = inv.map((e) => ({ ...e }));
  let remaining = count;
  if (isStackable(itemId, items)) {
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const row = next[i];
      if (row.item !== itemId) continue;
      const have = row.charges ?? 1;
      const take = Math.min(have, remaining);
      remaining -= take;
      const left = have - take;
      if (left <= 0) {
        next.splice(i, 1);
        i -= 1;
      } else {
        next[i] = { ...row, charges: left };
      }
    }
  } else {
    next = next.filter((row) => {
      if (remaining > 0 && row.item === itemId) {
        remaining -= 1;
        return false;
      }
      return true;
    });
  }
  return next;
}
