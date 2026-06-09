/**
 * Play-side adapters for class-active craft abilities — the
 * Ranger's `craft_arrows` (a bundle of regular Arrows or Bolts)
 * and `craft_fire_arrows` (a bundle of Fire Arrows). Both follow
 * the same shape as Gnome Tinker but the stock list is fixed per
 * ability instead of pulled from the General Store, and each
 * ability ticks against its own once-per-day counter so a Ranger
 * can craft normal arrows AND fire arrows on the same day.
 *
 * Per-ability persistence lives in `save.party.last_ability_day`
 * (a generic id → dayIndex record on SavedPartyState) so adding a
 * future per-day class ability is purely a code change here — no
 * new save-shape field needed.
 *
 * Pure helpers; the play overlay (PlayPartyScreenOverlay) calls
 * them with the live save + the relevant catalog slices and
 * commits the returned next-save. The shared `RaceAbilityResult`
 * shape from `./raceAbilities` is reused so the host can route
 * craft outcomes through the same banner / placard / SFX channels
 * as Tinker.
 */

import type { WorldSave } from "./saveTypes";
import {
  addToInventory,
  bundleSizeFor,
  type StackableItemRef,
} from "./inventoryStacking";
import type {
  RaceAbilityCharacterRef,
  RaceAbilityResult,
} from "./raceAbilities";

/** Per-ability stock list — the items the picker is allowed to
 *  offer. Kept as a single source of truth so the eligibility
 *  check and the picker UI agree on the universe. Adding a new
 *  craft ability is a one-line addition here plus the matching
 *  abilities.json record + min_level wiring on the class.
 *
 *  Item ids are the v2 snake_case keys from items.json. Both
 *  craft abilities offer the bow + crossbow flavours of their
 *  ammo so a Ranger wielding a crossbow isn't stuck crafting
 *  ammo they can't load. All four ids are stackable (charges = 20
 *  per bundle); `addToInventory` merges into existing stash rows. */
const CRAFT_STOCK: Readonly<Record<string, ReadonlyArray<string>>> = {
  craft_arrows: ["arrows", "bolts"],
  craft_fire_arrows: ["fire_arrows", "fire_bolts"],
};

/** What the craft picker should list for `abilityId`. Returns an
 *  empty array for unknown ids — defensive: a future class
 *  ability that someone wired without updating the stock map
 *  shouldn't crash the UI, just present nothing to pick. */
export function craftStockFor(abilityId: string): ReadonlyArray<string> {
  return CRAFT_STOCK[abilityId] ?? [];
}

/** Find the first alive party member whose CLASS matches `classId`
 *  (case-insensitive). Mirrors {@link findAliveMemberOfRace} from
 *  `raceAbilities.ts`; kept separate so each ability family reads
 *  off the relevant identity field without a generic "by predicate"
 *  helper. Returns null when no qualifying member is alive. */
export function findAliveMemberOfClass(
  save: WorldSave,
  characters: ReadonlyArray<
    RaceAbilityCharacterRef & { class?: string }
  >,
  classId: string,
): { id: string; name: string } | null {
  const k = classId.toLowerCase();
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  for (const m of save.party.members) {
    if (m.hp <= 0) continue;
    const cat = charById.get(m.id);
    if (!cat) continue;
    if ((cat.class ?? "").toLowerCase() !== k) continue;
    return { id: m.id, name: cat.name ?? m.id };
  }
  return null;
}

/** True when (a) an alive {classId} is in the party AND (b) the
 *  per-ability day counter is strictly less than `currentDay` (or
 *  absent). Drives the Use button's enable state on the character
 *  sheet — the sheet itself only renders class abilities for the
 *  displayed member (gated by `min_level`), so this gate is the
 *  per-day check on top of that. */
export function canCraft(
  save: WorldSave,
  characters: ReadonlyArray<
    RaceAbilityCharacterRef & { class?: string }
  >,
  classId: string,
  abilityId: string,
  currentDay: number,
): boolean {
  if (!findAliveMemberOfClass(save, characters, classId)) return false;
  const last = save.party.last_ability_day?.[abilityId];
  if (typeof last !== "number") return true;
  return currentDay > last;
}

/** Run one Craft attempt for the named item under the named
 *  ability. Returns the new save with the item added + the
 *  per-ability day counter stamped, or a refusal with the matching
 *  message. Validates:
 *
 *    - An alive member of `classId` must be in the party.
 *    - `currentDay > last_ability_day[abilityId]` (once per day,
 *      per ability — independent of other craft abilities).
 *    - `itemId` must be in the per-ability stock list — guards
 *      against a stale picker forwarding an item the ability
 *      doesn't authorize.
 */
export function attemptCraft(
  save: WorldSave,
  characters: ReadonlyArray<
    RaceAbilityCharacterRef & { class?: string }
  >,
  items: ReadonlyArray<StackableItemRef>,
  classId: string,
  abilityId: string,
  itemId: string,
  currentDay: number,
): RaceAbilityResult {
  const member = findAliveMemberOfClass(save, characters, classId);
  if (!member) {
    return { ok: false, message: `No ${capitalise(classId)} in the party.` };
  }
  const last = save.party.last_ability_day?.[abilityId];
  if (typeof last === "number" && currentDay <= last) {
    return {
      ok: false,
      message: `${member.name} has already used this ability today — try again tomorrow.`,
    };
  }
  const stock = craftStockFor(abilityId);
  if (!stock.includes(itemId)) {
    return {
      ok: false,
      message: `${itemId} isn't something this ability can craft.`,
    };
  }
  const count = bundleSizeFor(itemId, items);
  const nextInventory = addToInventory(
    save.party.inventory.map((e) => ({ ...e })),
    itemId,
    items,
    count,
  );
  const nextLastAbilityDay: Record<string, number> = {
    ...(save.party.last_ability_day ?? {}),
    [abilityId]: currentDay,
  };
  const nextSave: WorldSave = {
    ...save,
    party: {
      ...save.party,
      inventory: nextInventory,
      last_ability_day: nextLastAbilityDay,
    },
  };
  const itemNameById = new Map(
    items.map((i) => [
      i.id,
      ((i as { name?: string }).name ?? i.id) as string,
    ] as const),
  );
  const itemName = itemNameById.get(itemId) ?? itemId;
  // Bundle count surfaces in the player-facing line so the player
  // sees the same "20 Arrows" payout shape the shop produces — the
  // craft-vs-shop parity is the whole point of the bundle rule.
  const message =
    count > 1
      ? `${member.name} crafts a bundle of ${count} ${itemName}.`
      : `${member.name} crafts a ${itemName}.`;
  return {
    ok: true,
    message,
    nextSave,
  };
}

/** Tiny "Title-case the class id" helper for the no-class-in-party
 *  refusal line. Avoids leaking snake_case ("ranger") into a
 *  player-facing message. */
function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}
