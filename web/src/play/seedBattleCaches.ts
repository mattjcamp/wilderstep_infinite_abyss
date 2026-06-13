/**
 * seedBattleCaches — feed v1battle's data layer the inheritance-aware
 * merged catalogs the play save expects.
 *
 * Background. CombatScene (under src/battle/) still uses v1battle's
 * loaders, which call `fetch(modulePath("X.json"))`. That path is a
 * flat /modules/<active>/<file> lookup — it does NOT walk the v2
 * `extends` chain. So a module like `test` that extends `default`
 * and ships only the files it overrides (often nothing) sees 404s on
 * every catalog, and CombatScene falls back to its hand-built demo
 * party + empty items/spells/monsters.
 *
 * The editor side already solves this through `StaticModuleSource +
 * mergeModel`, which knows about `extends` and merges records by id.
 * This module re-uses that machinery, fetches the *merged* JSON for
 * each catalog the combat path needs, then pushes the data into v1's
 * caches so the in-Phaser loaders short-circuit and never hit the
 * network.
 *
 * Two cache-seeding strategies are used, depending on what each
 * v1battle loader exposes:
 *
 *   - For the `load*(url?)` family (Items, Spells, Monsters, Races,
 *     Effects), we wrap the merged JSON in a Blob and pass that as
 *     the URL. The loader's existing fetch+parse pipeline runs
 *     against the blob; the cache populates; future `load*()` calls
 *     return the cached value without ever touching /modules/.
 *
 *   - For Party (no `url` parameter and a more involved construction
 *     pulling roster ids against a characters catalog), we build the
 *     v1 `Party` object directly from the save's authoritative state
 *     (custom characters, HP/MP overrides, current position, gold,
 *     stash) and call `_setPartyCache` — the test-only setter
 *     already exported alongside `_clearPartyCache`.
 *
 * The helper also clears every cache up front so a different play
 * session (different module, "New Game" after a wipe) doesn't reuse
 * stale data from the previous run.
 *
 * Performance: the seeded data is reused across every fight in the
 * play session. The cost (a handful of fetches + JSON parses) lands
 * on the first combat boot, not every encounter.
 */

import { getModuleSource } from "@/data_model/sourceConfig";
import { mergeModel } from "@/data_model/merge";
import type { ModelKey } from "@/data_model/models";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  _clearItemsCache,
  loadItems,
} from "@/battle/world/Items";
import { _clearSpellsCache, loadSpells } from "@/battle/world/Spells";
import {
  _clearAbilitiesCache,
  abilityFromRaw,
  _setAbilitiesCache,
  type Ability,
} from "@/battle/world/Abilities";
import { _clearMonstersCache, loadMonsters } from "@/battle/data/monsters";
import {
  _clearClassCaches,
  _setClassCatalog,
  loadRaces,
} from "@/battle/world/Classes";
import { _clearEffectsCache, loadEffects } from "@/battle/world/Effects";
import { _clearCountersCache, loadCounters } from "@/battle/world/Counters";
import {
  seedSpriteRouting,
  clearSpriteRouting,
} from "@/data_model/spriteUrl";
import {
  _clearPartyCache,
  _setPartyCache,
  memberFromRaw,
  partyFromRaw,
  type Party,
  type PartyMember,
} from "@/battle/world/Party";
import { gameState } from "@/battle/state";
import type { CharacterRecord } from "@/editor/CharacterSheet";
import type { WorldSave } from "./saveTypes";

/** Build a /-prefixed blob URL containing `json`. Returned URL is
 *  good for one fetch — caller revokes after the loader resolves so
 *  we don't leak object URLs. */
function jsonBlobUrl(json: unknown): string {
  const blob = new Blob([JSON.stringify(json)], {
    type: "application/json",
  });
  return URL.createObjectURL(blob);
}

/** Run `loader(url)` against a blob-backed URL and revoke the URL
 *  after the loader settles. Errors are surfaced — callers want to
 *  know if a merge step produced something the loader can't parse. */
async function seedViaBlob<T>(
  json: unknown,
  loader: (url: string) => Promise<T>,
): Promise<T> {
  const url = jsonBlobUrl(json);
  try {
    return await loader(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetch a model's merged JSON for `moduleId`, walking the v2
 *  `extends` chain. Returns the parsed JSON (the `{ items: [...] }`
 *  outer object, NOT just the inner array) so it matches the shape
 *  v1's loaders expect from `fetch().json()`. Returns null when
 *  the model is absent everywhere in the chain — caller decides
 *  whether that's fatal or whether v1's empty-catalog fallback is
 *  acceptable. */
async function loadMergedModel(
  src: StaticModuleSource,
  moduleId: string,
  modelKey: ModelKey,
): Promise<unknown | null> {
  try {
    const layers = await src.loadModelLayers(moduleId, modelKey);
    const merged = mergeModel(modelKey, layers.inherited, layers.ownFile);
    return merged ?? null;
  } catch {
    return null;
  }
}

/** Counters are the one combat catalog whose v1 loader shape differs
 *  from the v2 model file. `loadCounters` / `parseCounters` expect a
 *  BARE object keyed by shop type — `{ general: {...}, weapon: {...} }`
 *  — whereas the v2 `counters` model (collectionKey "counters") merges
 *  to `{ counters: [ { id, name, items, … } ] }`. Re-key the merged
 *  collection by each entry's `id` (which IS the shop type) so the
 *  blob we seed matches what `loadCounters` would have fetched.
 *
 *  Without this, `CombatScene`'s direct `loadCounters()` (loot-drop
 *  pool) hits `modulePath("counters.json")` — wrong origin in remote
 *  mode (404), and even on the static origin the v2 collection file
 *  mis-parses — so loot never drops. Seeding fixes both. */
export function countersToRawMap(
  merged: unknown,
): Record<string, unknown> {
  const list =
    (merged as { counters?: Array<Record<string, unknown>> } | null)
      ?.counters ?? [];
  const out: Record<string, unknown> = {};
  for (const c of list) {
    if (!c || typeof c.id !== "string") continue;
    out[c.id] = {
      name: c.name,
      description: c.description,
      items: c.items,
      kind: c.kind,
      services: c.services,
    };
  }
  return out;
}

/** Build the v1 `Party` object from the save + the module's merged
 *  characters catalog. */
function buildPartyFromSave(
  save: WorldSave,
  mergedCharacters: { characters?: CharacterRecord[] } | null,
): Party {
  // Combine module characters with the save's custom characters into
  // a single id-keyed map. Custom characters live only in the save;
  // they're not in characters.json. Then apply the save's HP/MP
  // overrides so a mid-adventure return has the right vitals.
  const moduleChars = mergedCharacters?.characters ?? [];
  const customChars = save.party.members
    .filter((m) => m.custom)
    .map((m) => m.custom as CharacterRecord);
  const overridesById = new Map(
    save.party.members.map((m) => [m.id, m]),
  );
  const charactersById = new Map<string, PartyMember>();
  for (const raw of [...moduleChars, ...customChars]) {
    if (!raw?.id) continue;
    const override = overridesById.get(raw.id);
    // Stamp the save's HP/MP onto the raw record BEFORE memberFromRaw
    // so the resulting PartyMember carries the in-play vitals (and
    // max_hp / max_mp track the saved peak rather than the catalog
    // default — close enough for v0; a proper peak field comes later).
    // Saved `equipped` overlays the catalog's authored loadout too,
    // so a player who swapped weapons in the Party screen carries
    // that swap into combat rather than reverting to the starting
    // kit when a fight starts. Saved `inventory` carries
    // per-instance `durability` for non-stackable gear; it flows
    // through `normalizeInventory` since the field is a permissive
    // extra on the InventoryItem shape.
    const withSaved = override
      ? {
          ...raw,
          hp: override.hp,
          mp: override.mp,
          // Forward the on-save peak so memberFromRaw can keep
          // max_hp / max_mp truly maxed for wounded characters.
          // Without these, max collapses to current and a 5/9
          // wounded member shows as 5/5 in combat — looking
          // misleadingly "full" while actually still wounded.
          ...(typeof override.max_hp === "number"
            ? { max_hp: override.max_hp }
            : {}),
          ...(typeof override.max_mp === "number"
            ? { max_mp: override.max_mp }
            : {}),
          // Honour the save's persisted level + exp so the next fight
          // starts the live PartyMember at the player's actual
          // progress. Without this overlay, combat seeds from the
          // catalog (typically level 1, exp 0) and any pending
          // level-up — including XP banked at quest turn-in — is
          // silently reset, so awardXp's threshold check after the
          // fight runs against a stale baseline.
          ...(typeof override.level === "number"
            ? { level: override.level }
            : {}),
          ...(typeof override.exp === "number"
            ? { exp: override.exp }
            : {}),
          ...(override.equipped
            ? { equipped: { ...override.equipped } }
            : {}),
          ...(override.inventory
            ? { inventory: override.inventory.map((e) => ({ ...e })) }
            : {}),
        }
      : raw;
    const member = memberFromRaw(withSaved);
    // Seed the runtime equipped_durability tracker from the saved
    // map. `memberFromRaw` initialises both slots to null (lazy-init
    // to max on first hit); the saved snapshot wins when present so
    // wear survives across reload-mid-adventure without needing the
    // player to unequip/re-equip.
    if (override?.equipped_durability) {
      const ed = override.equipped_durability;
      if (typeof ed.hands === "number" || ed.hands === null) {
        member.equipped_durability.hands = ed.hands;
      }
      if (typeof ed.body === "number" || ed.body === null) {
        member.equipped_durability.body = ed.body;
      }
    }
    charactersById.set(raw.id, member);
  }
  // Synthesize the raw party.json shape from the save, then run it
  // through partyFromRaw so we get the same construction the live
  // loader would have produced.
  const rawParty = {
    start_position: {
      map_id: save.party.currentMapId,
      col: save.party.col,
      row: save.party.row,
    },
    avatar: save.party.avatar,
    gold: save.party.gold,
    roster: [...save.party.roster],
    party_effects: [],
    inventory: [...save.party.inventory],
    torch_steps: save.party.torch_steps,
    magic_light_steps: 0,
  };
  return partyFromRaw(rawParty, charactersById);
}

/** Clear every v1battle cache this module seeds. Called at the start
 *  of every seed so a different play session (new module, post-wipe
 *  restart) doesn't accidentally reuse the prior run's data.
 *
 *  Also nulls out `gameState.partyData`. That global is a SECOND
 *  party cache, separate from `_setPartyCache` — CombatScene boots
 *  with `if (!gameState.partyData) gameState.partyData = await
 *  loadParty();`, so a non-null value here is reused *as-is* without
 *  re-fetching. Without this reset, a player who took damage in
 *  combat 1, rested via the Party screen (saveRef and the v1 party
 *  cache both updated to healed HP), and walked into combat 2 would
 *  see the stale wounded gameState.partyData from combat 1 used by
 *  the new fight, completely bypassing the rest. The bug was
 *  invisible to unit tests because it lives in module-scope global
 *  state.
 */
function clearAllSeededCaches(): void {
  _clearItemsCache();
  _clearSpellsCache();
  _clearAbilitiesCache();
  _clearMonstersCache();
  _clearClassCaches();
  _clearEffectsCache();
  _clearCountersCache();
  _clearPartyCache();
  clearSpriteRouting();
  gameState.partyData = null;
}

/**
 * Seed every v1battle cache CombatScene reads from with merged
 * (inheritance-aware) data. Resolves once every cache the next
 * `CombatScene` boot needs is in place; the scene's `loadX()` calls
 * become cache hits and never touch /modules/<id>/.
 *
 * Errors during a single catalog's merge are tolerated — the
 * corresponding v1 cache stays empty and CombatScene's existing
 * "warn + degrade" path handles it (Cast disabled when spells is
 * empty, etc.). Errors during the party build ARE fatal because
 * combat with no party is meaningless; the caller should surface
 * that as a play-side error.
 */
export async function seedBattleCaches(
  moduleId: string,
  save: WorldSave,
): Promise<void> {
  clearAllSeededCaches();
  // Seed sprite routing before any URL baking: the monster + party
  // hydration below (resolveSpriteUrl / spriteForMember) reads it to
  // point custom art at the worker. After clearAllSeededCaches (which
  // resets routing too) so this wins. No-op off the remote/hosted path.
  await seedSpriteRouting(moduleId);
  const src = getModuleSource();

  // Kick every load in parallel — they're independent.
  const [
    items,
    spells,
    abilities,
    monsters,
    races,
    effects,
    counters,
    characters,
    characterClasses,
  ] = await Promise.all([
    loadMergedModel(src, moduleId, "items"),
    loadMergedModel(src, moduleId, "spells"),
    loadMergedModel(src, moduleId, "abilities"),
    loadMergedModel(src, moduleId, "monsters"),
    loadMergedModel(src, moduleId, "races"),
    loadMergedModel(src, moduleId, "effects"),
    loadMergedModel(src, moduleId, "counters"),
    loadMergedModel(src, moduleId, "characters"),
    loadMergedModel(src, moduleId, "character_classes"),
  ]);

  // Seed the URL-taking loaders via blob URLs. Each promise settles
  // independently — a malformed catalog won't block the others.
  // ignoreRejection wrapper keeps the Promise.all happy without
  // dragging in a Promise.allSettled type-narrow.
  await Promise.all([
    items
      ? seedViaBlob(items, loadItems).catch(() => undefined)
      : Promise.resolve(),
    spells
      ? seedViaBlob(spells, loadSpells).catch(() => undefined)
      : Promise.resolve(),
    monsters
      ? seedViaBlob(monsters, loadMonsters).catch(() => undefined)
      : Promise.resolve(),
    races
      ? seedViaBlob(races, loadRaces).catch(() => undefined)
      : Promise.resolve(),
    effects
      ? seedViaBlob(effects, loadEffects).catch(() => undefined)
      : Promise.resolve(),
    // counters: re-keyed to the bare shop-type map loadCounters wants
    // (see countersToRawMap). Seeds CombatScene's loot-drop pool so it
    // never hits modulePath("counters.json") (wrong origin in remote).
    counters
      ? seedViaBlob(countersToRawMap(counters), loadCounters).catch(
          () => undefined,
        )
      : Promise.resolve(),
  ]);

  // Class catalog — seeded via its dedicated setter rather than the
  // blob-URL trick because the v1 loader is `loadClass(id)` not
  // `loadClassCatalog(url?)` (no URL slot to inject through). Without
  // this, `loadClass` 404s on `/modules/<id>/character_classes.json`,
  // CombatScene's `classTemplates` map stays empty, and
  // `classCanCast(spell, null)` returns false → Cast disabled even
  // when spells + spellbook eligibility otherwise check out.
  _setClassCatalog(
    characterClasses as { character_classes?: never[] } | null,
  );

  // Abilities catalog — same dedicated-setter approach as classes.
  // `loadAbilities()` takes an optional URL but the play side
  // doesn't have one handy mid-boot (the inheritance-aware merge
  // happens above), so we hydrate the raw list directly and stamp
  // it into the cache. An empty / missing abilities.json silently
  // results in an empty cache — combat then surfaces no Ability
  // rows for any member, which is the correct UX for a module
  // that doesn't declare any.
  if (abilities && Array.isArray((abilities as { abilities?: unknown }).abilities)) {
    const raw = (abilities as { abilities: ReadonlyArray<Parameters<typeof abilityFromRaw>[0]> }).abilities;
    const hydrated: Ability[] = [];
    for (const r of raw) {
      const a = abilityFromRaw(r);
      if (a) hydrated.push(a);
    }
    _setAbilitiesCache(hydrated);
  } else {
    _setAbilitiesCache([]);
  }

  // Party last — it depends on the characters catalog we just loaded
  // via `mergeModel`. Built directly from the save (authoritative
  // for HP/MP/inventory) and the merged module characters (sprites,
  // base stats, equipment slots).
  const party = buildPartyFromSave(
    save,
    characters as { characters?: CharacterRecord[] } | null,
  );
  _setPartyCache(party);
}
