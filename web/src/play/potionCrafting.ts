/**
 * Play-side adapter for the Alchemist's `brew_potion` ability.
 *
 * Brewing is the consumption side of the Herbalism economy: the
 * Alchemist combines reagents (gathered via Herbalism, bought
 * from a counter, or pickpocketed) following a recipe to produce
 * a finished potion. Recipes live in `recipes.json` with the
 * shape `{ id, name, result_item, reagents: { [reagentId]: count } }`.
 *
 * No per-day gate — the consumed reagents ARE the limit. A player
 * who stockpiles 20 spring_water + 20 moonpetal can brew 20
 * healing potions in a row; that's a fair trade for the foraging
 * grind. Matches the recipe-catalog comment which defers cooldown
 * mechanics until they're needed.
 *
 * Pure helper, same shape as `craftAbilities.ts` / `raceAbilities.ts`:
 *   - Inputs: live save, alive party roster (catalog refs with
 *     class), the items catalog (drives stack semantics on the
 *     reagent consume AND the potion add), the recipes catalog,
 *     and the chosen recipe id.
 *   - Output: `RaceAbilityResult` — `{ ok: false, message }` for
 *     the gated refusals (no Alchemist, missing reagents,
 *     unknown recipe), `{ ok: true, message, nextSave }` on
 *     success. Callers commit `nextSave` and surface `message`
 *     in the log / placard.
 *
 * Listing helpers (`canBrew`, `recipeShortages`,
 * `availableRecipes`) live alongside `attemptBrew` so the picker
 * UI can render an at-a-glance "ready to brew" indicator next to
 * each recipe without duplicating the validation math.
 */

import type { WorldSave } from "./saveTypes";
import {
  addToInventory,
  type InventoryEntry,
  type StackableItemRef,
} from "./inventoryStacking";
import type {
  RaceAbilityCharacterRef,
  RaceAbilityResult,
} from "./raceAbilities";

/** Catalog recipe shape — mirrors the recipes.json record. The
 *  `reagents` map keys are item ids; values are integer counts.
 *  `result_item` is the produced item's id; produced count is 1
 *  per brew (the recipe schema doesn't yet encode a yield field). */
export interface RecipeRef {
  id: string;
  name?: string;
  result_item: string;
  reagents: Record<string, number>;
}

/** The class that gets `brew_potion`. Hard-coded because there's
 *  only one (Alchemist) and the gate logic is class-specific. A
 *  future class that gets brew_potion would join this set. */
const BREWER_CLASSES = new Set(["alchemist"]);

/** Find the first alive party member whose class can brew (today:
 *  Alchemist). Mirrors {@link findAliveMemberOfClass} from
 *  craftAbilities.ts but checks against the brewer-class set so a
 *  future second brewer class folds in without changing every
 *  call site. Returns null when no qualifying member is alive. */
export function findAliveBrewer(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef & { class?: string }>,
): { id: string; name: string } | null {
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  for (const m of save.party.members) {
    if (m.hp <= 0) continue;
    const cat = charById.get(m.id);
    if (!cat) continue;
    const klass = (cat.class ?? "").toLowerCase();
    if (!BREWER_CLASSES.has(klass)) continue;
    return { id: m.id, name: cat.name ?? m.id };
  }
  return null;
}

/** True when an alive brewer is in the party (i.e. the Use button
 *  on the character sheet should enable). Mirrors {@link canCraft}
 *  in shape; no per-day check here because Brew is reagent-gated,
 *  not time-gated. */
export function canBrew(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef & { class?: string }>,
): boolean {
  return findAliveBrewer(save, characters) !== null;
}

/** Count how many of `itemId` the party currently holds across
 *  all inventory rows. For stackable items each row's quantity
 *  comes from `entry.charges ?? 1`; for non-stackable items each
 *  row counts as 1 (with the catalog's `stackable` flag making
 *  the call). Returns 0 for absent items. */
function partyCountOf(
  inv: ReadonlyArray<InventoryEntry>,
  itemId: string,
  items: ReadonlyArray<StackableItemRef>,
): number {
  const def = items.find((i) => i.id === itemId);
  const stackable = !!def?.stackable;
  let total = 0;
  for (const e of inv) {
    if (e.item !== itemId) continue;
    total += stackable ? e.charges ?? 1 : 1;
  }
  return total;
}

/** Per-reagent shortage map for a recipe — `{ reagentId: missingCount }`
 *  for any reagent the party can't fully supply, empty when the
 *  party can brew the recipe right now. Drives the picker's
 *  "missing 2x serpent_root" hover hint AND short-circuits the
 *  attempt validator below. */
export function recipeShortages(
  save: WorldSave,
  recipe: RecipeRef,
  items: ReadonlyArray<StackableItemRef>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [reagentId, needed] of Object.entries(recipe.reagents)) {
    const have = partyCountOf(save.party.inventory, reagentId, items);
    if (have < needed) {
      out[reagentId] = needed - have;
    }
  }
  return out;
}

/** Filter the catalog to recipes whose reagents the party can
 *  fully supply right now. Used by the picker to surface the
 *  ready-to-brew list as a fast top-of-screen prompt; the picker
 *  still renders the rest (greyed out) so the player can see
 *  what they need to forage for. */
export function availableRecipes(
  save: WorldSave,
  recipes: ReadonlyArray<RecipeRef>,
  items: ReadonlyArray<StackableItemRef>,
): RecipeRef[] {
  return recipes.filter(
    (r) => Object.keys(recipeShortages(save, r, items)).length === 0,
  );
}

/** Consume `count` of `itemId` from the inventory. For stackable
 *  items the first matching row's `charges` is decremented (the
 *  row is spliced when charges hit 0); for non-stackable items
 *  `count` rows are spliced. Returns a NEW array — caller assigns
 *  / commits. Defensive: returns the input unchanged when the
 *  count to remove exceeds what's available (the caller should
 *  have validated against shortages first; this guard prevents a
 *  corrupted save in the worst case). */
function removeFromInventory(
  inv: ReadonlyArray<InventoryEntry>,
  itemId: string,
  items: ReadonlyArray<StackableItemRef>,
  count: number,
): InventoryEntry[] {
  if (count <= 0) return inv.map((e) => ({ ...e }));
  const def = items.find((i) => i.id === itemId);
  const stackable = !!def?.stackable;
  let next: InventoryEntry[] = inv.map((e) => ({ ...e }));
  let remaining = count;
  if (stackable) {
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const row = next[i];
      if (row.item !== itemId) continue;
      const have = row.charges ?? 1;
      const take = Math.min(have, remaining);
      const left = have - take;
      remaining -= take;
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

/**
 * Brew one potion from `recipeId`. Validates the gate (alive
 * Alchemist), the recipe's existence, and the party's reagent
 * supply. On success: removes the recipe's reagent costs from
 * the party stash, adds the produced potion (single copy), and
 * returns the new save. Failure messages explain to the player
 * what's missing so the picker can surface them.
 */
export function attemptBrew(
  save: WorldSave,
  characters: ReadonlyArray<RaceAbilityCharacterRef & { class?: string }>,
  items: ReadonlyArray<StackableItemRef>,
  recipes: ReadonlyArray<RecipeRef>,
  recipeId: string,
): RaceAbilityResult {
  const brewer = findAliveBrewer(save, characters);
  if (!brewer) {
    return { ok: false, message: "No Alchemist in the party." };
  }
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    return { ok: false, message: `Unknown recipe: ${recipeId}.` };
  }
  const shortages = recipeShortages(save, recipe, items);
  const missing = Object.entries(shortages);
  if (missing.length > 0) {
    // Surface the first missing reagent in the message — the
    // picker can render the full shortage map separately, but
    // the log line wants a single explainable miss.
    const [firstId, firstCount] = missing[0];
    const firstName =
      (items.find((i) => i.id === firstId) as { name?: string } | undefined)
        ?.name ?? firstId;
    return {
      ok: false,
      message: `${brewer.name} is missing ${firstCount}× ${firstName} to brew ${recipe.name ?? recipe.id}.`,
    };
  }
  // Consume reagents, then add the produced potion. Order matters
  // only when a recipe's result_item happens to equal one of its
  // reagent ids (currently never), in which case the consume
  // needs to land before the add so the net result is correct.
  let nextInventory: InventoryEntry[] = save.party.inventory.map((e) => ({ ...e }));
  for (const [reagentId, needed] of Object.entries(recipe.reagents)) {
    nextInventory = removeFromInventory(nextInventory, reagentId, items, needed);
  }
  nextInventory = addToInventory(nextInventory, recipe.result_item, items, 1);
  const nextSave: WorldSave = {
    ...save,
    party: {
      ...save.party,
      inventory: nextInventory,
    },
  };
  const potionName =
    (items.find((i) => i.id === recipe.result_item) as { name?: string } | undefined)
      ?.name ?? recipe.result_item;
  return {
    ok: true,
    message: `${brewer.name} brews a ${potionName}.`,
    nextSave,
  };
}
