/**
 * Party-wide item reclamation — the "Return Item" quest-step feature.
 *
 * A quest step can list ids in its `rewards.return_items`; when the step
 * completes the host reclaims one copy of each from the party. The naive
 * first cut only touched the shared stash (`party.inventory`), so an item
 * sitting in a character's PERSONAL inventory — or worn in an equipped
 * slot — slipped through and was never returned. This module fixes that
 * by searching every place an item can live.
 *
 * **Search order (per listed id, one copy reclaimed):**
 *   1. the shared stash (`party.inventory`),
 *   2. each member's personal `inventory`, in roster order,
 *   3. each member's `equipped` slots, in roster order — last resort, so
 *      a spare in a pack is taken before the one the hero is wielding.
 *
 * Reclaiming an equipped item clears the slot and its
 * `equipped_durability` entry, mirroring an unequip-then-consume.
 *
 * Everything here is pure + save-shaped (operates on {@link SavedPartyState},
 * returns a fresh copy, never mutates the input) so it round-trips through
 * JSON and is trivially testable. The live in-combat path (kill credits,
 * where the kernel's party is the source of truth until the post-fight
 * sync) reuses the same search order via {@link removeItemsFromLiveParty}.
 */

import {
  quantityOf,
  removeFromInventory,
  type InventoryEntry,
  type StackableItemRef,
} from "./inventoryStacking";
import type { SavedCharacterState, SavedPartyState } from "./saveTypes";

type Catalog =
  | ReadonlyArray<StackableItemRef>
  | ReadonlyMap<string, StackableItemRef>;

/** Total quantity of `id` held across an inventory list (sums stack
 *  charges; counts 1 per non-stackable row). */
function availableInList(
  list: ReadonlyArray<InventoryEntry>,
  id: string,
  items: Catalog,
): number {
  let n = 0;
  for (const e of list) if (e.item === id) n += quantityOf(e, items);
  return n;
}

/** Pure, save-shaped reclamation. Removes one copy of each id in `ids`
 *  from the party — shared stash first, then personal inventories, then
 *  equipped slots (see module doc for the why). Best-effort: an id the
 *  party no longer holds anywhere is silently skipped (the step still
 *  completes). Returns a NEW {@link SavedPartyState}; the input is never
 *  mutated. When nothing matched, the original object is returned
 *  unchanged so callers can cheaply detect a no-op by identity. */
export function removeItemsFromSavedParty(
  party: SavedPartyState,
  ids: ReadonlyArray<string>,
  items: Catalog,
): SavedPartyState {
  if (ids.length === 0) return party;

  let stash: InventoryEntry[] = party.inventory.map((e) => ({ ...e }));
  const members: SavedCharacterState[] = party.members.map((m) => ({
    ...m,
    inventory: m.inventory.map((e) => ({ ...e })),
    equipped: m.equipped ? { ...m.equipped } : m.equipped,
    equipped_durability: m.equipped_durability
      ? { ...m.equipped_durability }
      : m.equipped_durability,
  }));
  let changed = false;

  for (const id of ids) {
    let remaining = 1;

    // 1. Shared stash.
    if (remaining > 0) {
      const avail = availableInList(stash, id, items);
      const take = Math.min(avail, remaining);
      if (take > 0) {
        stash = removeFromInventory(stash, id, items, take);
        remaining -= take;
        changed = true;
      }
    }

    // 2. Personal inventories, in roster order.
    for (const m of members) {
      if (remaining <= 0) break;
      const inv = m.inventory as InventoryEntry[];
      const avail = availableInList(inv, id, items);
      const take = Math.min(avail, remaining);
      if (take > 0) {
        m.inventory = removeFromInventory(inv, id, items, take);
        remaining -= take;
        changed = true;
      }
    }

    // 3. Equipped slots, in roster order — last resort.
    for (const m of members) {
      if (remaining <= 0) break;
      const equipped = m.equipped;
      if (!equipped) continue;
      for (const slot of Object.keys(equipped)) {
        if (remaining <= 0) break;
        if (equipped[slot] !== id) continue;
        delete equipped[slot];
        if (m.equipped_durability) {
          delete (m.equipped_durability as Record<string, unknown>)[slot];
        }
        remaining -= 1;
        changed = true;
      }
    }
  }

  if (!changed) return party;
  return { ...party, inventory: stash, members };
}

/** The two equipment slots the runtime party tracks (mirrors the battle
 *  layer's `EquippedSlot`). Kept inline so this module stays free of
 *  battle-layer imports. */
const LIVE_SLOTS = ["hands", "body"] as const;
type LiveSlot = (typeof LIVE_SLOTS)[number];

/** Minimal structural view of the live (kernel) party the in-combat
 *  reclaim path mutates. Kept structural rather than importing the full
 *  battle `Party` type so this module stays free of battle-layer deps —
 *  the caller (PlayHost) passes `gameState.partyData`, which satisfies
 *  this shape. */
export interface LivePartyLike {
  inventory: InventoryEntry[];
  roster: Array<{
    inventory: InventoryEntry[];
    equipped: Record<LiveSlot, string | null>;
    equipped_durability: Record<LiveSlot, number | null>;
  }>;
}

/** In-place reclamation against the live kernel party, used by the
 *  kill-credit path during combat (where the kernel party is the source
 *  of truth until `applyCombatResultToSave` syncs it back). Same search
 *  order as {@link removeItemsFromSavedParty}; mutates the passed
 *  arrays / objects in place because the kernel holds the references and
 *  the post-fight sync re-reads them. */
export function removeItemsFromLiveParty(
  party: LivePartyLike,
  ids: ReadonlyArray<string>,
  items: Catalog,
): void {
  if (ids.length === 0) return;

  const commit = (target: InventoryEntry[], next: InventoryEntry[]) => {
    target.length = 0;
    for (const e of next) target.push(e);
  };

  for (const id of ids) {
    let remaining = 1;

    if (remaining > 0) {
      const avail = availableInList(party.inventory, id, items);
      const take = Math.min(avail, remaining);
      if (take > 0) {
        commit(
          party.inventory,
          removeFromInventory(party.inventory, id, items, take),
        );
        remaining -= take;
      }
    }

    for (const m of party.roster) {
      if (remaining <= 0) break;
      const avail = availableInList(m.inventory, id, items);
      const take = Math.min(avail, remaining);
      if (take > 0) {
        commit(m.inventory, removeFromInventory(m.inventory, id, items, take));
        remaining -= take;
      }
    }

    for (const m of party.roster) {
      if (remaining <= 0) break;
      for (const slot of LIVE_SLOTS) {
        if (remaining <= 0) break;
        if (m.equipped[slot] !== id) continue;
        m.equipped[slot] = null;
        m.equipped_durability[slot] = null;
        remaining -= 1;
      }
    }
  }
}
