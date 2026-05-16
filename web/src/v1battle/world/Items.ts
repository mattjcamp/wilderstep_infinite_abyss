/**
 * Items loader — reads v2's module-scoped items.json shape directly.
 *
 * v2 differences from v1 (preserved here as the canonical model):
 *   - Items live in ONE flat array under `items` (not split into
 *     weapons/armors/general dicts). Each record carries a `category`
 *     field identifying which bucket it belongs to.
 *   - Primary identifier is `id` (snake_case), not display `name`.
 *     The Map this loader returns is keyed by id; consumers look up
 *     `items.get("club")` instead of `items.get("Club")`.
 *   - JSON field names are snake_case (`ac_bonus`, `bonus_damage`,
 *     `item_type`, `character_can_equip`, …) and the TypeScript type
 *     mirrors them so JSON parse → typed record is trivially lossless
 *     and there's no adapter layer to maintain.
 *   - Equip slots in v2 collapsed to `"hands"` and `"body"`. v1's
 *     enum is kept as a *superset* during the transition so the
 *     PartyMember model (still v1-shaped) can still type-check until
 *     the Party migration lands.
 *
 * `slotsForItem(items, id)` is the central helper the equip flow asks
 * about. Returns an empty array for items that aren't equippable
 * (consumables, tools, keys).
 */

import { modulePath } from "./Module";

/** Slot tag carried on item records (v2 shape). The PartyMember
 *  model uses the narrower `EquippedSlot = "hands" | "body"` from
 *  Party.ts — `"head"` lives here for forward-compat (helmets) but
 *  doesn't get equipped today. */
export type ItemSlot = "hands" | "body" | "head";

export interface Item {
  /** Snake_case identifier. Map keys + cross-references use this. */
  id: string;
  /** Which catalog the item came from. Useful for shop screens. */
  category: "weapons" | "armors" | "general";
  /** Display label shown in UI. */
  name: string;
  description?: string;
  /** Equipment slot(s) that accept this item, in v2 shape (`"hands"` /
   *  `"body"`). PartyMember.equipped is still v1-shaped during the
   *  transition; the equip pipeline maps v2 slots → v1 slots. */
  slots?: ItemSlot[];
  /** Whether a single character can equip / hold it. */
  character_can_equip?: boolean;
  /** Whether the whole party can equip it (banners, etc.). */
  party_can_equip?: boolean;
  /** Whether using consumes a charge / acts at runtime. */
  usable?: boolean;
  /** Whether a `usable` item can be drunk / applied during combat.
   *  Default `true`; `false` opts out (Camping Supplies). */
  combat_usable?: boolean;
  /** Free-form effect tag for usable items (e.g. "heal_hp"). */
  effect?: string | null;
  // Combat / display stats — present where relevant.
  power?: number;
  ranged?: boolean;
  melee?: boolean;
  throwable?: boolean;
  evasion?: number;
  /** Magic AC bonus that stacks with armor evasion when equipped. */
  ac_bonus?: number;
  durability?: number;
  item_type?: string;
  /** Render-glyph hint from items.json (e.g. "torch", "potion"). */
  icon?: string;
  /** Buy / sell prices at shops. */
  buy?: number;
  sell?: number;
  /** Multiple copies collapse into a single inventory entry whose
   *  `charges` count sums across copies. */
  stackable?: boolean;
  /** Per-purchase / per-drop stack size. */
  charges?: number;
  /** Ammo item id this weapon consumes per shot. */
  ammo?: string;
  /** Extra damage dice rolled on top of base. */
  bonus_damage?: string | number;
  damage_type?: string;
  /** Effect id this item confers on the party while equipped. */
  grants_effect?: string;
  /**
   * Firing mode for ranged weapons (`ranged: true`). `"target"` is
   * the familiar pick-an-enemy-from-the-list flow with LOS gating —
   * suits precision instruments (crossbow, silver bow). `"directional"`
   * is a Magic-Dart-style cardinal-line shot — caster picks an
   * arrow key, the projectile flies in that line and hits the first
   * creature, with friendly-fire risk. Suits volley-style weapons
   * (short bow, long bow, sling).
   *
   * Default when omitted is `"target"`. Field is ignored for non-
   * ranged items.
   */
  targeting?: "target" | "directional";
  /**
   * Maximum tile distance the weapon can reach. Used by both Range
   * (target-pick LOS filter) and the directional-fire ray trace.
   * Authoritative when set; `maxRangeFor` falls back to the legacy
   * item_type switch when omitted so older items.json data keeps
   * working without an immediate edit.
   *
   * Convention: 1 means melee-only (the default for non-ranged
   * items). Longer values give bow types tactical depth — Long Bow
   * 10 reaches across the arena, Sling 6 wants to close before
   * firing.
   */
  range?: number;
}

interface RawItem extends Partial<Item> {
  id?: string;
  category?: Item["category"];
  name?: string;
}

interface RawItemsFile {
  _comment?: string;
  items?: RawItem[];
}

let _cache: Map<string, Item> | null = null;

function isItemSlot(s: string): s is ItemSlot {
  return s === "hands" || s === "body" || s === "head";
}

/**
 * Hydrate a raw items.json entry into a typed `Item`.
 *
 * Project principle: catalog fields are configured in the data model
 * (the `Item` interface + items.json). The loader carries every
 * known field through unconditionally, so adding a new attribute to
 * `Item` + items.json is sufficient — no separate copy point here to
 * remember. An earlier per-field enumeration silently dropped the
 * `targeting` and `range` fields when they were added, which is the
 * class of regression this spread avoids.
 *
 * The spread is followed by a handful of overrides for fields whose
 * runtime shape differs from the raw JSON: `slots` is narrowed to
 * the v2 `ItemSlot` union so unknown strings can't leak in, and
 * `effect` is normalised from `undefined` to `null` so downstream
 * consumers can switch on a single absent value. Required identity
 * fields (`id`, `category`, `name`) are validated upfront and then
 * re-stamped so TypeScript sees them as definitely-present on the
 * returned object.
 */
function itemFromRaw(r: RawItem): Item | null {
  if (!r.id || !r.category || !r.name) return null;
  return {
    ...r,
    id: r.id,
    category: r.category,
    name: r.name,
    slots: (r.slots ?? []).filter(isItemSlot),
    effect: r.effect ?? null,
  };
}

export async function loadItems(
  url = modulePath("items.json"),
): Promise<Map<string, Item>> {
  if (_cache) return _cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as RawItemsFile;
  _cache = new Map();
  for (const r of raw.items ?? []) {
    const item = itemFromRaw(r);
    if (item) _cache.set(item.id, item);
  }
  return _cache;
}

export function getItem(items: Map<string, Item>, id: string): Item | null {
  return items.get(id) ?? null;
}

/**
 * Slot list for an item, in the priority order the editor stores.
 * Returns the catalog's raw `ItemSlot` values (`"hands"` / `"body"` /
 * `"head"`). Callers that target PartyMember.equipped should filter
 * to the `EquippedSlot` subset.
 *
 * Empty for non-equippable items so callers can refuse cleanly.
 */
export function slotsForItem(
  items: Map<string, Item>,
  id: string,
): ItemSlot[] {
  const it = items.get(id);
  if (!it) return [];
  if (!it.character_can_equip) return [];
  return [...(it.slots ?? [])];
}

/**
 * "Stack size" for a stackable item — how many uses one purchase /
 * drop / loot pickup adds to the inventory entry's `charges` count.
 */
export function stackSizeOf(item: Item): number {
  if (typeof item.charges === "number" && item.charges > 0) return item.charges;
  return 1;
}

/** True for items the inventory should consolidate. */
export function isStackable(item: Item): boolean {
  return !!item.stackable;
}

/**
 * Whether a usable item can be drunk / applied during a combat round.
 * Non-usable items return false; usable items default to combat-usable
 * unless `combat_usable` is explicitly false in items.json.
 */
export function isCombatUsable(item: Item): boolean {
  if (!item.usable) return false;
  return item.combat_usable !== false;
}

/** Test-only cache reset. */
export function _clearItemsCache(): void {
  _cache = null;
}
