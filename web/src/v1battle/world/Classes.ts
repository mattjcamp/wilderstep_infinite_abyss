/**
 * Class & race templates — reads v2's module-scoped catalogs natively.
 *
 * v2 differences (canonical model):
 *   - Classes live in a single `character_classes.json` (flat array
 *     under the top-level `character_classes` key) keyed by `id`
 *     (snake_case). v1 had one JSON per class under `data/classes/`.
 *   - `casting_type` is an array of catalog ids (`["sorcerer"]`,
 *     `["sorcerer","priest"]` for Druid). v1 didn't carry this on
 *     the class — spell eligibility was per-spell `allowable_classes`.
 *   - Abilities reference the central `abilities.json` catalog via
 *     `{ability_id, min_level}` pairs; the name + description live
 *     on the ability record now, not inline.
 *   - Races live in a single `races.json` (flat array) keyed by id.
 *
 * v1-only fields kept here (with sane defaults) until v2 adopts them:
 *   - `hp_per_level` / `mp_per_level` / `exp_per_level` — v2's class
 *     records don't carry these yet. Defaults below mirror v1's
 *     per-class JSON so the level-up math has something to read.
 *   - `mp_source` (ability or dual-stat config) — v2 hasn't modelled
 *     casting-stat selection yet; defaults pick from class id.
 */

import { modulePath } from "./Module";

export interface MpSource {
  ability?: "strength" | "dexterity" | "intelligence" | "wisdom";
  abilities?: Array<"strength" | "dexterity" | "intelligence" | "wisdom">;
  mode?: "higher" | "average";
}

/** Reference to an ability from `abilities.json`, with the level
 *  the class earns access. Mirrors v2's character_classes.json
 *  `abilities[]` entries. */
export interface ClassAbilityRef {
  ability_id: string;
  min_level: number;
}

export interface ClassTemplate {
  /** Snake_case identifier (Map key + canonical id). */
  id: string;
  /** Display label ("Fighter", "Wizard", …). */
  name: string;
  description?: string;
  /** Tile movement budget per combat turn. */
  range: number;
  /** Spell catalogs this class can draw from. */
  casting_type: string[];
  /** References to abilities.json entries, with per-class level gates. */
  abilities: ClassAbilityRef[];
  /** Item-type allowlist used by equip-time gating. */
  allowable_item_types?: string[];
  // ── v1-only fields (defaults until v2 adopts them) ───────────────
  /** HP gained per level above 1. */
  hp_per_level: number;
  /** MP gained per level above 1. */
  mp_per_level: number;
  /** XP curve when the race doesn't override it. */
  exp_per_level: number;
  /** Casting-stat selector — drives mp_gain on level-up. */
  mp_source?: MpSource;
}

export interface RaceInfo {
  id: string;
  name: string;
  description?: string;
  /** Optional XP curve override — Humans level faster. */
  exp_per_level?: number;
  /** Per-stat creation modifiers. */
  stat_modifiers?: Record<string, number>;
  /** Innate ability ids granted to every member of this race. */
  abilities?: string[];
}

// ── Defaults v2's character_classes.json doesn't carry yet ───────
//
// These mirror v1's per-class JSON (data/classes/<name>.json) and
// keep the leveling math working until v2 layers the same fields
// onto its catalog. When that happens, drop these and read straight
// off the v2 record.

const HP_PER_LEVEL_DEFAULTS: Record<string, number> = {
  fighter: 8,
  paladin: 8,
  ranger: 6,
  alchemist: 4,
  thief: 6,
  druid: 6,
  cleric: 6,
  wizard: 4,
};
const MP_PER_LEVEL_DEFAULTS: Record<string, number> = {
  fighter: 0,
  paladin: 4,
  ranger: 0,
  alchemist: 4,
  thief: 0,
  druid: 6,
  cleric: 6,
  wizard: 8,
};
const EXP_PER_LEVEL_DEFAULT = 1500;
const MP_SOURCE_DEFAULTS: Record<string, MpSource> = {
  cleric: { ability: "wisdom" },
  paladin: { ability: "wisdom" },
  ranger: { ability: "wisdom" },
  wizard: { ability: "intelligence" },
  alchemist: { ability: "intelligence" },
  druid: { abilities: ["intelligence", "wisdom"], mode: "average" },
};

interface RawClassAbility {
  ability_id?: string;
  min_level?: number;
}

interface RawClass {
  id?: string;
  name?: string;
  description?: string;
  range?: number;
  casting_type?: string[];
  abilities?: RawClassAbility[];
  allowable_item_types?: string[];
}

interface RawRace {
  id?: string;
  name?: string;
  description?: string;
  exp_per_level?: number | null;
  stat_modifiers?: Record<string, number>;
  abilities?: string[];
}

let _classCatalog: Map<string, ClassTemplate> | null = null;
let _racesCache: Map<string, RaceInfo> | null = null;

/**
 * Hydrate one character_classes.json entry. Defaults seed required
 * scalars + the per-class HP/MP/EXP table v2 doesn't carry yet;
 * spread carries every other RawClass field through (project
 * principle — adding a field shouldn't need a loader edit).
 * Overrides re-stamp `casting_type` and `abilities` for the shape +
 * filtering they require, and validated identity fields.
 */
function classFromRaw(raw: RawClass): ClassTemplate | null {
  if (!raw.id || !raw.name) return null;
  const idLower = raw.id.toLowerCase();
  return {
    range: 4,
    hp_per_level: HP_PER_LEVEL_DEFAULTS[idLower] ?? 6,
    mp_per_level: MP_PER_LEVEL_DEFAULTS[idLower] ?? 0,
    exp_per_level: EXP_PER_LEVEL_DEFAULT,
    mp_source: MP_SOURCE_DEFAULTS[idLower],
    ...raw,
    id: raw.id,
    name: raw.name,
    casting_type: Array.isArray(raw.casting_type) ? raw.casting_type : [],
    abilities: Array.isArray(raw.abilities)
      ? raw.abilities
          .filter(
            (a): a is RawClassAbility => !!a && typeof a.ability_id === "string",
          )
          .map((a) => ({
            ability_id: a.ability_id as string,
            min_level: typeof a.min_level === "number" ? a.min_level : 1,
          }))
      : [],
  };
}

/** Fetch the whole class catalog once; cached for the page session. */
async function loadClassCatalog(): Promise<Map<string, ClassTemplate>> {
  if (_classCatalog) return _classCatalog;
  const url = modulePath("character_classes.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as { character_classes?: RawClass[] };
  const out = new Map<string, ClassTemplate>();
  for (const r of raw.character_classes ?? []) {
    const tpl = classFromRaw(r);
    if (tpl) out.set(tpl.id.toLowerCase(), tpl);
  }
  _classCatalog = out;
  return out;
}

/** Fetch one class template by id ("fighter", "wizard"). */
export async function loadClass(id: string): Promise<ClassTemplate> {
  const cat = await loadClassCatalog();
  const tpl = cat.get(id.toLowerCase());
  if (!tpl) throw new Error(`Unknown class id: ${id}`);
  return tpl;
}

/** Fetch the races map. Cached after the first call. Keyed by id. */
export async function loadRaces(
  url = modulePath("races.json"),
): Promise<Map<string, RaceInfo>> {
  if (_racesCache) return _racesCache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as { races?: RawRace[] };
  const out = new Map<string, RaceInfo>();
  for (const r of raw.races ?? []) {
    if (!r.id || !r.name) continue;
    // Spread carries every RawRace field through; the override
    // block only revalidates required identity fields. Project
    // principle: adding a field to RaceInfo + races.json shouldn't
    // need a copy point edit here.
    out.set(r.id, {
      ...r,
      id: r.id,
      name: r.name,
      // races.json may carry null for "no override" — coerce to
      // undefined so the optional field reads cleanly downstream.
      exp_per_level:
        typeof r.exp_per_level === "number" ? r.exp_per_level : undefined,
    });
  }
  _racesCache = out;
  return out;
}

/** Test-only cache reset. */
export function _clearClassCaches(): void {
  _classCatalog = null;
  _racesCache = null;
}

/**
 * Race-level innate abilities for character-sheet display. Returns a
 * minimal {name, description} list for the given race id, sourced
 * from `races.json` + `abilities.json`. v2 references abilities by
 * id; callers pass the resolved Map for the lookup.
 *
 * Helper exists for backwards compatibility with PartyScene-style
 * UI code that hardcoded a per-race ability list in v1; new code
 * should read from races.json + abilities.json directly.
 */
export function raceAbilities(
  raceId: string,
  races: Map<string, RaceInfo>,
  abilities: Map<string, { name?: string; description?: string }>,
): Array<{ name: string; description: string }> {
  const race = races.get(raceId.toLowerCase());
  if (!race?.abilities) return [];
  const out: Array<{ name: string; description: string }> = [];
  for (const id of race.abilities) {
    const ab = abilities.get(id);
    if (!ab) continue;
    out.push({
      name: ab.name ?? id,
      description: ab.description ?? "",
    });
  }
  return out;
}
