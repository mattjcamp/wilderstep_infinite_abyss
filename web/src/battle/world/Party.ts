/**
 * Party + PartyMember — reads v2's module-scoped catalogs natively.
 *
 * v2 differences (canonical model):
 *   - The `party.json` file holds Party state (start position, gold,
 *     shared stash, party-effects, light counters). Its `roster` is a
 *     flat array of **character ids**, not inline member records.
 *   - The actual member records live in `characters.json`, keyed by
 *     `id` (snake_case). loadParty() fetches both and joins them.
 *   - Slots collapsed from v1's {right_hand, left_hand, body, head}
 *     to v2's {hands, body}. `PartyMember.equipped` mirrors v2 exactly.
 *   - `party_effects` is a flat `string[]` of effect ids — the four
 *     fixed slots (`effect_1`..`effect_4`) went away with v2's drop-
 *     the-slots refactor.
 *   - `active_party` is gone too — every roster member is active.
 *     `activeMembers(party)` simply returns the resolved roster.
 *   - `start_position` carries an optional `map_id` alongside col/row
 *     so the party can boot into a specific map.
 *   - All field names are snake_case to match the JSON on disk; the
 *     TS interface is a 1:1 mirror, no adapter.
 *
 * v1-only fields kept here (with no v2 counterpart yet):
 *   - `max_hp` / `max_mp` are computed at load from the character's
 *     `hp` / `mp` (v2's characters.json carries only the *current*
 *     value; the cap rises on level-up via the leveling system).
 *   - `equipped_durability` tracks per-slot wear at runtime — v2
 *     stores neither current durability nor max-durability on the
 *     character record, so we keep the per-slot dict here.
 *   - `magic_light_steps` is a Light-spell counter not represented
 *     in v2's data model but needed by the lighting overlay.
 *   - `item_granted_effect_ids` is a derived runtime cache of effect
 *     ids granted by currently-equipped gear (Sun Sword Aura while
 *     the Sun Sword is wielded, etc.).
 */

import { modulePath, withBase } from "./Module";
import type { Item } from "./Items";
import { isStackable, loadItems } from "./Items";

/** Slot tags as carried on items + characters in v2. Equipping an
 *  item targets one of these. */
export type EquippedSlot = "hands" | "body";

/** Map of equipped item ids by slot. Mirrors `Character.equipped`
 *  in characters.json. Slots are optional in the JSON; we normalise
 *  to `string | null` at load so consumers don't have to handle
 *  both `undefined` and `null`. */
export interface EquipmentSlots {
  hands: string | null;
  body: string | null;
}

export interface InventoryItem {
  /** Item id (snake_case) referencing items.json. */
  item: string;
  /** Charges remaining for stacked / consumable items. Absent for gear. */
  charges?: number;
  /**
   * Current remaining durability for worn gear. Absent means the item
   * has never been used (start at the catalog max when equipped) or is
   * indestructible. Travels with the entry so two copies of the same
   * item in the stash can wear independently.
   */
  durability?: number;
}

export interface PartyMember {
  /** Snake_case identifier — matches the key in characters.json
   *  and the entries in `Party.roster_ids`. */
  id: string;
  name: string;
  /** Class id (snake_case) — references character_classes.json. */
  class: string;
  /** Race id (snake_case) — references races.json. */
  race: string;
  gender: string;
  level: number;
  /** Cumulative experience points across the member's life. Drives
   *  level-up timing — see Leveling.ts. */
  exp: number;
  hp: number;
  /** Maximum HP — derived from `hp` at load time. */
  max_hp: number;
  /** Current mana points (casters only, 0 for non-casters). */
  mp: number;
  /** Maximum MP — derived from `mp` at load time. */
  max_mp: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  /** Currently-equipped item ids, keyed by v2 slot. */
  equipped: EquipmentSlots;
  /** Per-slot remaining durability for the items currently equipped.
   *  `null` means the slot's item is indestructible (or there's nothing
   *  equipped). When an item is unequipped, its current value moves
   *  onto the receiving InventoryItem.durability so wear isn't lost. */
  equipped_durability: {
    hands: number | null;
    body: number | null;
  };
  inventory: InventoryItem[];
  /** Resolved /assets/... path. Source path is normalised on load. */
  sprite: string;
}

export interface Party {
  /** Where the party boots into the world. `map_id` is optional; the
   *  scene loader picks a default map when it's omitted. */
  start_position: { map_id?: string; col: number; row: number };
  /** Optional party-level avatar — the picture the player picked in
   *  the formation screen. Not all flows surface it. */
  avatar?: string;
  gold: number;
  /** Character ids in adventuring order. Resolved against
   *  characters.json into `roster` on load. */
  roster_ids: string[];
  /** Resolved member records — joined from characters.json at load
   *  time. Every entry here is in play (no separate active_party
   *  subset). */
  roster: PartyMember[];
  /** Flat list of effect ids currently active on the party. Detect
   *  Traps, Infravision, Galadriel's Light — anything the player has
   *  toggled on. */
  party_effects: string[];
  /** Stash — items shared across the party. */
  inventory: InventoryItem[];
  /** Remaining steps the currently-burning torch lights for. */
  torch_steps: number;
  /** Remaining steps for the Light spell's conjured radiant orb.
   *  Kept SEPARATE from `torch_steps` because the player thinks of
   *  them as distinct light sources (one is a stash consumable, the
   *  other is MP-driven). The HUD readout shows them as two
   *  entries so the player can see each counter burn down. */
  magic_light_steps: number;
  /** Remaining steps before Galadriel's Light burns out. */
  galadriels_light_steps: number;
  /** `dayIndex` (from GameTime) the last time a Gnome tinkered up an
   *  item. Used by the once-per-day gate on the TINKER action. */
  last_tinker_day?: number;
  /** Cached union of effect ids granted by equipped gear — recomputed
   *  by `refreshItemGrantedEffects` after any equip change. Lives in
   *  a separate lane from `party_effects` so item auras don't compete
   *  with manually-toggled effects. */
  item_granted_effect_ids?: readonly string[];
}

// ── Raw JSON shapes (party.json + characters.json) ─────────────────

interface RawEquipped {
  hands?: string | null;
  body?: string | null;
}

interface RawCharacter {
  id?: string;
  name?: string;
  class?: string;
  race?: string;
  gender?: string;
  level?: number;
  exp?: number;
  hp?: number;
  mp?: number;
  /** Optional explicit peak values. Saves built post-feature carry
   *  these (back-filled at PlayHost load); honoring them lets a
   *  wounded character preserve their true max in combat instead
   *  of collapsing to current = max. Absent → fall back to hp/mp
   *  as max, matching the prior shipping behavior. */
  max_hp?: number;
  max_mp?: number;
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  equipped?: RawEquipped;
  inventory?: unknown;
  sprite?: string;
}

interface RawCharactersFile {
  _comment?: string;
  characters?: RawCharacter[];
}

interface RawParty {
  start_position?: { map_id?: string; col?: number; row?: number };
  avatar?: string;
  gold?: number;
  /** v2 carries character ids only. */
  roster?: string[];
  party_effects?: string[];
  inventory?: unknown;
  torch_steps?: number;
  magic_light_steps?: number;
  galadriels_light_steps?: number;
  last_tinker_day?: number;
}

// ── Sprite normalisation ───────────────────────────────────────────
//
// v2 assets live under `/sprites/` (NOT `/assets/`). Character
// records carry sprite paths as folder-relative strings like
// `"person/fighter6.png"`; the editor's `spriteFields.ts` resolves
// them with the same `/sprites/<path>` convention, so we mirror it
// here. Anything that already starts with `/sprites/` is honoured
// as-is (with the deploy base prefixed); anything else lands under
// `/sprites/` so the URL the Phaser loader fetches matches the file
// actually shipped in `public/sprites/`.

/**
 * Resolve a raw sprite path to a usable `/sprites/...` URL.
 *
 *   - "person/fighter6.png" → "/sprites/person/fighter6.png"
 *   - "/sprites/foo.png"    → "/sprites/foo.png" (just base-prefixed)
 *   - "http(s)://…"         → returned untouched
 *   - empty / missing       → fall back to a placeholder under
 *                              `/sprites/person/` so the slot still
 *                              renders something rather than 404ing.
 */
export function spriteForMember(rawSprite: string | undefined, _klass: string): string {
  const raw = (rawSprite ?? "").trim();
  if (!raw) {
    // No source path — point at the generic "townsperson" placeholder
    // that the modules ship. Beats a class-named PNG that doesn't
    // exist under /sprites/.
    return withBase(`/sprites/person/townsperson1.png`);
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/sprites/")) return withBase(raw);
  // Strip any leading slash + an accidental "sprites/" prefix so we
  // don't end up with `/sprites/sprites/...`.
  const clean = raw.replace(/^\/+/, "").replace(/^sprites\//, "");
  return withBase(`/sprites/${clean}`);
}

// ── Inventory normalisation ────────────────────────────────────────

function normalizeInventory(raw: unknown): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InventoryItem[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      out.push({ item: entry });
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as InventoryItem).item === "string") {
      out.push(entry as InventoryItem);
      continue;
    }
    // Unknown shape — drop it rather than poison the inventory.
  }
  return out;
}

// ── Character → PartyMember ────────────────────────────────────────

/**
 * Hydrate a raw character record (from characters.json) into a
 * runtime PartyMember.
 *
 * Defaults seed required scalars (every D&D-ish stat, level, hp/mp);
 * spread carries every other RawCharacter field through (project
 * principle — adding a field to PartyMember + characters.json
 * shouldn't need a copy point edit). Overrides handle the things
 * that can't be a pass-through: id slug fallback, lowercase class /
 * race ids, computed `max_hp` / `max_mp` (v2 carries only current
 * values), normalised `equipped` + `equipped_durability` (always a
 * fixed-shape pair), resolved sprite URL, and inventory shape
 * coercion.
 */
export function memberFromRaw(raw: RawCharacter): PartyMember {
  const klass = (raw.class ?? "fighter").toLowerCase();
  const hp = raw.hp ?? 0;
  const mp = raw.mp ?? 0;
  // Peak values: honor an explicit max from the raw record (saves
  // back-filled at PlayHost load carry these) so a wounded character
  // entering combat shows 5/9, not the misleading 5/5 we'd get from
  // clamping max to current. Fall back to current when absent so
  // legacy / minimal records (the editor's hand-rolled demo party,
  // ad-hoc tests) keep their prior shipping behavior.
  const maxHp = typeof raw.max_hp === "number" ? raw.max_hp : hp;
  const maxMp = typeof raw.max_mp === "number" ? raw.max_mp : mp;
  const id = raw.id ?? (raw.name ?? "unknown").toLowerCase().replace(/\s+/g, "_");
  return {
    name: "?",
    gender: "?",
    level: 1,
    exp: 0,
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    ...raw,
    id,
    class: klass,
    race: (raw.race ?? "human").toLowerCase(),
    hp,
    max_hp: maxHp,
    mp,
    max_mp: maxMp,
    equipped: {
      hands: raw.equipped?.hands ?? null,
      body: raw.equipped?.body ?? null,
    },
    // Durability trackers default to "uninitialised" — the first
    // time an item is equipped (or use_durability runs against it)
    // the helper seeds it from the catalog max.
    equipped_durability: { hands: null, body: null },
    inventory: normalizeInventory(raw.inventory),
    sprite: spriteForMember(raw.sprite, klass),
  };
}

/**
 * Build a runtime `Party` from a raw party.json plus a resolved
 * characters catalog. `roster` is filled by looking up each id in
 * `characters`; ids that don't resolve are dropped (with a console
 * warning) so a stale save doesn't crash the boot.
 */
/**
 * Build a runtime `Party` from a raw party.json plus a resolved
 * characters catalog.
 *
 * Spread carries every plain-data RawParty field through (project
 * principle — adding a field to Party + party.json shouldn't need a
 * copy point edit). Overrides handle the fields that require
 * shaping: `start_position` normalises to definite col/row,
 * `roster` is resolved from ids against the characters catalog, and
 * inventory + party_effects get defensive defaults.
 */
export function partyFromRaw(
  raw: RawParty,
  characters: Map<string, PartyMember>,
): Party {
  const roster_ids = Array.isArray(raw.roster) ? [...raw.roster] : [];
  const roster: PartyMember[] = [];
  for (const id of roster_ids) {
    const m = characters.get(id);
    if (m) {
      roster.push(m);
    } else if (typeof console !== "undefined") {
      console.warn(`[party] roster id "${id}" not in characters.json — skipped.`);
    }
  }
  return {
    gold: 0,
    torch_steps: 0,
    magic_light_steps: 0,
    galadriels_light_steps: 0,
    ...raw,
    start_position: {
      map_id: raw.start_position?.map_id,
      col: raw.start_position?.col ?? 0,
      row: raw.start_position?.row ?? 0,
    },
    roster_ids,
    roster,
    party_effects: Array.isArray(raw.party_effects) ? [...raw.party_effects] : [],
    inventory: normalizeInventory(raw.inventory),
  };
}

// ── Persistence (localStorage) ─────────────────────────────────────

const STORAGE_KEY = "wilderstep.party.v2";

/** Serialise a `Party` back to the v2 party.json shape. */
function partyToRaw(p: Party): RawParty {
  return {
    start_position: {
      map_id: p.start_position.map_id,
      col: p.start_position.col,
      row: p.start_position.row,
    },
    avatar: p.avatar,
    gold: p.gold,
    roster: [...p.roster_ids],
    party_effects: [...p.party_effects],
    inventory: p.inventory,
    torch_steps: p.torch_steps,
    magic_light_steps: p.magic_light_steps,
    galadriels_light_steps: p.galadriels_light_steps,
    last_tinker_day: p.last_tinker_day,
  };
}

export function saveStoredRoster(p: Party): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(partyToRaw(p)));
  } catch {
    /* quota / storage disabled — degrade silently */
  }
}

export function clearStoredRoster(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  _partyCache = null;
}

function loadStoredRawParty(): RawParty | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RawParty;
  } catch {
    return null;
  }
}

// ── Loaders ────────────────────────────────────────────────────────

let _partyCache: Party | null = null;
let _charactersCache: Map<string, PartyMember> | null = null;

/** Fetch every Character record once and cache it. */
async function loadCharacters(): Promise<Map<string, PartyMember>> {
  if (_charactersCache) return _charactersCache;
  const url = modulePath("characters.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as RawCharactersFile;
  const out = new Map<string, PartyMember>();
  for (const r of raw.characters ?? []) {
    const m = memberFromRaw(r);
    if (m.id) out.set(m.id, m);
  }
  _charactersCache = out;
  return out;
}

/**
 * Resolve the current party. Order of preference:
 *   1. In-memory cache (set on first call this session).
 *   2. localStorage (the formation screen's edits).
 *   3. The bundled module's `party.json` seed.
 *
 * Both party.json AND characters.json are fetched on first load so
 * the roster ids can be joined into PartyMember records.
 */
export async function loadParty(): Promise<Party> {
  if (_partyCache) return _partyCache;
  const characters = await loadCharacters();
  const stored = loadStoredRawParty();
  let raw: RawParty;
  if (stored) {
    raw = stored;
  } else {
    const url = modulePath("party.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    raw = (await res.json()) as RawParty;
  }
  _partyCache = partyFromRaw(raw, characters);
  // First-load tidy-up: consolidate duplicate stackables. A failure
  // here shouldn't crash the party load.
  try {
    const items = await loadItems();
    mergePartyStackables(_partyCache, items);
  } catch {
    /* items unavailable — skip merge, leave inventory as-is */
  }
  return _partyCache;
}

/** Every roster member is "active" in v2 — there's no separate
 *  active_party subset any more. Helper kept for call-site
 *  ergonomics. */
export function activeMembers(p: Party): PartyMember[] {
  return p.roster;
}

// ── Stackable inventory merging ────────────────────────────────────

/**
 * Collapse duplicate stackable inventory entries into a single entry
 * whose `charges` count sums across the duplicates. Idempotent.
 */
export function mergeStackableInventory(
  inventory: InventoryItem[],
  items: Map<string, Item>,
): InventoryItem[] {
  const out: InventoryItem[] = [];
  const idxByName = new Map<string, number>();
  for (const entry of inventory) {
    const def = items.get(entry.item);
    if (!def || !isStackable(def)) {
      out.push(entry);
      continue;
    }
    const charges = entry.charges ?? 1;
    const existingIdx = idxByName.get(entry.item);
    if (existingIdx == null) {
      idxByName.set(entry.item, out.length);
      out.push({ ...entry, charges });
      continue;
    }
    const existing = out[existingIdx];
    existing.charges = (existing.charges ?? 0) + charges;
  }
  return out;
}

/** Walk every inventory the party touches and replace it with the
 *  merged version. Mutates `party` in place. */
export function mergePartyStackables(
  party: Party,
  items: Map<string, Item>,
): void {
  party.inventory = mergeStackableInventory(party.inventory, items);
  for (const m of party.roster) {
    m.inventory = mergeStackableInventory(m.inventory, items);
  }
}

// ── Ammo helpers ───────────────────────────────────────────────────

export function findAmmoInStash(
  party: Party,
  itemName: string,
): { index: number; entry: InventoryItem } | null {
  for (let i = 0; i < party.inventory.length; i++) {
    const it = party.inventory[i];
    if (it.item !== itemName) continue;
    if ((it.charges ?? 1) <= 0) continue;
    return { index: i, entry: it };
  }
  return null;
}

export function consumeAmmoFromStash(
  party: Party,
  itemName: string,
): boolean {
  const found = findAmmoInStash(party, itemName);
  if (!found) return false;
  const { index, entry } = found;
  const remaining = (entry.charges ?? 1) - 1;
  if (remaining <= 0) {
    party.inventory.splice(index, 1);
  } else {
    entry.charges = remaining;
  }
  return true;
}

/**
 * Consume one unit of the entry at `index` in an inventory list,
 * decrementing the stack's `charges` instead of nuking the entry when
 * the stack holds more than one.
 */
export function consumeOneFromStackAt(
  list: InventoryItem[],
  index: number,
): boolean {
  if (index < 0 || index >= list.length) return false;
  const entry = list[index];
  const remaining = (entry.charges ?? 1) - 1;
  if (remaining <= 0) {
    list.splice(index, 1);
  } else {
    entry.charges = remaining;
  }
  return true;
}

export function partyHasAmmo(party: Party, itemName: string): boolean {
  return findAmmoInStash(party, itemName) !== null;
}

/** Ammo-family aliases — when a weapon's `ammo` field names the
 *  catalog's standard ammo for that weapon class, the player can
 *  also load any item id in the family list as a substitute.
 *  Fire Arrows are the canonical alternate today: they swap in
 *  for regular Arrows on any bow, dealing the same shot damage
 *  but igniting the target's cell on impact.
 *
 *  Adding a new alternate ammo (Silver Bolts, Poison Stones, …)
 *  is a one-line addition here plus the matching item record.
 *  Aliases are not symmetric: the weapon's primary ammo is the
 *  KEY, substitutes are the values; "fire_arrows" doesn't alias
 *  back to "arrows" (a weapon that takes only fire_arrows
 *  wouldn't accept regular arrows). */
const AMMO_FAMILY: Readonly<Record<string, ReadonlyArray<string>>> = {
  arrows: ["fire_arrows"],
  // Crossbow analog — bolts swap in for fire_bolts the same way
  // arrows do for fire_arrows. Lets a Ranger who crafts a bundle
  // of fire_bolts (via Craft Fire Arrows) actually load them into
  // a crossbow.
  bolts: ["fire_bolts"],
};

/** Every ammo id the party currently has that the weapon could
 *  load, in display order: primary ammo first, then any family
 *  aliases. Missing ammo (empty stack OR absent from the stash)
 *  is filtered out — the result is a "what can I shoot right
 *  now" list rather than a "what could this weapon ever accept"
 *  list. Returns an empty list when the weapon has no `ammo`
 *  field at all (melee / spell-only).
 *
 *  Drives two surfaces:
 *    1. Range gating — when this list is empty the row is
 *       disabled.
 *    2. The ammo picker — when the list has 2+ entries the
 *       combat scene prompts the player to choose before
 *       resolving the shot. */
export function compatibleAmmoIds(weapon: Item, party: Party): string[] {
  if (!weapon.ammo) return [];
  const candidates: string[] = [
    weapon.ammo,
    ...(AMMO_FAMILY[weapon.ammo] ?? []),
  ];
  return candidates.filter((id) => partyHasAmmo(party, id));
}

/**
 * If `member` is wielding a ranged weapon in the `hands` slot and the
 * shared stash has no matching ammo, there's no offhand to swap in
 * any more (v2 collapsed the off-hand slot). Returns null in v2;
 * preserved for caller compatibility — the gating logic now simply
 * hides the Range action when no ammo is available.
 */
export function swapToMeleeIfOutOfAmmo(
  _member: PartyMember,
  _party: Party,
  _items: Map<string, Item>,
): { from: string; to: string } | null {
  // v2 has no offhand slot to draw a backup melee weapon from. The
  // caller is expected to hide the Range option when partyHasAmmo
  // returns false, rather than counting on a silent swap.
  return null;
}

// ── Cache reset / override ─────────────────────────────────────────

/** Test-only cache reset. */
export function _clearPartyCache(): void {
  _partyCache = null;
  _charactersCache = null;
}

/**
 * Override the module-level party cache. Used by save-load layers
 * after hydrating a Party from localStorage so the cache and the live
 * state stay pointing at the same object.
 */
export function _setPartyCache(p: Party | null): void {
  _partyCache = p;
}
