/**
 * Play-side adapters for race-granted active abilities — Halfling
 * Pickpocket and Gnome Tinker. These wrap the same gameplay rules
 * the v1 battle-side `PartyActions` helpers describe (one-shot per
 * NPC, once per in-game day, weighted loot table, general-store
 * stock filter, etc.) but operate directly on the v2 `WorldSave`
 * shape so the play runtime can call them without bridging through
 * a Party fixture.
 *
 * The v1 helpers still exist for any non-play surface (the editor's
 * sim mode, eventual scripted callers). This module is the play
 * runtime's authoritative implementation: pure functions that take
 * the live save + the relevant catalog slices + an RNG and return
 * either an `{ ok: false, message }` refusal or an `{ ok: true,
 * message, nextSave }` update. Callers (`PlayHost` / overlays)
 * commit the new save and surface the message in the log strip.
 *
 * Keeping these adapters pure means tests can drive them with
 * hand-built fixtures + a seeded RNG without standing up React or
 * Phaser. The wiring callers stay narrow: lookup the catalogs they
 * already have, hand them to the adapter, write the returned save.
 */

import type { WorldSave } from "./saveTypes";
import {
  addToInventory,
  bundleSizeFor,
  type StackableItemRef,
} from "./inventoryStacking";

/** Minimal catalog character shape — `id` to find the saved member
 *  by, `race` (lowercased) to gate eligibility, `name` for the
 *  log line. Subset of `SimCharacter` / the editor's
 *  `CharacterRecord` so callers can pass either without a cast. */
export interface RaceAbilityCharacterRef {
  id: string;
  name?: string;
  race?: string;
}

/** Minimal catalog counter shape — `id` to find the general store,
 *  `items` for the stock list. Mirrors `PlayCounter` / the editor's
 *  CounterRecord just enough to consume the field. */
export interface RaceAbilityCounterRef {
  id: string;
  items?: ReadonlyArray<string>;
}

/** Outcome of an attempt. `ok: true` carries the post-attempt
 *  WorldSave; callers should commit it before surfacing `message`.
 *  `ok: false` leaves the save untouched and uses `message` to
 *  explain to the player why nothing happened. */
export interface RaceAbilityResult {
  ok: boolean;
  message: string;
  nextSave?: WorldSave;
}

/** Loot table for Pickpocket — mirrors the weights from the v1
 *  battle-side helper (`PartyActions.PICKPOCKET_LOOT`) but uses
 *  v2 snake_case item ids the play save's inventory understands.
 *  `__gold__` is the sentinel for the gold-instead-of-an-item
 *  branch; the resolver special-cases it.
 *
 *  Weights sum to 100, so a single `rng()` call in [0,1) maps
 *  cleanly via `floor(rng()*100)` + cumulative comparison. */
const PICKPOCKET_LOOT: ReadonlyArray<[number, string]> = [
  [25, "__gold__"],
  [20, "healing_herb"],
  [12, "torch"],
  [10, "arrows"],
  [10, "antidote"],
  [8, "lockpick"],
  [5, "dagger"],
  [4, "mana_potion"],
  [3, "stones"],
  [2, "smoke_bomb"],
  [1, "holy_water"],
];

/** Weighted-random pick from a `[weight, value]` table. Mirrors the
 *  v1 helper's algorithm so the loot odds match the canonical
 *  reference. Falls back to the last entry on a saturation roll
 *  (`rng()` returning exactly 1.0, or sum off due to floating-point
 *  rounding) — that path is unreachable for well-formed RNGs but
 *  keeps the return non-null. */
function pickWeighted<T>(
  table: ReadonlyArray<[number, T]>,
  rng: () => number,
): T {
  const total = table.reduce((s, [w]) => s + w, 0);
  let roll = rng() * total;
  for (const [weight, value] of table) {
    if (roll < weight) return value;
    roll -= weight;
  }
  return table[table.length - 1][1];
}

/** Find the FIRST alive party member whose race matches `raceId`
 *  (case-insensitive). Used by both Pickpocket (Halfling) and
 *  Tinker (Gnome) eligibility gates, plus for naming the actor in
 *  the result message. Returns null when no qualifying member is
 *  alive or the race id doesn't resolve in `characters`. */
export function findAliveMemberOfRace(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef>,
  raceId: string,
): { id: string; name: string } | null {
  const r = raceId.toLowerCase();
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  for (const m of save.party.members) {
    if (m.hp <= 0) continue;
    const cat = charById.get(m.id);
    if (!cat) continue;
    if ((cat.race ?? "").toLowerCase() !== r) continue;
    return { id: m.id, name: cat.name ?? m.id };
  }
  return null;
}

// ── Pickpocket (Halfling) ─────────────────────────────────────────

/** True when (a) an alive Halfling is in the party AND (b) the
 *  named NPC isn't already in `save.party.pickpocketedNpcs`. Drives
 *  the Steal button's enable state on the NPC dialog. */
export function canPickpocket(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef>,
  npcId: string,
): boolean {
  if (!findAliveMemberOfRace(save, characters, "halfling")) return false;
  const pocketed = save.party.pickpocketedNpcs ?? [];
  return !pocketed.includes(npcId);
}

/** Run one Pickpocket attempt against `npcId`. Returns the new save
 *  with the NPC marker stamped + the loot added (either gold or a
 *  stash item). Refuses with a clear message when no Halfling is
 *  alive in the party or the NPC has already been lifted from.
 *
 *  Pure: deterministic given the RNG. Loot weights come from
 *  `PICKPOCKET_LOOT`; the gold roll is 3–15 inclusive when the
 *  `__gold__` sentinel comes up. */
export function attemptPickpocket(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef>,
  items: ReadonlyArray<StackableItemRef>,
  npcId: string,
  rng: () => number = Math.random,
): RaceAbilityResult {
  const halfling = findAliveMemberOfRace(save, characters, "halfling");
  if (!halfling) {
    return { ok: false, message: "No Halfling in the party." };
  }
  const pocketed = save.party.pickpocketedNpcs ?? [];
  if (pocketed.includes(npcId)) {
    return {
      ok: false,
      message: `${halfling.name} has already pickpocketed this NPC.`,
    };
  }
  const reward = pickWeighted(PICKPOCKET_LOOT, rng);
  const itemNameById = new Map(
    items.map((i) => [
      i.id,
      ((i as { name?: string }).name ?? i.id) as string,
    ] as const),
  );

  const nextPocketed: ReadonlyArray<string> = [...pocketed, npcId];

  if (reward === "__gold__") {
    // 3–15 inclusive, mirroring the v1 helper's `3 + floor(rng()*13)`.
    const amount = 3 + Math.floor(rng() * 13);
    const nextSave: WorldSave = {
      ...save,
      party: {
        ...save.party,
        gold: save.party.gold + amount,
        pickpocketedNpcs: nextPocketed,
      },
    };
    return {
      ok: true,
      message: `${halfling.name} pilfers ${amount} gold.`,
      nextSave,
    };
  }

  const nextInventory = addToInventory(
    save.party.inventory.map((e) => ({ ...e })),
    reward,
    items,
    1,
  );
  const nextSave: WorldSave = {
    ...save,
    party: {
      ...save.party,
      inventory: nextInventory,
      pickpocketedNpcs: nextPocketed,
    },
  };
  const itemName = itemNameById.get(reward) ?? reward;
  return {
    ok: true,
    message: `${halfling.name} swipes a ${itemName}.`,
    nextSave,
  };
}

// ── Tinker (Gnome) ────────────────────────────────────────────────

/** True when (a) an alive Gnome is in the party AND (b) `currentDay`
 *  is strictly greater than `save.party.last_tinker_day` (or that
 *  field is absent). Drives the Tinker button's enable state on the
 *  Party screen. */
export function canTinker(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef>,
  currentDay: number,
): boolean {
  if (!findAliveMemberOfRace(save, characters, "gnome")) return false;
  const last = save.party.last_tinker_day;
  if (typeof last !== "number") return true;
  return currentDay > last;
}

/** Deduped list of item ids the General Store stocks, sourced from
 *  the counters catalog's `general` entry. Items may repeat in the
 *  source (counters use repetition for purchase-weight); callers
 *  only need each id once. Returns an empty array when no general
 *  counter exists. NOTE: Tinker no longer uses this — its choices
 *  come from the ability's own `tinker_items` list (see
 *  `tinkerStockFor`). Kept as a general-purpose stock util. */
export function generalStockFor(
  counters: ReadonlyArray<RaceAbilityCounterRef>,
): ReadonlyArray<string> {
  const general = counters.find((c) => c.id === "general");
  if (!general || !Array.isArray(general.items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of general.items) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Minimal Tinker-ability shape — only the bit `tinkerStockFor`
 *  reads. The play host hands the loaded `tinker` ability record
 *  (from abilities.json) straight in; anything without a
 *  `params.tinker_items` array yields an empty stock. */
export interface TinkerAbilityRef {
  params?: Record<string, unknown> | null;
}

/** Deduped list of item ids the Tinker ability can fashion, read
 *  from the ability's `params.tinker_items`. This is now the single
 *  source of truth for the Tinker picker's choices (replacing the
 *  General Store stock). Returns an empty array when the ability is
 *  missing or defines no list — an empty list means the Gnome has
 *  nothing to tinker (strict: no implicit fallback). */
export function tinkerStockFor(
  ability: TinkerAbilityRef | null | undefined,
): ReadonlyArray<string> {
  const params = ability?.params;
  const list =
    params && typeof params === "object"
      ? (params as Record<string, unknown>).tinker_items
      : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list) {
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Run one Tinker attempt for the named item. Returns the new save
 *  with the item added to the stash + `last_tinker_day` stamped, or
 *  a refusal with the appropriate message. Validates:
 *
 *    - An alive Gnome must be in the party.
 *    - `currentDay > save.party.last_tinker_day` (once per in-game day).
 *    - `itemId` must be in the Tinker ability's `tinker_items` list —
 *      guards against a stale picker forwarding an item the module
 *      no longer offers. An empty/absent list refuses everything.
 */
export function attemptTinker(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef>,
  tinkerAbility: TinkerAbilityRef | null | undefined,
  items: ReadonlyArray<StackableItemRef>,
  itemId: string,
  currentDay: number,
): RaceAbilityResult {
  const gnome = findAliveMemberOfRace(save, characters, "gnome");
  if (!gnome) {
    return { ok: false, message: "No Gnome in the party." };
  }
  if (
    typeof save.party.last_tinker_day === "number" &&
    currentDay <= save.party.last_tinker_day
  ) {
    return {
      ok: false,
      message: `${gnome.name} has already tinkered today — try again tomorrow.`,
    };
  }
  const stock = tinkerStockFor(tinkerAbility);
  if (!stock.includes(itemId)) {
    return {
      ok: false,
      message: `${itemId} isn't something a Gnome can tinker up.`,
    };
  }
  // Stackable items (arrows, bolts, stones, lockpicks, …) craft as a
  // full bundle — the catalog's `charges` count — so Tinker matches
  // the General Store's purchase payout and the Ranger arrow craft.
  // Non-stackable items add a single copy.
  const count = bundleSizeFor(itemId, items);
  const nextInventory = addToInventory(
    save.party.inventory.map((e) => ({ ...e })),
    itemId,
    items,
    count,
  );
  const nextSave: WorldSave = {
    ...save,
    party: {
      ...save.party,
      inventory: nextInventory,
      last_tinker_day: currentDay,
    },
  };
  const itemNameById = new Map(
    items.map((i) => [
      i.id,
      ((i as { name?: string }).name ?? i.id) as string,
    ] as const),
  );
  const itemName = itemNameById.get(itemId) ?? itemId;
  const message =
    count > 1
      ? `${gnome.name} tinkers up a bundle of ${count} ${itemName}.`
      : `${gnome.name} tinkers up a ${itemName}.`;
  return {
    ok: true,
    message,
    nextSave,
  };
}
