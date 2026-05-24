/**
 * Abilities loader — reads v2's module-scoped abilities.json shape
 * directly. An Ability is a named capability granted by a race or
 * class (or in the future, by an item / quest). Abilities split into
 * three usage shapes:
 *
 *   - **Passive** — no `usable_in`, no `params.action`. The mechanic
 *     lives elsewhere (e.g. Backstab is a damage modifier inside the
 *     attack pipeline; Infravision is read by the lighting renderer).
 *     These abilities are documented on the character sheet for the
 *     player but never appear in any picker.
 *
 *   - **Out-of-combat** — `usable_in: ["party"]`. Surfaced by the
 *     Party screen / world-map abilities flow (Pickpocket, Tinker,
 *     Brew Potion). Not consumed by the combat scene.
 *
 *   - **Combat-active** — `usable_in: ["battle"]` AND `params.action`
 *     is set to a dispatch discriminator (today: `"turn_undead"`).
 *     These are the abilities the combat scene's "Abilities" picker
 *     surfaces for the active member. The `params.action` field
 *     identifies WHICH resolver runs; the other `params` keys are
 *     the per-ability config bag (`save_dc_base`, `hp_percent`, …).
 *
 * The combat scene used to back-route Turn Undead through the Cast
 * picker by faking a Spell record. That conflated two distinct
 * concepts — class abilities are not spells (no MP cost, no spell-
 * casting class gate, often once-per-encounter, etc.). v2 separates
 * them: the Cast picker walks spells, the Abilities picker walks
 * abilities, and each has its own dispatcher.
 */

import { modulePath } from "./Module";

/** Loose `params` bag — each ability declares its own shape. The
 *  combat dispatcher reads `params.action` to pick the resolver and
 *  the rest of the bag as per-ability config. */
export type AbilityParams = Record<string, unknown>;

/** Hydrated v2 ability record. Mirrors abilities.json verbatim;
 *  only `usable_in` and `params` are normalised on load (the JSON
 *  may omit either / pass a singleton string). */
export interface Ability {
  /** Snake_case identifier — matches the granter's reference
   *  (`character_classes.json.abilities[].ability_id`, the entries
   *  of `races.json.abilities[]`) and the abilities.json key. */
  id: string;
  name: string;
  /** Animation catalog id — when set, the combat dispatcher resolves
   *  the matching record from animations.json to pull `cast_sfx`,
   *  `hit_sfx`, and `visual` for the per-target VFX pass. */
  animation_id: string | null;
  /** Granter category. `"class"` for class-granted abilities,
   *  `"race"` for race-granted. Used by the character sheet to
   *  group display. */
  type: "class" | "race";
  description: string;
  /** "instant" / "permanent" / a finite turn count. Combat abilities
   *  are typically "instant"; passives are "permanent". */
  duration: "instant" | "permanent" | number | string | null;
  /** When true, the ability also appears as a togglable party-wide
   *  effect (Infravision, Detect Traps). The combat scene doesn't
   *  consume this field — it's read by the Party screen. */
  party_effect?: boolean;
  /** Where the ability is available — `"battle"` for the in-combat
   *  Abilities picker, `"party"` for the out-of-combat one. Empty
   *  means passive (no picker — the mechanic lives elsewhere). */
  usable_in: string[];
  /** Per-ability config bag. `params.action` is the dispatch key
   *  for combat-active abilities. */
  params: AbilityParams | null;
}

interface RawAbility {
  id?: string;
  name?: string;
  animation_id?: string | null;
  type?: string;
  description?: string;
  duration?: Ability["duration"];
  party_effect?: boolean;
  usable_in?: string[] | string;
  params?: AbilityParams | null;
}

interface RawAbilitiesFile {
  _comment?: string;
  abilities?: RawAbility[];
}

let _cache: Ability[] | null = null;

/** Hydrate one raw ability record. Defaults seed every required
 *  field so a partial JSON entry doesn't crash the loader; the
 *  spread carries unknown / forward-compat fields through so adding
 *  a new optional key to abilities.json doesn't need a loader edit. */
export function abilityFromRaw(r: RawAbility): Ability | null {
  if (!r.id || !r.name) return null;
  const type: Ability["type"] = r.type === "race" ? "race" : "class";
  return {
    description: "",
    animation_id: null,
    duration: "permanent",
    params: null,
    ...r,
    id: r.id,
    name: r.name,
    type,
    usable_in: Array.isArray(r.usable_in)
      ? r.usable_in
      : typeof r.usable_in === "string"
        ? [r.usable_in]
        : [],
  };
}

export async function loadAbilities(
  url = modulePath("abilities.json"),
): Promise<Ability[]> {
  if (_cache) return _cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as RawAbilitiesFile;
  _cache = (raw.abilities ?? [])
    .map(abilityFromRaw)
    .filter((a): a is Ability => a !== null);
  return _cache;
}

/** Test-only cache reset. */
export function _clearAbilitiesCache(): void {
  _cache = null;
}

/** Test-only cache seed. Lets `seedBattleCaches` populate the cache
 *  from a pre-merged blob without going through `loadAbilities`'s
 *  fetch path. Mirrors `_setPartyCache` / `_setClassCatalog`. */
export function _setAbilitiesCache(list: ReadonlyArray<Ability>): void {
  _cache = [...list];
}

/** True iff the ability is eligible for the in-combat Abilities
 *  picker — it declares it can be used in battle AND carries a
 *  `params.action` discriminator the dispatcher can route on.
 *
 *  Passive abilities (no `usable_in`, e.g. Backstab) and out-of-
 *  combat abilities (`usable_in: ["party"]`, e.g. Tinker) both
 *  return false. So does any battle-flagged ability whose params
 *  forgot to declare an action — that's almost certainly a data
 *  bug, and a silent skip is friendlier than a runtime crash. */
export function abilityIsCombatActive(a: Ability): boolean {
  if (!a.usable_in.includes("battle")) return false;
  const action =
    a.params && typeof a.params.action === "string" ? a.params.action : "";
  return action.length > 0;
}

/** Lookup-friendly view of a member for ability gating. Narrowed
 *  on purpose so tests don't have to construct full PartyMember
 *  fixtures. */
export interface AbilityMemberView {
  /** Character class id (snake_case). Used to look up the class
   *  template's per-class min-level gates. */
  class: string;
  /** Character race id (snake_case). Used to look up the race's
   *  innate ability list. */
  race: string;
  /** Current level — gates class abilities against their
   *  per-class `min_level`. */
  level: number;
}

/** Class template shape the helper consumes. Subset of
 *  `ClassTemplate` so callers don't have to import the full type. */
export interface AbilityClassTemplateView {
  abilities: ReadonlyArray<{ ability_id: string; min_level?: number }>;
}

/** Race info shape the helper consumes. Subset of `RaceInfo`. */
export interface AbilityRaceView {
  abilities?: ReadonlyArray<string>;
}

/**
 * Filter the abilities catalog down to those the given member can
 * use in combat right now. Walks both granter lanes:
 *
 *   - Class abilities — from `classTemplate.abilities`, gated by
 *     each entry's per-class `min_level`. Below the gate → excluded.
 *   - Race abilities — from `raceInfo.abilities`, no level gate
 *     (races grant their abilities from level 1).
 *
 * The union is then filtered through `abilityIsCombatActive` so
 * passives + out-of-combat abilities drop out — only abilities the
 * picker can actually dispatch survive. Ids resolve against the
 * `abilities` catalog (missing entries are silently dropped — a
 * stale reference is a data bug but shouldn't crash combat).
 *
 * Dedupes across granters so a class+race that happened to grant
 * the same ability id doesn't double-list. Pure; safe to call on
 * every action-menu refresh.
 */
export function combatAbilitiesForMember(
  member: AbilityMemberView,
  classTemplate: AbilityClassTemplateView | null,
  raceInfo: AbilityRaceView | null,
  abilities: ReadonlyArray<Ability>,
): Ability[] {
  const ids = new Set<string>();
  if (classTemplate) {
    for (const ref of classTemplate.abilities) {
      const gate = typeof ref.min_level === "number" ? ref.min_level : 1;
      if (member.level < gate) continue;
      if (ref.ability_id) ids.add(ref.ability_id);
    }
  }
  if (raceInfo?.abilities) {
    for (const aid of raceInfo.abilities) {
      if (aid) ids.add(aid);
    }
  }
  if (ids.size === 0) return [];
  const out: Ability[] = [];
  for (const a of abilities) {
    if (!ids.has(a.id)) continue;
    if (!abilityIsCombatActive(a)) continue;
    out.push(a);
  }
  return out;
}
