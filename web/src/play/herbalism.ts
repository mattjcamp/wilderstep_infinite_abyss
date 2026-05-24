/**
 * Play-side adapter for the class-passive Herbalism ability.
 *
 * Herbalism trickles potion reagents into the party stash as the
 * party walks foraging terrain (grass, forest, etc.). Each step on
 * a qualifying tile has a small chance to turn up a reagent; the
 * holder's class governs the rate (Alchemist: doubled). Druid and
 * Alchemist both ship with `herbalism` in their class abilities
 * record (min_level: 1), so a level-1 hero is enough to enable it.
 *
 * Pure helper, same shape as `raceAbilities` / `craftAbilities`:
 *   - Inputs: the live save, alive party roster (catalog refs with
 *     class), the items catalog (used to derive the reagent pool +
 *     to drive the inventory-stack merge), the abilities catalog
 *     (used to read the ability's data-driven knobs — find chance,
 *     alchemist multiplier, foraging terrain list), the current
 *     tile id (the step's destination), and an RNG.
 *   - Output: `HerbalismFindResult` — `{ found: null }` when no
 *     reagent surfaced (the common case), or
 *     `{ found: { itemId, itemName, finderName }, nextSave }` when
 *     the roll hit. Callers commit `nextSave` and surface the find
 *     in the log + as a subtle cue at the party tile.
 *
 * Data-driven on three axes so future content edits are no-code:
 *   - The qualifying tile list comes from the ability's
 *     `params.terrain` array (set in abilities.json). Adding a new
 *     foraging tile means dropping its id into that array.
 *   - The reagent pool comes from items.json: every item with
 *     `item_type === "reagent"` or `item_type === "herb"` is fair
 *     game. Adding a new reagent to items.json adds it to the pool
 *     automatically.
 *   - Find chance + alchemist multiplier come from `params` too,
 *     so a designer can rebalance without a code change.
 *
 * Tests cover the gate (no holder = no roll), the tile filter, the
 * RNG path (success commits + returns, miss returns `found: null`),
 * the Alchemist doubled rate, and the inventory merge.
 */

import type { WorldSave } from "./saveTypes";
import { addToInventory, type StackableItemRef } from "./inventoryStacking";

/** Minimal catalog character shape — `id` to map back to the saved
 *  member, `class` (lowercased) to gate on Druid / Alchemist,
 *  `name` for the log line. Subset of `SimCharacter` so callers
 *  can pass either without a cast. Mirrors the shape used by the
 *  class-craft helpers. */
export interface HerbalismCharacterRef {
  id: string;
  name?: string;
  class?: string;
}

/** Minimal item-catalog shape Herbalism needs. `id` + `stackable`
 *  + `charges` mirror the addToInventory inputs (stack-merge is
 *  the same path the shop / craft helpers use). `name` powers the
 *  log line. `item_type` is the discriminator that says "this is
 *  a reagent" — anything tagged `reagent` or `herb` joins the
 *  drop pool. */
export interface HerbalismItemRef extends StackableItemRef {
  name?: string;
  item_type?: string;
}

/** Minimal ability-catalog shape Herbalism needs — `id` to find
 *  the record, `params` for the data-driven knobs (`find_chance`,
 *  `alchemist_multiplier`, `terrain`). All three fall back to
 *  hard defaults when absent so a thin catalog still produces
 *  *some* gameplay (rather than silently zeroing the rate). */
export interface HerbalismAbilityRef {
  id: string;
  params?: {
    find_chance?: number;
    alchemist_multiplier?: number;
    terrain?: ReadonlyArray<string>;
  } | null;
}

/** Outcome of a single herbalism roll. `found` is null on the
 *  miss path; on a hit it carries the item + finder for the
 *  caller's log line + cue. `nextSave` is only present on a hit
 *  — miss path doesn't mutate the save so there's nothing to
 *  commit. */
export interface HerbalismFindResult {
  found: null | {
    itemId: string;
    itemName: string;
    finderName: string;
    finderId: string;
  };
  nextSave?: WorldSave;
}

/** Hard defaults — used when the ability catalog is missing or
 *  doesn't carry the matching `params` keys. Chosen to match the
 *  shipped values in `abilities.json` (2% base, 2x for Alchemist,
 *  grass/forest set) so a no-catalog test fixture still produces
 *  the same probabilities the live game does. */
const DEFAULT_FIND_CHANCE = 0.02;
const DEFAULT_ALCHEMIST_MULTIPLIER = 2;
const DEFAULT_TERRAIN: ReadonlyArray<string> = [
  "grass",
  "grass2",
  "forest",
  "palm_tree",
];

/** Class ids that ship with Herbalism (the abilities are listed
 *  on each class record in character_classes.json). Hard-coded
 *  here rather than re-derived from the catalog because the
 *  rate-doubling rule is class-specific (Alchemist gets 2x) and
 *  the engine needs to know WHO ranks higher when both are
 *  present. Adding a future herbalist class is a one-line edit
 *  here + the catalog record. */
const HERBALIST_CLASSES = new Set(["druid", "alchemist"]);
const ALCHEMIST_CLASS = "alchemist";

/** Find the alive party member who currently provides the best
 *  herbalism rate. Returns the member (catalog ref) AND the
 *  effective chance per step the engine should roll against.
 *  When multiple herbalists are alive the engine picks the highest
 *  effective rate — typically the Alchemist's doubled chance over
 *  a Druid's baseline. Returns null when no qualifying member is
 *  alive (the gate that makes Herbalism inert for non-herbalist
 *  parties). */
function bestHerbalist(
  save: WorldSave,
  characters: ReadonlyArray<HerbalismCharacterRef>,
  baseChance: number,
  alchemistMultiplier: number,
): { member: HerbalismCharacterRef; chance: number } | null {
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  let best: { member: HerbalismCharacterRef; chance: number } | null = null;
  for (const m of save.party.members) {
    if (m.hp <= 0) continue;
    const cat = charById.get(m.id);
    if (!cat) continue;
    const klass = (cat.class ?? "").toLowerCase();
    if (!HERBALIST_CLASSES.has(klass)) continue;
    const chance =
      klass === ALCHEMIST_CLASS
        ? baseChance * alchemistMultiplier
        : baseChance;
    if (best === null || chance > best.chance) {
      best = { member: cat, chance };
    }
  }
  return best;
}

/** Pull the foraging tile whitelist from the herbalism ability
 *  catalog, falling back to the shipped defaults if the catalog
 *  doesn't carry one. Exported so callers (the wiring in PlayHost,
 *  but also future per-tile "show forageable" hint UI) can check
 *  whether a tile qualifies without standing up the rest of the
 *  helper. */
export function herbalismTerrain(
  abilities: ReadonlyArray<HerbalismAbilityRef>,
): ReadonlyArray<string> {
  const rec = abilities.find((a) => a.id === "herbalism");
  const list = rec?.params?.terrain;
  return Array.isArray(list) && list.length > 0 ? list : DEFAULT_TERRAIN;
}

/** Derive the reagent pool from the items catalog. Anything
 *  whose `item_type` is `reagent` or `herb` is fair game. Pure
 *  filter so adding a new reagent in items.json automatically
 *  joins the pool — no second registry to maintain. */
export function herbalismReagentPool(
  items: ReadonlyArray<HerbalismItemRef>,
): ReadonlyArray<HerbalismItemRef> {
  return items.filter((i) => {
    const t = (i.item_type ?? "").toLowerCase();
    return t === "reagent" || t === "herb";
  });
}

/**
 * Roll one Herbalism step against `tileId`. Returns `found: null`
 * on every miss (the overwhelmingly common case). On a hit, returns
 * the item that was found, the finder's name + id, and the next
 * save with the reagent already merged into the party stash.
 *
 * Skips early (no rng draw) on three short-circuit paths:
 *   - No alive party member with a herbalism class → gate closed.
 *   - The stepped-on tile id isn't on the foraging whitelist.
 *   - The catalog has no reagent items at all (defensive — a thin
 *     module without reagents shouldn't crash, just no finds).
 */
export function herbalismOnStep(
  save: WorldSave,
  characters: ReadonlyArray<HerbalismCharacterRef>,
  items: ReadonlyArray<HerbalismItemRef>,
  abilities: ReadonlyArray<HerbalismAbilityRef>,
  tileId: string | null | undefined,
  rng: () => number = Math.random,
): HerbalismFindResult {
  if (typeof tileId !== "string" || tileId.length === 0) {
    return { found: null };
  }
  const terrain = herbalismTerrain(abilities);
  if (!terrain.includes(tileId)) return { found: null };
  const rec = abilities.find((a) => a.id === "herbalism");
  const baseChance =
    typeof rec?.params?.find_chance === "number"
      ? rec.params.find_chance
      : DEFAULT_FIND_CHANCE;
  const alchemistMultiplier =
    typeof rec?.params?.alchemist_multiplier === "number"
      ? rec.params.alchemist_multiplier
      : DEFAULT_ALCHEMIST_MULTIPLIER;
  const holder = bestHerbalist(save, characters, baseChance, alchemistMultiplier);
  if (!holder) return { found: null };
  if (rng() >= holder.chance) return { found: null };
  const pool = herbalismReagentPool(items);
  if (pool.length === 0) return { found: null };
  // Uniform pick across the pool — the user explicitly asked to
  // keep this simple (no tile-keyed sub-pools, no rarity weights).
  // floor(rng() * N) is the standard cheap uniform draw; the rng
  // contract is [0, 1) so we never read pool[N].
  const pick = pool[Math.floor(rng() * pool.length)];
  const nextInventory = addToInventory(
    save.party.inventory.map((e) => ({ ...e })),
    pick.id,
    items,
    1,
  );
  const nextSave: WorldSave = {
    ...save,
    party: {
      ...save.party,
      inventory: nextInventory,
    },
  };
  return {
    found: {
      itemId: pick.id,
      itemName: pick.name ?? pick.id,
      finderName: holder.member.name ?? holder.member.id,
      finderId: holder.member.id,
    },
    nextSave,
  };
}
