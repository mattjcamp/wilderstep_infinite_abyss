/**
 * Pure logic for the Party screen's action handlers.
 *
 * Each helper takes the live Party state (mutates in place — that's
 * the simplest contract for a single-player save), and returns a
 * `{ ok, message }` pair so the scene can show a feedback line.
 *
 * Keeping these out of the scene class means we can unit-test them
 * without spinning up Phaser, and reuse them from anywhere a non-UI
 * caller wants the same effect (e.g., a future save/load layer).
 */

import type { Party, PartyMember, EquippedSlot, InventoryItem } from "./Party";
import type { Effect } from "./Effects";
import { canEquip } from "./Effects";
import type { Spell } from "./Spells";
import { castersFor } from "./Spells";
import type { Item } from "./Items";
import { classAllowsItemType } from "./Classes";
import { addToStash } from "./TownActions";

// ── Slot handling ──────────────────────────────────────────────────
// v2 collapsed equipment slots to {hands, body}. Item.slots may still
// include "head" for forward-compat (helmets), but PartyMember.equipped
// only carries hands+body, so we filter at the seam.

/**
 * Equip slots the PartyMember model carries today. Ships as `hands`
 * and `body`; helmet support will land alongside a Head slot when the
 * matching gameplay returns.
 */
export const SUPPORTED_EQUIP_SLOTS: readonly EquippedSlot[] = [
  "hands", "body",
];

/**
 * The slots an item can land in given the currently-supported set.
 * Filters the catalog's `slots` list to entries the player can
 * actually target. Returns `[]` for items whose only slots are
 * unsupported (head-only items, etc.) — equip helpers treat that as
 * "not equippable".
 */
export function equippableSlots(
  item: Item,
  supported: readonly EquippedSlot[] = SUPPORTED_EQUIP_SLOTS,
): EquippedSlot[] {
  if (!item.character_can_equip) return [];
  const out: EquippedSlot[] = [];
  for (const s of item.slots ?? []) {
    // `ItemSlot` is a superset of `EquippedSlot` ("head" only lives
    // on items today). Narrow by membership in the supported list.
    if (s === "hands" || s === "body") {
      if (supported.includes(s)) out.push(s);
    }
  }
  return out;
}

// Slot labels used in feedback/log lines.
const SLOT_LABEL: Record<EquippedSlot, string> = {
  hands: "hands",
  body:  "body armor",
};

/** Read the item id in a slot. */
function readSlot(member: PartyMember, slot: EquippedSlot): string | null {
  return member.equipped[slot];
}

/** Write the slot. */
function writeSlot(member: PartyMember, slot: EquippedSlot, value: string | null): void {
  member.equipped[slot] = value;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ── Party composition helpers ──────────────────────────────────────
// Used to gate the conditional ability rows (BREW / PICKPOCKET /
// TINKER) on the Party Inventory screen.

/** True iff at least one alive member belongs to the given class. */
export function hasClass(members: PartyMember[], klass: string): boolean {
  const k = klass.toLowerCase();
  return members.some((m) => m.hp > 0 && m.class.toLowerCase() === k);
}

/** True iff at least one alive member belongs to the given race. */
export function hasRace(members: PartyMember[], race: string): boolean {
  const r = race.toLowerCase();
  return members.some((m) => m.hp > 0 && m.race.toLowerCase() === r);
}

/** Find the first alive member matching a class (case-insensitive). */
export function findClass(
  members: PartyMember[], klass: string,
): PartyMember | null {
  const k = klass.toLowerCase();
  return members.find((m) => m.hp > 0 && m.class.toLowerCase() === k) ?? null;
}

/** Find the first alive member matching a race (case-insensitive). */
export function findRace(
  members: PartyMember[], race: string,
): PartyMember | null {
  const r = race.toLowerCase();
  return members.find((m) => m.hp > 0 && m.race.toLowerCase() === r) ?? null;
}

// ── Active-effect predicates / lighting boosts ─────────────────────

/** True when the party currently has the named effect equipped. */
export function partyHasEffect(party: Party, effectId: string): boolean {
  return party.party_effects.includes(effectId);
}

// ── Active-effects readout (HUD strip) ────────────────────────────
//
// Surfaces the player-facing list of currently-active effects for
// the bottom log strip. Combines three data sources:
//
//   1. Slotted `partyEffects` entries — Detect Traps, Infravision,
//      etc. Names + charge data come from the loaded effects.json;
//      we keep a tiny fallback table here so the readout still
//      works in scenes that haven't loaded the file.
//   2. The `torchSteps` counter — physical torches from the stash.
//      Not a partyEffects slot, but the player thinks of it as
//      "Torch is on" — surfacing it here keeps the mental model
//      consistent.
//   3. The `magicLightSteps` counter — the Light spell's conjured
//      orb. Deliberately tracked separate from `torchSteps`: a
//      torch is a consumable item, Light is a spell, and the
//      player wants to see both counts side-by-side rather than
//      a single "Torch 250" tally that confusingly stacks them.
//
// Lighting effects are sorted to the front so the player can find
// their light source without scanning. Charge counts ride along on
// effects that have them (Torch / Magic Light) so the reader knows
// how many steps of light remain.

export interface ActiveEffectReadout {
  /** Stable id — empty for the synthetic Torch / Magic Light entries. */
  id: string;
  /** Display name suitable for the HUD strip. */
  name: string;
  /** True for light sources — Torch, Magic Light, Infravision — so
   *  the renderer can flag them with a warm tint. */
  isLight: boolean;
  /** Remaining steps for time-limited effects. Undefined for
   *  permanent effects (Detect Traps, Infravision). */
  charges?: number;
}

/** Effect ids the game treats as a light source. Mirrors
 *  `partyLightRadius`/`partyLightTint` — the readout flags exactly
 *  the effects those helpers boost the lighting overlay for. */
const LIGHT_EFFECT_IDS: ReadonlySet<string> = new Set([
  "infravision",
  // Sun Sword's "warm golden light" aura — surfaces via the
  // item-granted lane (grants_effect on the equipped Sun Sword), not
  // a manual party-effect slot. Listing it here flags it as a light
  // source so `partyLightRadius` boosts the overlay and the HUD
  // readout sorts it with the other lights.
  "sun_sword_aura",
]);

/**
 * Recompute `party.item_granted_effect_ids` from the currently-equipped
 * gear of every alive active member. Mirrors the Python game's
 * `Party.get_item_granted_effects`:
 *
 *   - Walks each alive member's four equipment slots.
 *   - Pulls `grantsEffect` off the item def for each filled slot.
 *   - Dedupes across members so two characters wielding the same
 *     magic weapon don't double-stack the aura in the HUD.
 *
 * Call this after any equip / unequip / swap action, and once when
 * a scene mounts and binds party + items. The HUD readout in
 * `summariseActiveEffects` reads the cached list directly.
 */
export function refreshItemGrantedEffects(
  party: Party,
  items: Map<string, Item>,
): void {
  const seen = new Set<string>();
  const ids: string[] = [];
  // v2: every roster member is active.
  for (const m of party.roster) {
    if (m.hp <= 0) continue;
    for (const slot of ["hands", "body"] as const) {
      const itemId = m.equipped[slot];
      if (!itemId) continue;
      const def = items.get(itemId);
      const eid = def?.grants_effect;
      if (!eid || seen.has(eid)) continue;
      seen.add(eid);
      ids.push(eid);
    }
  }
  party.item_granted_effect_ids = ids;
}

/** Display-name fallback for the handful of partyEffects ids the
 *  game ships with. Matches `data/effects.json` so a scene that
 *  doesn't load effects.json still gets pretty names in the strip.
 *  When `effects` is supplied to `summariseActiveEffects`, the
 *  loaded def's name wins over the fallback. */
const FALLBACK_EFFECT_NAMES: Record<string, string> = {
  detect_traps: "Detect Traps",
  infravision: "Infravision",
  sun_sword_aura: "Sun Sword Aura",
};

/**
 * Build the ordered list of active effects to render in the bottom
 * log strip. Lighting effects come first (Torch, then Magic Light,
 * then Infravision); permanent non-light effects (Detect Traps)
 * come after. Effects with charge counters carry the remaining-step
 * value so the renderer can display "Torch 78".
 *
 * `effects` is optional — when provided, names come from the loaded
 * `effects.json`; otherwise the helper uses a built-in fallback
 * table. Missing party returns an empty list.
 */
export function summariseActiveEffects(
  party: Party | null | undefined,
  effects: readonly Effect[] = [],
): ActiveEffectReadout[] {
  if (!party) return [];
  const byId = new Map(effects.map((e) => [e.id, e] as const));
  const nameFor = (id: string): string =>
    byId.get(id)?.name ?? FALLBACK_EFFECT_NAMES[id] ?? id;

  const out: ActiveEffectReadout[] = [];

  // Torch counter — synthetic entry. Show whenever there are steps
  // remaining, even in lit scenes (the player wants to know their
  // light inventory before stepping into a dark area).
  if (party.torch_steps > 0) {
    out.push({
      id: "",
      name: "Torch",
      isLight: true,
      charges: party.torch_steps,
    });
  }
  // Light spell counter — separate from Torch so the player can see
  // a magical light source and a physical one running in parallel.
  if (party.magic_light_steps > 0) {
    out.push({
      id: "",
      name: "Magic Light",
      isLight: true,
      charges: party.magic_light_steps,
    });
  }

  // party_effects is a flat list in v2 — walk it in order. The
  // ordering is stable across saves because the player's toggle
  // order is preserved. None of today's effects carry their own
  // burn-down counter on the party (the Light spell + torch tally
  // their steps separately above); permanent effects like Detect
  // Traps and Infravision simply omit `charges`.
  for (const id of party.party_effects) {
    if (!id) continue;
    const isLight = LIGHT_EFFECT_IDS.has(id);
    out.push({ id, name: nameFor(id), isLight });
  }

  // Item-granted effects — Sun Sword Aura while the Sun Sword is
  // equipped, etc. Walked separately from `party_effects` so they
  // don't compete with manually-toggled effects; deduped against
  // anything already in the readout (so toggling an effect ON while
  // the same id is also item-granted doesn't double-render).
  const seenIds = new Set(out.map((o) => o.id).filter((id) => id !== ""));
  for (const id of party.item_granted_effect_ids ?? []) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({
      id,
      name: nameFor(id),
      isLight: LIGHT_EFFECT_IDS.has(id),
    });
  }

  // Sort: lights first, then alpha by name. Inside the lights group,
  // Torch (synthetic, id "") tends to come before lettered ids in
  // localeCompare, which matches the desired reading order.
  out.sort((a, b) => {
    if (a.isLight !== b.isLight) return a.isLight ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
}

/**
 * The party's effective light radius (in tiles) for the lighting
 * overlay. Infravision, the Light spell, and a lit torch each act
 * as a light source. Returns the larger of the boost and the
 * supplied default.
 *
 * All three sources share the SAME 8-tile boost. The earlier
 * pygame-style tiering (Infravision 8 / Torch + Light 4) made the
 * lesser sources feel almost useless once the player got used to
 * Infravision's reach, so the radii were levelled up to keep every
 * source equally worth carrying. The duration / consumable
 * difference (Torch and Light spell burn down with steps,
 * Infravision lasts as long as it stays equipped) is what now
 * differentiates them.
 */
const PARTY_LIGHT_BOOST = 8;
export function partyLightRadius(party: Party, defaultRadius: number): number {
  if (partyHasEffect(party, "infravision")) return Math.max(defaultRadius, PARTY_LIGHT_BOOST);
  // Light spell and physical torch share the boost — both are
  // illumination orbs. Either being active is enough; their counters
  // tick independently in the dark-scene move handlers.
  if (party.magic_light_steps > 0 || party.torch_steps > 0) {
    return Math.max(defaultRadius, PARTY_LIGHT_BOOST);
  }
  return defaultRadius;
}

/**
 * Post-processing tint for the party light. Infravision shifts the
 * visible area to red ("infrared"); the Light spell and a lit torch
 * tint the floor with a warm orange "candle pool" glow.
 *
 * Returns the colour and an alpha scaling factor — callers multiply
 * the scale by the per-cell brightness so the tint fades with the
 * party light's range. Returns null when no tinting effect is
 * equipped.
 */
export interface PartyTint {
  color: number;
  alphaScale: number;
}
export function partyLightTint(party: Party): PartyTint | null {
  // Infravision wins when it's equipped — its red tint reads as
  // "thermal vision" and would muddy any other source's color.
  if (partyHasEffect(party, "infravision")) {
    return { color: 0xc02020, alphaScale: 0.55 };
  }
  if (party.magic_light_steps > 0 || party.torch_steps > 0) {
    // Warm orange flicker — reads as a candle pool, not a magical
    // glow. Light spell and torch share the tint since both are "an
    // illumination orb"; the readout strip is what tells the player
    // which (or both) is burning.
    return { color: 0xff9a3c, alphaScale: 0.30 };
  }
  return null;
}

// ── Effects ────────────────────────────────────────────────────────

/**
 * Toggle an effect on for the party. v2 has no slot cap — the effect
 * is appended to `party.party_effects` and stays until removed.
 *
 * Fails if the party can't equip it (in v2, `canEquip` always
 * returns true — eligibility now lives on Ability records).
 */
export function assignEffectToParty(
  party: Party,
  effect: Effect,
  members: PartyMember[],
): ActionResult {
  if (!canEquip(effect)) {
    return {
      ok: false,
      message: `Cannot assign ${effect.name} — requirements not met.`,
    };
  }
  void members;
  // Already active? Treat as success no-op.
  if (party.party_effects.includes(effect.id)) {
    return { ok: true, message: `${effect.name} is already active.` };
  }
  party.party_effects.push(effect.id);
  return { ok: true, message: `${effect.name} active.` };
}

/**
 * Remove an effect from the party. No-op success when the effect
 * isn't currently active.
 */
export function removeEffectFromParty(
  party: Party,
  effect: Effect,
): ActionResult {
  const idx = party.party_effects.indexOf(effect.id);
  if (idx < 0) {
    return { ok: true, message: `${effect.name} was not active.` };
  }
  party.party_effects.splice(idx, 1);
  return { ok: true, message: `${effect.name} dispelled.` };
}

// ── Stash ↔ personal inventory ─────────────────────────────────────

/**
 * Move one item from the shared stash into a member's personal
 * inventory. The stash is indexed because items can repeat — by
 * index we always remove the right one without needing unique ids.
 */
export function giveStashItemTo(
  party: Party,
  stashIndex: number,
  memberIndex: number,
): ActionResult {
  if (stashIndex < 0 || stashIndex >= party.inventory.length) {
    return { ok: false, message: "Item not found in stash." };
  }
  // v2: roster IS the active list. Index straight in.
  const member = party.roster[memberIndex];
  if (!member) return { ok: false, message: "No party member in that slot." };
  const item = party.inventory[stashIndex];
  party.inventory.splice(stashIndex, 1);
  member.inventory.push(item);
  return { ok: true, message: `Gave ${item.item} to ${member.name}.` };
}

/**
 * Move an item from a member's personal inventory back into the
 * shared stash. Inverse of giveStashItemTo — handy for the future
 * "Return to Stash" action menu the Python game has.
 */
export function returnItemToStash(
  party: Party,
  memberIndex: number,
  itemIndex: number,
): ActionResult {
  const member = party.roster[memberIndex];
  if (!member) return { ok: false, message: "No party member in that slot." };
  if (itemIndex < 0 || itemIndex >= member.inventory.length) {
    return { ok: false, message: "Item not found." };
  }
  const item = member.inventory[itemIndex];
  member.inventory.splice(itemIndex, 1);
  party.inventory.push(item);
  return { ok: true, message: `${item.item} returned to stash.` };
}

// ── Durability ─────────────────────────────────────────────────────
//
// Mirrors the Python game's per-slot durability tracker
// (`equipped_durability`) plus the per-inventory-entry durability
// field. Items in items.json carry a `durability` value that's the
// MAX uses; `0` (or missing) means indestructible. When an item is
// equipped, the slot tracker holds the *current* value; when it's
// unequipped or swapped, that value rides along with the item back
// into the inventory entry so wear travels with the object.

/**
 * Look up an item's max durability from the catalog. Returns `null`
 * when the item is indestructible (no durability set, or 0) or when
 * the catalog doesn't recognise the item.
 */
export function getItemMaxDurability(
  itemName: string,
  items: Map<string, Item>,
): number | null {
  const def = items.get(itemName);
  if (!def) return null;
  const dur = def.durability ?? 0;
  return dur > 0 ? dur : null;
}

/** True if the catalog flags the item as indestructible. */
export function isIndestructible(
  itemName: string,
  items: Map<string, Item>,
): boolean {
  return getItemMaxDurability(itemName, items) == null;
}

/**
 * Outcome of decrementing the wear on a slot's equipped item.
 *   - `kind: "ok"` — durability ticked down; item is still usable.
 *   - `kind: "broke"` — durability hit zero; the slot has been cleared
 *     and the item is destroyed (no inventory return).
 *   - `kind: "indestructible"` — nothing to do.
 *   - `kind: "empty"` — slot is empty / item not in catalog.
 */
export type DurabilityResult =
  | { kind: "ok"; current: number; max: number }
  | { kind: "broke"; itemName: string }
  | { kind: "indestructible" }
  | { kind: "empty" };

/**
 * Decrement durability for the item in `slot` by one. Initialises the
 * tracker to max on first use (the Python game does the same lazy
 * seed). When durability reaches zero the slot is cleared and the
 * item is removed from play.
 */
export function useEquippedDurability(
  member: PartyMember,
  slot: EquippedSlot,
  items: Map<string, Item>,
): DurabilityResult {
  const itemName = readSlot(member, slot);
  if (!itemName) return { kind: "empty" };
  const max = getItemMaxDurability(itemName, items);
  if (max == null) return { kind: "indestructible" };
  let current = member.equipped_durability[slot];
  if (current == null) current = max;
  if (current > max) current = max;     // editor-changed-max guard
  current -= 1;
  if (current <= 0) {
    // Snap the slot — the item shatters out of existence.
    writeSlot(member, slot, null);
    member.equipped_durability[slot] = null;
    return { kind: "broke", itemName };
  }
  member.equipped_durability[slot] = current;
  return { kind: "ok", current, max };
}

/**
 * Read the current/max durability pair for an equipped slot. Returns
 * `null` for indestructible items, empty slots, or unknown items.
 * Used by the inspect/examine popup to render the progress bar.
 */
export function getSlotDurability(
  member: PartyMember,
  slot: EquippedSlot,
  items: Map<string, Item>,
): { current: number; max: number } | null {
  const itemName = readSlot(member, slot);
  if (!itemName) return null;
  const max = getItemMaxDurability(itemName, items);
  if (max == null) return null;
  let current = member.equipped_durability[slot];
  if (current == null) current = max;
  if (current > max) current = max;
  return { current, max };
}

/**
 * Move an inventory entry's wear into the slot tracker on equip.
 * Indestructible items get `null`; destructible items use the entry's
 * stored value (or seed to max when this is the first use).
 */
function seedSlotFromEntry(
  member: PartyMember,
  slot: EquippedSlot,
  itemName: string,
  itemDur: number | undefined,
  items: Map<string, Item>,
): void {
  const max = getItemMaxDurability(itemName, items);
  if (max == null) {
    member.equipped_durability[slot] = null;
    return;
  }
  if (typeof itemDur === "number") {
    member.equipped_durability[slot] = Math.max(0, Math.min(max, itemDur));
  } else {
    member.equipped_durability[slot] = max;
  }
}

/**
 * Build an InventoryItem entry for an item being unequipped (or
 * displaced by a swap), copying the slot's current durability across
 * so wear isn't lost.
 */
function entryForSlot(
  member: PartyMember,
  slot: EquippedSlot,
  itemName: string,
  items: Map<string, Item>,
): InventoryItem {
  const max = getItemMaxDurability(itemName, items);
  if (max == null) return { item: itemName };
  const cur = member.equipped_durability[slot];
  if (cur == null) return { item: itemName };
  return { item: itemName, durability: cur };
}

// ── Equip / unequip ────────────────────────────────────────────────

/**
 * Equip an item from the member's personal inventory.
 *
 * Logic:
 *   - The Items table tells us which slots accept the item, in
 *     priority order (weapons usually list right_hand, then
 *     left_hand). Pick the first empty matching slot. If every
 *     accepting slot is full, swap with the first one — its current
 *     occupant goes back into personal inventory.
 *   - Items the catalog flags as `character_can_equip: false`
 *     (consumables, keys, herbs) refuse with a polite message so the
 *     UI can still show feedback.
 *   - Items not in the catalog get a no-slot default — also refused
 *     so we don't accidentally treat unknown items as gear.
 */
export function equipItemFromInventory(
  member: PartyMember,
  itemIndex: number,
  items: Map<string, Item>,
  /** The member's class `allowable_item_types`. When provided, an item
   *  whose `item_type` isn't on the list is refused — a cleric can't
   *  wield a crossbow. Omit / pass null/empty for no class restriction
   *  (back-compat for callers without a class catalog, and tests). */
  allowableItemTypes?: ReadonlyArray<string> | null,
): ActionResult {
  if (itemIndex < 0 || itemIndex >= member.inventory.length) {
    return { ok: false, message: "Item not found in personal inventory." };
  }
  const inv = member.inventory[itemIndex];
  const def = items.get(inv.item);
  if (!def) {
    return { ok: false, message: `Don't know how to equip ${inv.item}.` };
  }
  // Class equipment restriction — a cleric can't equip a crossbow, etc.
  if (!classAllowsItemType(allowableItemTypes, def.item_type)) {
    return {
      ok: false,
      message: `${member.name} can't equip ${def.name ?? inv.item} — their class isn't trained for it.`,
    };
  }
  // Only consider slots the player UI currently surfaces — head/etc.
  // are filtered out so a head-only item refuses cleanly until the
  // matching UI lands.
  const usable = equippableSlots(def);
  if (!def.character_can_equip || usable.length === 0) {
    return { ok: false, message: `${inv.item} cannot be equipped.` };
  }

  // First empty matching slot wins.
  let chosen: EquippedSlot | null = null;
  for (const s of usable) {
    if (readSlot(member, s) == null) { chosen = s; break; }
  }

  if (chosen == null) {
    // All matching slots full — swap with the FIRST listed slot.
    // The displaced item moves back into personal inventory at the
    // same index so the player's view stays stable. This is exactly
    // what the user wants from a combat-time equip: gear in, gear out,
    // nothing dropped on the floor.
    chosen = usable[0];
    const previous = readSlot(member, chosen)!;
    // Move displaced item back into inventory at the same index so
    // the player's view stays stable. Carry its current durability
    // across so the swapped-out item doesn't reset to full wear.
    const displaced = entryForSlot(member, chosen, previous, items);
    member.inventory[itemIndex] = displaced;
    writeSlot(member, chosen, inv.item);
    seedSlotFromEntry(member, chosen, inv.item, inv.durability, items);
    return {
      ok: true,
      message: `${member.name} equips ${inv.item} (replaces ${previous}).`,
    };
  }

  // Empty slot — just move the item.
  member.inventory.splice(itemIndex, 1);
  writeSlot(member, chosen, inv.item);
  seedSlotFromEntry(member, chosen, inv.item, inv.durability, items);
  return {
    ok: true,
    message: `${member.name} equips ${inv.item} as ${SLOT_LABEL[chosen]}.`,
  };
}

/**
 * Equip an item into an explicitly-chosen slot.
 *
 * Used when an item can land in multiple slots (a dagger in either
 * hand, a versatile weapon vs. an offhand) and the player has picked
 * which one they want. The slot must be one of the item catalog's
 * accepting slots — otherwise we refuse so the UI can't sneak an
 * invalid pairing past us (e.g. equipping body armor in head).
 *
 * Behaviour matches `equipItemFromInventory` for the swap case: if
 * the chosen slot is occupied, the displaced item slides into the
 * inventory at the same index so the player's view stays stable.
 */
export function equipItemIntoSlot(
  member: PartyMember,
  itemIndex: number,
  slot: EquippedSlot,
  items: Map<string, Item>,
): ActionResult {
  if (itemIndex < 0 || itemIndex >= member.inventory.length) {
    return { ok: false, message: "Item not found in personal inventory." };
  }
  const inv = member.inventory[itemIndex];
  const def = items.get(inv.item);
  if (!def) {
    return { ok: false, message: `Don't know how to equip ${inv.item}.` };
  }
  const usable = equippableSlots(def);
  if (!def.character_can_equip || usable.length === 0) {
    return { ok: false, message: `${inv.item} cannot be equipped.` };
  }
  // Reject explicit picks for slots the UI doesn't surface yet
  // (head/etc.) — defends against stale callers that build their own
  // slot prompt and forget to filter.
  if (!usable.includes(slot)) {
    return {
      ok: false,
      message: `${inv.item} cannot be equipped as ${SLOT_LABEL[slot]}.`,
    };
  }
  const previous = readSlot(member, slot);
  if (previous == null) {
    member.inventory.splice(itemIndex, 1);
    writeSlot(member, slot, inv.item);
    seedSlotFromEntry(member, slot, inv.item, inv.durability, items);
    return {
      ok: true,
      message: `${member.name} equips ${inv.item} as ${SLOT_LABEL[slot]}.`,
    };
  }
  // Swap with the existing occupant. The displaced item carries its
  // current durability into the inventory entry; the new item picks
  // up whatever wear was stored on its inventory entry.
  const displaced = entryForSlot(member, slot, previous, items);
  member.inventory[itemIndex] = displaced;
  writeSlot(member, slot, inv.item);
  seedSlotFromEntry(member, slot, inv.item, inv.durability, items);
  return {
    ok: true,
    message: `${member.name} equips ${inv.item} (replaces ${previous}).`,
  };
}

/**
 * Unequip whatever sits in a slot — the item drops into the member's
 * personal inventory. No-op success when the slot is already empty.
 *
 * `items` is optional so legacy callers keep working, but passing it
 * is strongly recommended: with the catalog we can move the slot's
 * current durability onto the new InventoryItem entry, preserving wear
 * across the unequip → equip cycle just like the Python game.
 */
export function unequipSlot(
  member: PartyMember,
  slot: EquippedSlot,
  items?: Map<string, Item>,
): ActionResult {
  const current = readSlot(member, slot);
  if (current == null) {
    return { ok: true, message: `${SLOT_LABEL[slot][0].toUpperCase() + SLOT_LABEL[slot].slice(1)} slot is already empty.` };
  }
  const entry: InventoryItem = items
    ? entryForSlot(member, slot, current, items)
    : { item: current };
  writeSlot(member, slot, null);
  member.equipped_durability[slot] = null;
  member.inventory.push(entry);
  return {
    ok: true,
    message: `${member.name} unequips ${current}.`,
  };
}

// ── Race / class abilities (BREW / PICKPOCKET / TINKER) ────────────
//
// These three rows live between CAST SPELL and SHARED STASH on the
// Party Inventory screen, conditional on the right party member
// being present:
//   BREW POTIONS — when an Alchemist is in the party (class).
//   PICKPOCKET   — when a Halfling is in the party (race).
//   TINKER       — when a Gnome is in the party (race).
//
// V1 implementation: each press picks a random item from a small
// table and adds it to the shared stash. Once-per-day gating, the
// in-town adjacent-NPC requirement for pickpocket, and the bigger
// dice/skill-check workflow can layer on later — these stubs just
// surface the actions and prove the gating works.

/**
 * Pick one element from a weight × value list. `[weight, value][]`.
 */
function pickWeighted<T>(
  table: ReadonlyArray<readonly [number, T]>,
  rng: () => number = Math.random,
): T {
  const total = table.reduce((s, [w]) => s + w, 0);
  let roll = rng() * total;
  for (const [w, v] of table) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return table[table.length - 1][1];
}

/** Mirror of `_PICKPOCKET_LOOT` in the Python inventory_mixin. */
const PICKPOCKET_LOOT: ReadonlyArray<readonly [number, string]> = [
  [25, "Gold"],            // special-cased below — adds gold instead of an item
  [20, "Healing Herb"],
  [12, "Torch"],
  [10, "Arrows"],
  [10, "Antidote"],
  [8,  "Lockpick"],
  [5,  "Dagger"],
  [4,  "Mana Potion"],
  [3,  "Stones"],
  [2,  "Smoke Bomb"],
  [1,  "Holy Water"],
];

/**
 * Result of a pickpocket attempt. Adds the consumed-NPC key to the
 * common ActionResult shape so the caller can stamp it into the
 * `pickpocketedNpcs` Set on gameState — that way the once-per-NPC
 * gate is enforced in one place rather than relying on every call
 * site to remember.
 */
export interface PickpocketResult extends ActionResult {
  /** NPC the Halfling lifted from on success. Undefined on refusal. */
  pickedKey?: string;
}

/**
 * A Halfling tries to pickpocket someone in `nearbyNpcKeys`. Returns
 * the loot result + which NPC was hit (so the caller can mark them
 * spent). Refuses when:
 *
 *   - There's no Halfling in the active party.
 *   - `nearbyNpcKeys` is empty (no targets in reach).
 *   - Every nearby NPC is already in `alreadyPickpocketed`.
 *
 * Picks the *first un-pickpocketed key* in `nearbyNpcKeys` rather
 * than the random nearest, which keeps tests deterministic without
 * an extra RNG roll. The scene is responsible for ordering the list
 * by adjacency or whatever feels right at the UI layer; the helper
 * just commits.
 *
 * `rng` is consumed for the loot weighted-pick + the gold roll.
 * The consumed-NPC key is returned in `pickedKey` so the caller can
 * stamp gameState.pickpocketedNpcs without us reaching into
 * scene-only state from a pure-logic helper.
 */
export function pickpocket(
  party: Party,
  members: PartyMember[],
  nearbyNpcKeys: readonly string[],
  alreadyPickpocketed: ReadonlySet<string>,
  rng: () => number = Math.random,
): PickpocketResult {
  const halfling = findRace(members, "Halfling");
  if (!halfling) {
    return { ok: false, message: "No Halfling in the party." };
  }
  if (nearbyNpcKeys.length === 0) {
    return { ok: false, message: "No one nearby to pickpocket." };
  }
  // First un-pickpocketed key in the supplied order. Filtering and
  // taking the first match avoids reshuffling the caller's list.
  const target = nearbyNpcKeys.find((k) => !alreadyPickpocketed.has(k));
  if (!target) {
    return {
      ok: false,
      message:
        nearbyNpcKeys.length === 1
          ? "You've already pickpocketed everyone you can reach."
          : "Already lifted from everyone nearby — try someone else.",
    };
  }
  const reward = pickWeighted(PICKPOCKET_LOOT, rng);
  if (reward === "Gold") {
    const amount = 3 + Math.floor(rng() * 13); // 3–15 inclusive
    party.gold += amount;
    return {
      ok: true,
      message: `${halfling.name} pilfers ${amount} gold.`,
      pickedKey: target,
    };
  }
  party.inventory.push({ item: reward });
  return {
    ok: true,
    message: `${halfling.name} swipes a ${reward}.`,
    pickedKey: target,
  };
}

// The old "Alchemist brews a random potion" helper retired here —
// the live system now goes through `Potions.attemptBrew` against a
// recipe the player picks from a list. Recipes carry reagent costs,
// DC, and the success roll; see `web/src/game/world/Potions.ts` for
// the runtime and `PartyScene` for the picker UI. Keeping the
// `pickWeighted` utility around since other ability helpers still
// use it (pickpocket loot tables, future tinker variants).

/**
 * A Gnome tinkers up an item the player picked from the Tinker
 * ability's item list. Gated to once per in-game day: the caller passes the
 * current `dayIndex` from GameTime, and we refuse when it matches
 * `party.last_tinker_day`. Mirrors the old random-pick version's
 * spirit ("a Gnome reaches into a cluttered pouch and pulls out
 * something useful") but lets the player choose what they need
 * — a torch in a dark dungeon, arrows for a ranger, an antidote
 * after a poison fight.
 *
 * Refuses when:
 *   - No Gnome is in `members` (active party).
 *   - The party already tinkered today (`lastTinkerDay === currentDay`).
 *   - `itemName` isn't in the supplied `tinkerStock`. The caller is
 *     expected to source this from the Tinker ability's own
 *     `params.tinker_items` list (abilities.json); we don't trust the
 *     picker UI to forward only valid names since save data could go
 *     stale across module updates.
 *
 * On success, adds the item to the shared stash via `addToStash`
 * (so stackables like Arrows merge cleanly with existing rows) and
 * stamps `party.last_tinker_day = currentDay` so the gate engages
 * until the clock rolls into tomorrow.
 *
 * `items` is the live items catalog (loaded from items.json) — used
 * to drive stackable behaviour. `tinkerStock` is the deduped set of
 * item ids from the Tinker ability's `params.tinker_items`.
 */
export function tinker(
  party: Party,
  members: PartyMember[],
  itemName: string,
  currentDay: number,
  tinkerStock: ReadonlySet<string>,
  items: Map<string, Item>,
): ActionResult {
  const gnome = findRace(members, "Gnome");
  if (!gnome) {
    return { ok: false, message: "No Gnome in the party." };
  }
  if (typeof party.last_tinker_day === "number" && party.last_tinker_day === currentDay) {
    return {
      ok: false,
      message: `${gnome.name} has already tinkered today — try again tomorrow.`,
    };
  }
  if (!tinkerStock.has(itemName)) {
    return {
      ok: false,
      message: `${itemName} isn't something a Gnome can tinker up.`,
    };
  }
  // Reuse the shared "add a stackable item to the stash" helper so
  // Arrows / Lockpicks / Torches merge with existing stacks rather
  // than spawning a second row.
  addToStash(party, itemName, items);
  party.last_tinker_day = currentDay;
  return { ok: true, message: `${gnome.name} tinkers up a ${itemName}.` };
}

/**
 * True when a Gnome in the active party can tinker right now. The
 * caller (UI) uses this to grey out the row + skip the picker on
 * an already-spent day. Also returns false when there's no Gnome
 * — the row shouldn't even appear in that case, but defending
 * against stale UI state is cheap.
 */
export function canTinker(
  party: Party,
  members: PartyMember[],
  currentDay: number,
): boolean {
  if (!findRace(members, "Gnome")) return false;
  if (typeof party.last_tinker_day === "number" && party.last_tinker_day === currentDay) {
    return false;
  }
  return true;
}

// ── Spell casting (menu / out-of-combat) ───────────────────────────

/**
 * Roll an XdY dice expression. Pure — accepts an injected RNG so
 * tests can pin down outcomes.
 */
export function rollDice(
  count: number, sides: number, rng: () => number = Math.random,
): number {
  let total = 0;
  for (let i = 0; i < Math.max(0, count); i++) {
    total += 1 + Math.floor(rng() * Math.max(1, sides));
  }
  return total;
}

/** Statistical D&D-style modifier from a stat (10 = +0, 18 = +4). */
export function statMod(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

/**
 * The amount a heal spell heals on the target. Honours either the
 * `dice` string in `effect_value` or a static `hp_amount`. Falls
 * back to a sensible default when the data omits both.
 */
export function rollHeal(
  spell: Spell, caster: PartyMember, rng: () => number = Math.random,
): number {
  const ev = spell.effect_value ?? {};
  if (typeof ev.hp_amount === "number") return ev.hp_amount;
  let dice = 0;
  if (typeof ev.dice_count === "number" && typeof ev.dice_sides === "number") {
    dice = rollDice(ev.dice_count, ev.dice_sides, rng);
  } else if (typeof ev.dice === "string") {
    const m = /^(\d+)d(\d+)$/.exec(ev.dice);
    if (m) dice = rollDice(parseInt(m[1], 10), parseInt(m[2], 10), rng);
  } else {
    // Sensible defaults when the source data omits a roll: 1d8 for
    // heal, 2d8 for major_heal, 3d8 for mass_heal-per-target.
    const defaults: Record<string, [number, number]> = {
      heal:        [1, 8],
      major_heal:  [2, 8],
      mass_heal:   [1, 6],
    };
    const def = defaults[spell.effect_type];
    if (def) dice = rollDice(def[0], def[1], rng);
  }
  // WIS adds to clerical heals.
  const bonus = ev.stat_bonus === "wisdom" ? statMod(caster.wisdom) : 0;
  return Math.max(1, dice + bonus);
}

/**
 * Cast a single-target heal. Picks the best caster automatically
 * (highest level among those with enough MP). Returns the message
 * that should bubble up to the player.
 */
export function castHealOnTarget(
  party: Party,
  members: PartyMember[],
  spell: Spell,
  targetIndex: number,
  rng: () => number = Math.random,
): ActionResult {
  const target = members[targetIndex];
  if (!target) return { ok: false, message: "No such target." };
  if (target.hp <= 0) {
    return { ok: false, message: `${target.name} is dead and cannot be healed.` };
  }
  const possible = castersFor(spell, members, new Map());
  if (possible.length === 0) {
    return { ok: false, message: "No one in the party can cast that spell." };
  }
  // Prefer the highest-level caster; tie-break by who has the most MP.
  possible.sort(
    (a, b) => b.level - a.level || (b.mp ?? 0) - (a.mp ?? 0)
  );
  const caster = possible[0];
  caster.mp = (caster.mp ?? 0) - spell.mp_cost;
  const before = target.hp;
  const amount = rollHeal(spell, caster, rng);
  target.hp = Math.min(target.max_hp, target.hp + amount);
  const healed = target.hp - before;
  void party;
  return {
    ok: true,
    message: `${caster.name} casts ${spell.name} on ${target.name} — heals ${healed} HP.`,
  };
}

/**
 * Cast a mass heal — one party member spends MP, every alive ally
 * is healed. Returns a single summary message.
 */
export function castMassHeal(
  party: Party,
  members: PartyMember[],
  spell: Spell,
  rng: () => number = Math.random,
): ActionResult {
  const possible = castersFor(spell, members, new Map());
  if (possible.length === 0) {
    return { ok: false, message: "No one in the party can cast that spell." };
  }
  possible.sort(
    (a, b) => b.level - a.level || (b.mp ?? 0) - (a.mp ?? 0)
  );
  const caster = possible[0];
  caster.mp = (caster.mp ?? 0) - spell.mp_cost;
  let total = 0;
  for (const m of members) {
    if (m.hp <= 0) continue;
    const before = m.hp;
    const amount = rollHeal(spell, caster, rng);
    m.hp = Math.min(m.max_hp, m.hp + amount);
    total += m.hp - before;
  }
  void party;
  return {
    ok: true,
    message: `${caster.name} casts ${spell.name} — party heals ${total} HP total.`,
  };
}

// ── Self-cast utility spells ──────────────────────────────────────
//
// Spells that don't need a target prompt — Light is the canonical
// example. They consume MP from the best-positioned caster (highest
// level, most MP) and mutate party-wide state directly.

/** Default magic-light burn-time when the spell omits `effect_value.steps`.
 *  Matches the Python game's hook default (100 steps). */
const MAGIC_LIGHT_DEFAULT_STEPS = 100;

/**
 * Cast Light — a magic-torch spell that feeds the party's
 * `magicLightSteps` counter. Deliberately kept SEPARATE from the
 * physical-torch counter (`torchSteps`) so the HUD readout strip
 * can show "Magic Light 100" and "Torch 78" as two distinct
 * entries: torches are a stash consumable, the spell is MP-driven,
 * and conflating their tallies hides which resource is burning
 * down. The lighting overlay still treats both as the same kind of
 * warm-orb illumination (4-tile radius, warm tint) — the
 * gameplay distinction is purely the source / counter.
 *
 * Mirrors the Python game's `_on_spell_magic_light` flow with one
 * intentional departure: Python feeds Light into the torch counter
 * directly. The web port splits them per design feedback to make
 * each light source individually legible in the HUD.
 *
 * Multiple Light casts stack on each other (top up the counter)
 * but never on top of an active physical torch, which keeps its
 * own count.
 */
export function castMagicLight(
  party: Party,
  members: PartyMember[],
  spell: Spell,
  rng: () => number = Math.random,
): ActionResult {
  void rng;  // reserved for future variability — Python version is deterministic too.
  const possible = castersFor(spell, members, new Map());
  if (possible.length === 0) {
    return { ok: false, message: "No one in the party can cast that spell." };
  }
  // Same caster-priority rule as `castMassHeal`: highest level wins,
  // tie-break by remaining MP. Keeps tests deterministic and avoids
  // stomping a low-level caster's mana when a senior caster is
  // standing right there.
  possible.sort((a, b) => b.level - a.level || (b.mp ?? 0) - (a.mp ?? 0));
  const caster = possible[0];
  caster.mp = (caster.mp ?? 0) - spell.mp_cost;
  const ev = spell.effect_value ?? {};
  // `effect_value.steps` is the canonical field; coerce defensively
  // since the JSON schema is duck-typed at the data layer.
  const rawSteps = ev.steps;
  const steps =
    typeof rawSteps === "number" && Number.isFinite(rawSteps) && rawSteps > 0
      ? Math.floor(rawSteps)
      : MAGIC_LIGHT_DEFAULT_STEPS;
  // Top up the magic-light counter only — torches keep their own
  // count. Math.max guards against a corrupt save with a negative
  // value.
  party.magic_light_steps = Math.max(party.magic_light_steps, 0) + steps;
  return {
    ok: true,
    message: `${caster.name} casts ${spell.name}! A radiant orb illuminates the way.`,
  };
}

/**
 * Targeting kind for menu-cast spells. UI uses this to know whether
 * to prompt for a target via 1-4 or to cast immediately.
 */
export type MenuCastKind = "self" | "single-ally" | "mass" | "unsupported";

/**
 * Classify a spell for the Party-screen cast flow. Based on its
 * `effect_type` and `targeting`. Anything we haven't wired returns
 * "unsupported" so the UI can show a polite "no effect here" line.
 */
export function classifyMenuCast(spell: Spell): MenuCastKind {
  if (spell.effect_type === "mass_heal") return "mass";
  if (spell.effect_type === "heal" || spell.effect_type === "major_heal") {
    return "single-ally";
  }
  // Light is a self-cast utility spell — adds magic-light steps to
  // the party without prompting for a target. The lighting renderer
  // reads `party.magic_light_steps` alongside the physical-torch
  // counter so a Cleric's Light contributes to the same
  // illumination math without a separate code path.
  if (spell.effect_type === "magic_light") return "self";
  // Other utility spells (knock, reveal_map, etc.) need world-state
  // hooks (unlock door, light tile) we haven't built yet.
  return "unsupported";
}

// ── Party-wide consumables ────────────────────────────────────────

/** Number of light-steps a single torch provides when lit. Each
 *  Torch stash entry's `charges` field is the *stack count* (how many
 *  torches the party is carrying) — not the duration. Lighting one
 *  consumes one charge and adds this many steps to `party.torch_steps`. */
const TORCH_DEFAULT_STEPS = 150;

export interface UseItemResult {
  ok: boolean;
  message: string;
}

function findStashIndex(party: Party, itemName: string): number {
  return party.inventory.findIndex((it) => it.item === itemName);
}

/**
 * Consume one Camping Supplies charge: heal every alive party member
 * to full HP and (for casters) restore MP to max. When the charges on
 * the entry hit 0, the entry itself is removed from the stash.
 *
 * Mirrors the spirit of the Python "rest" effect, but simplified to
 * full restore — the user-facing rule we want is "camping makes you
 * whole again". The Python version is partial (35% / 30%) and also
 * advances the in-game clock; we don't have a clock in the web port
 * yet.
 */
export function consumeCampingSupplies(party: Party): UseItemResult {
  const idx = findStashIndex(party, "Camping Supplies");
  if (idx < 0) {
    return { ok: false, message: "No camping supplies in the stash." };
  }
  const entry = party.inventory[idx];
  // Camping supplies in the wild ship with charges already set; if a
  // bare entry shows up (e.g. from an editor-saved party), seed it
  // from the catalog default of 3 so a single use doesn't burn the
  // whole pack.
  const charges = (entry.charges ?? 3) - 1;
  let totalHp = 0;
  let totalMp = 0;
  for (const m of party.roster) {
    if (m.hp <= 0) continue;
    const hpHeal = m.max_hp - m.hp;
    if (hpHeal > 0) {
      m.hp = m.max_hp;
      totalHp += hpHeal;
    }
    if (m.max_mp > 0) {
      const mpHeal = m.max_mp - m.mp;
      if (mpHeal > 0) {
        m.mp = m.max_mp;
        totalMp += mpHeal;
      }
    }
  }
  if (charges <= 0) {
    party.inventory.splice(idx, 1);
  } else {
    party.inventory[idx] = { ...entry, charges };
  }
  if (totalHp === 0 && totalMp === 0) {
    return { ok: true, message: "The party rests, but everyone was already whole." };
  }
  return {
    ok: true,
    message: `The party rests. Restored ${totalHp} HP and ${totalMp} MP.`,
  };
}

/**
 * Light a torch — pull one charge off the Torch stack in the stash
 * and add `TORCH_DEFAULT_STEPS` light-steps to `party.torch_steps`.
 * Steps tick down inside dark scenes (town interiors / dungeons);
 * while they're > 0 the party emits an 8-tile light pool via
 * `partyLightRadius`. (No tint — see `refreshDarkness` in TownScene
 * / DungeonScene; the per-effect recolour was dropped because it
 * washed the maps out.)
 *
 * Torches are stackable — the entry's `charges` is the **count** of
 * torches in the stack (e.g. `charges: 20` = twenty unlit torches),
 * NOT a duration. Each call consumes exactly one torch (charges -= 1)
 * and adds a fresh `TORCH_DEFAULT_STEPS` to the burn counter. When
 * the stack hits zero the entry is spliced so the stash doesn't grow
 * zero-count tombstones. This mirrors the Rock / Lockpick / Arrows
 * stacking model the rest of the inventory uses.
 *
 * Stacks with an already-burning torch — using a second torch tops
 * the counter back up rather than starting a fresh one. (Same effect
 * either way for the player; simpler to reason about.)
 */
export function consumeTorch(party: Party): UseItemResult {
  const idx = findStashIndex(party, "Torch");
  if (idx < 0) {
    return { ok: false, message: "No torches in the stash." };
  }
  const entry = party.inventory[idx];
  // `charges` is the stack count — entries without it represent a
  // single torch. Decrement by one; splice the entry when the stack
  // empties so the stash doesn't accumulate zero-count rows.
  const remaining = (entry.charges ?? 1) - 1;
  if (remaining <= 0) {
    party.inventory.splice(idx, 1);
  } else {
    entry.charges = remaining;
  }
  party.torch_steps = Math.max(party.torch_steps, 0) + TORCH_DEFAULT_STEPS;
  return {
    ok: true,
    message: `Torch lit. ${TORCH_DEFAULT_STEPS} steps of light.`,
  };
}
