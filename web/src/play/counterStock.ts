/**
 * Per-counter stock + durability-aware pricing helpers.
 *
 * The play shop overlay used to keep each counter's stock in a local
 * React `useState` initialised from `counter.items` on mount — meaning
 * every visit restocked the shop, and items the player sold vanished
 * the moment they walked away. The new model treats each counter as a
 * persistent inventory keyed by counter id on `WorldSave.counters`:
 *
 *   - First visit on a save with no `counters[id]` entry: the
 *     catalog's authored `items[]` becomes the seed and is stamped
 *     into the save. Counter rows arrive as `{ item }` with no
 *     per-instance state — buyers receive fresh gear at full
 *     durability.
 *   - Buys remove the matching row.
 *   - Sells push the sold inventory entry — including its current
 *     `durability` for non-stackable gear — back onto the counter.
 *     Re-buying the row revives the same worn-in instance.
 *   - Sell price scales linearly with current durability:
 *     `baseSell × (current / max)`. Catalog items without a
 *     `durability` (consumables, stackables) use the base price
 *     unchanged.
 *
 * Pure functions — the overlay handles React state + save commits.
 */

/** A single row in a counter's stock. Mirrors `InventoryEntry`. */
export interface CounterStockEntry {
  item: string;
  /** Per-bundle quantity for stackable items (Arrows = 20, etc).
   *  Mirrors the inventory entry semantic — for non-stackable gear
   *  this field is absent (one row = one copy). */
  charges?: number;
  /** Per-instance wear for non-stackable items. Absent means "fresh"
   *  (= catalog max). When the player sells a worn weapon, the
   *  entry's durability rides onto the counter row so re-buying
   *  yields the same wear state. */
  durability?: number;
}

/** Minimum item-catalog shape this module reads. */
export interface DurabilityItemRef {
  id: string;
  /** Catalog peak durability for non-stackable wear. Absent for
   *  items that don't wear (consumables, quest tokens). */
  durability?: number;
  /** Base sell price as authored. Helpers scale this by per-instance
   *  durability when applicable. */
  sell?: number | null;
}

/**
 * Resolve the effective stock for a counter on a given save. Returns
 * the saved array when present, otherwise expands the catalog's seed
 * list into one entry per id.
 *
 * Does NOT mutate the save — callers wanting to persist a buy / sell
 * pass the resolved array back through `setCounterStock`.
 */
export function getCounterStock(
  countersSlice:
    | Record<
        string,
        ReadonlyArray<{ item: string; charges?: number; durability?: number }>
      >
    | undefined,
  counterId: string,
  catalogSeed: ReadonlyArray<string> | undefined,
): CounterStockEntry[] {
  const persisted = countersSlice?.[counterId];
  if (persisted) return persisted.map((e) => ({ ...e }));
  return (catalogSeed ?? []).map((id) => ({ item: id }));
}

/**
 * Return a new `counters` slice with `counterId` overridden to
 * `nextStock`. Callers commit the result into the save. Preserves
 * unrelated counters' entries unchanged.
 */
export function setCounterStock(
  countersSlice:
    | Record<
        string,
        ReadonlyArray<{ item: string; charges?: number; durability?: number }>
      >
    | undefined,
  counterId: string,
  nextStock: ReadonlyArray<CounterStockEntry>,
): Record<
  string,
  ReadonlyArray<{ item: string; charges?: number; durability?: number }>
> {
  return {
    ...(countersSlice ?? {}),
    [counterId]: nextStock.map((e) => ({ ...e })),
  };
}

/**
 * Sell price for ONE inventory entry. Scales the catalog's `sell`
 * price by the entry's current durability over the item's catalog
 * peak when both are present. Items without a catalog `durability`
 * (consumables, quest tokens) — or entries without a stamped
 * per-instance `durability` (fresh, never-equipped gear) — return
 * the base sell price unchanged.
 *
 * Returns `0` for items without a sell price or `null` sell.
 * Otherwise the result is `Math.floor` of the scaled value so the
 * UI shows a whole-gold price; minimum payout is 1 gold for items
 * the shop will buy at all (otherwise selling a snapped sword would
 * round to free, which feels like a bug to players even though
 * mathematically the item is worthless).
 */
export function computeSellPrice(
  item: DurabilityItemRef | undefined,
  entry: { durability?: number } | null | undefined,
): number {
  if (!item) return 0;
  const base = typeof item.sell === "number" ? item.sell : 0;
  if (base <= 0) return 0;
  const max = item.durability;
  const cur = entry?.durability;
  // Either no peak (item doesn't wear) or no per-instance wear
  // stamp (fresh item) → full price.
  if (typeof max !== "number" || max <= 0) return base;
  if (typeof cur !== "number") return base;
  // Clamp to [0, max] in case the wear counter ever drifts above
  // peak (defensive — combat-side decrement shouldn't, but a future
  // buff that "overhealed" durability would).
  const clamped = Math.max(0, Math.min(max, cur));
  const ratio = clamped / max;
  const scaled = Math.floor(base * ratio);
  return scaled > 0 ? scaled : 1;
}
