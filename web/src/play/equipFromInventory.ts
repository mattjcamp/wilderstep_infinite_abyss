/**
 * Equip / unequip gear straight from the party's shared inventory.
 *
 * Items live in exactly two places now: `party.inventory` (shared) or
 * a member's `equipped` slots. This module is the single, pure place
 * that moves gear between them so the Party screen's Inventory picker
 * can't drift from what gets saved:
 *
 *   - source "stash" + target member  → equip from the inventory;
 *     whatever that member had in the slot bounces back to it
 *   - source "equipped" + target null → unequip into the inventory
 *   - source "equipped" + other member → hand the gear across (one
 *     update, so a refused equip never strands the item)
 *
 * Per-instance durability travels with the object in every
 * direction: inventory entry `durability` ⇄ member
 * `equipped_durability[slot]`.
 */
import { classAllowsItemType } from "@/battle/world/Classes";

import {
  addToInventory,
  consumeOneFromInventory,
  type InventoryEntry,
  type StackableItemRef,
} from "./inventoryStacking";
import type { SavedCharacterState } from "./saveTypes";

export type EquipSource =
  | { kind: "stash"; stashIndex: number }
  | { kind: "equipped"; memberId: string; slot: string };

export interface EquipItemDef extends StackableItemRef {
  name?: string;
  slots?: string[] | null;
  item_type?: string;
}

export interface EquipContext {
  items: ReadonlyArray<EquipItemDef>;
  /** Starting loadout for a member whose save has no `equipped` map
   *  yet (legacy / fresh saves fall back to characters.json). */
  catalogEquipped: (memberId: string) => Record<string, string> | undefined;
  /** The class's `allowable_item_types` (empty / undefined = any). */
  allowableItemTypes: (memberId: string) => ReadonlyArray<string> | undefined;
  displayName: (memberId: string) => string;
}

export interface PartyGearState {
  inventory: ReadonlyArray<InventoryEntry>;
  members: ReadonlyArray<SavedCharacterState>;
}

/** Result: the new state, an error message to show the player, or
 *  null when there was nothing to do. */
export type EquipResult = PartyGearState | { error: string } | null;

const TRACKED_SLOTS = new Set(["hands", "body"]);

function equippedOf(
  st: PartyGearState,
  memberId: string,
  ctx: EquipContext,
): Record<string, string> {
  const saved = st.members.find((m) => m.id === memberId);
  return { ...(saved?.equipped ?? ctx.catalogEquipped(memberId) ?? {}) };
}

function slotDurability(m: SavedCharacterState, slot: string): number | undefined {
  const ed = m.equipped_durability ?? {};
  const v = slot === "hands" ? ed.hands : slot === "body" ? ed.body : undefined;
  return typeof v === "number" ? v : undefined;
}

function withDurability(
  m: SavedCharacterState,
  slot: string,
  value: number | null,
): NonNullable<SavedCharacterState["equipped_durability"]> {
  const ed = {
    hands: m.equipped_durability?.hands ?? null,
    body: m.equipped_durability?.body ?? null,
  };
  if (slot === "hands" || slot === "body") ed[slot] = value;
  return ed;
}

function replaceMember(
  st: PartyGearState,
  next: SavedCharacterState,
  inventory: ReadonlyArray<InventoryEntry>,
): PartyGearState {
  return {
    inventory,
    members: st.members.map((m) => (m.id === next.id ? next : m)),
  };
}

/** Unequip `slot` on `memberId` into the shared inventory. */
export function unequipToInventory(
  st: PartyGearState,
  memberId: string,
  slot: string,
  ctx: EquipContext,
): PartyGearState | null {
  const member = st.members.find((m) => m.id === memberId);
  if (!member) return null;
  const eq = equippedOf(st, memberId, ctx);
  const itemId = eq[slot];
  if (!itemId) return null;
  const inventory = addToInventory(
    st.inventory,
    itemId,
    ctx.items,
    1,
    slotDurability(member, slot),
  );
  delete eq[slot];
  return replaceMember(
    st,
    {
      ...member,
      equipped: eq,
      equipped_durability: withDurability(member, slot, null),
    },
    inventory,
  );
}

/** Equip inventory row `stashIndex` onto `memberId`. */
export function equipFromInventory(
  st: PartyGearState,
  stashIndex: number,
  memberId: string,
  ctx: EquipContext,
): EquipResult {
  const member = st.members.find((m) => m.id === memberId);
  if (!member || stashIndex < 0 || stashIndex >= st.inventory.length) {
    return null;
  }
  const entry = st.inventory[stashIndex];
  const def = ctx.items.find((it) => it.id === entry.item);
  const slot = (def?.slots ?? []).find((x) => TRACKED_SLOTS.has(x));
  if (!slot) return null;
  if (!classAllowsItemType(ctx.allowableItemTypes(memberId), def?.item_type)) {
    return {
      error: `${ctx.displayName(memberId)} can't equip ${
        def?.name ?? entry.item
      } — their class isn't trained for it.`,
    };
  }
  const eq = equippedOf(st, memberId, ctx);
  const displaced = eq[slot];
  let inventory = consumeOneFromInventory(st.inventory, stashIndex, ctx.items);
  if (displaced) {
    inventory = addToInventory(
      inventory,
      displaced,
      ctx.items,
      1,
      slotDurability(member, slot),
    );
  }
  eq[slot] = entry.item;
  return replaceMember(
    st,
    {
      ...member,
      equipped: eq,
      equipped_durability: withDurability(
        member,
        slot,
        typeof entry.durability === "number" ? entry.durability : null,
      ),
    },
    inventory,
  );
}

/** Dispatch one picker choice. `targetMemberId` null = unequip. */
export function applyEquipChoice(
  st: PartyGearState,
  source: EquipSource,
  targetMemberId: string | null,
  ctx: EquipContext,
): EquipResult {
  if (source.kind === "stash") {
    if (!targetMemberId) return null;
    return equipFromInventory(st, source.stashIndex, targetMemberId, ctx);
  }
  if (targetMemberId === source.memberId) return null;
  const itemId = equippedOf(st, source.memberId, ctx)[source.slot];
  const off = unequipToInventory(st, source.memberId, source.slot, ctx);
  if (!off) return null;
  if (!targetMemberId) return off;
  // The item just landed at the end of the inventory (non-stackable
  // gear always appends) — equip that row on the new wearer.
  let idx = -1;
  off.inventory.forEach((e, i) => {
    if (e.item === itemId) idx = i;
  });
  return equipFromInventory(off, idx, targetMemberId, ctx);
}
