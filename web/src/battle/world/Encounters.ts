/**
 * Encounter table loader — reads v2's module-scoped encounters.json
 * natively.
 *
 * v2 differences from v1:
 *   - Encounters live in a single flat `encounters[]` keyed by `id`.
 *     `area` is now a field on each entry instead of an outer dict
 *     bucket. (v1 grouped them under `encounters.dungeon`,
 *     `encounters.overworld`, etc.)
 *   - JSON field names are snake_case (`monster_party_tile`,
 *     `monsters[]`). Monster references are catalog ids
 *     (`"giant_rat"`), not display names.
 *   - `terrain` is gone — v1 used it for sea / land encounter
 *     splitting but no live consumer reads it any more.
 *
 * Runtime model: every entry is hydrated into an `EncounterTemplate`
 * with the same camelCase fields v1 consumers expect (Dungeon,
 * InteriorSpawn, Quests, sampleEncounter). `loadEncounters()` returns
 * the legacy `Record<area, EncounterTemplate[]>` shape so callers
 * don't have to change — internally we just group the flat array on
 * the way out.
 *
 * `loadAllEncounters()` is the new flat-list variant the simulator
 * picker uses — id + area carried along so the UI can render
 * "[dungeon] Cellar Rats (lvl 1)" entries without a re-pivot.
 */
import { modulePath } from "./Module";
import { defaultRng, type RNG } from "../rng";

export interface EncounterTemplate {
  /** Snake_case id from encounters.json. */
  id: string;
  /** Area bucket — "dungeon" / "overworld" / "house_basement". */
  area: string;
  /** Organizational theme (undead/devil/elemental/humanoid/cryptid/
   *  magical), derived from the encounter's monsters. Authoring aid for
   *  building themed maps; gameplay ignores it. JSON key: `theme`. */
  theme?: string;
  name: string;
  /** 1..8, used by area / difficulty filters. */
  level: number;
  weight: number;
  /** Monster id of the lead (shown on the map). */
  monsterPartyTile: string;
  /** Full roster handed to CombatScene. First entry should match the lead. */
  monsters: string[];
  /** Optional id of an `ArenaMap` (from `maps.json`, tagged
   *  `battle_screen_arena`) the fight should run on. The launcher
   *  pre-selects this map when the encounter is picked; the user can
   *  still override via the Arena Map dropdown. Unknown ids are
   *  ignored — picker reverts to the default arena. JSON key:
   *  `arena_id`. */
  arenaId?: string;
  /** When true, the launcher's Darkness toggle is pre-checked for
   *  this encounter so the fight starts in low-light by default. The
   *  user can still flip it off. Pairs naturally with an `arenaId`
   *  that has authored `light_source` cells. JSON key: `darkness`. */
  darkness?: boolean;
  /** Free-form editor-side organizational labels (e.g. "forest",
   *  "act_1", "boss"). Gameplay does NOT read these — they exist purely
   *  to group / filter the encounter list in the editor (the model view
   *  buckets encounters by their first tag). Mirrors the `tags`
   *  convention on Map / Dungeon. JSON key: `tags`. */
  tags: string[];
}

export interface RawEncounter {
  id?: string;
  area?: string;
  theme?: string;
  name?: string;
  level?: number;
  weight?: number;
  monster_party_tile?: string;
  monsters?: string[];
  /** Optional id of an arena map (see EncounterTemplate.arenaId). */
  arena_id?: string;
  /** Encounter pre-flags itself as a darkness fight (see
   *  EncounterTemplate.darkness). */
  darkness?: boolean;
  /** Editor-side organizational labels (see EncounterTemplate.tags). */
  tags?: string[];
}

interface RawEncountersFile {
  _comment?: string;
  encounters?: RawEncounter[];
}

let _flatCache: EncounterTemplate[] | null = null;
let _byAreaCache: Record<string, EncounterTemplate[]> | null = null;

/**
 * Hydrate a raw v2 encounters.json entry. Defaults seed required
 * scalars; spread carries every other field through (project
 * principle — adding a new field to the interface + the JSON
 * shouldn't need a copy point here). The lone explicit override is
 * `monsterPartyTile`, which we *derive* from `monster_party_tile`
 * for a runtime camelCase alias the rest of the engine consumes.
 *
 * Exported for callers that load encounters through the data-model
 * inheritance layer (StaticModuleSource + mergeModel) rather than
 * the active-module-only `loadEncounters` fetch — they still need
 * the same hydration so the rest of the engine sees a uniform
 * EncounterTemplate shape regardless of source.
 */
export function encounterTemplateFromRaw(
  raw: RawEncounter,
): EncounterTemplate | null {
  return fromRaw(raw);
}

/** Group a flat list of hydrated encounters by `area`. The shape
 *  matches what `sampleEncounter` / the dungeon generator expect. */
export function groupEncountersByArea(
  templates: ReadonlyArray<EncounterTemplate>,
): Record<string, EncounterTemplate[]> {
  const out: Record<string, EncounterTemplate[]> = {};
  for (const e of templates) {
    (out[e.area] ??= []).push(e);
  }
  return out;
}

function fromRaw(raw: RawEncounter): EncounterTemplate | null {
  const monsters = Array.isArray(raw.monsters)
    ? raw.monsters.filter((m): m is string => typeof m === "string" && m.length > 0)
    : [];
  if (monsters.length === 0) return null;
  const lead =
    typeof raw.monster_party_tile === "string" && raw.monster_party_tile.length > 0
      ? raw.monster_party_tile
      : monsters[0];
  return {
    id: "",
    area: "overworld",
    name: "Encounter",
    level: 1,
    weight: 1,
    ...raw,
    monsters,
    monsterPartyTile: lead,
    // Editor-only labels — normalised to a clean string[] (drops
    // non-strings / blanks) so the grouping + picker can rely on it.
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [],
    // Snake_case → camelCase aliases. Omitted when the JSON didn't
    // declare them so consumers can distinguish "no preference" from
    // "explicitly off / empty".
    arenaId:
      typeof raw.arena_id === "string" && raw.arena_id.length > 0
        ? raw.arena_id
        : undefined,
    darkness: typeof raw.darkness === "boolean" ? raw.darkness : undefined,
  };
}

/** Fetch + hydrate every encounter once. Cached per session. */
async function fetchEncounters(): Promise<EncounterTemplate[]> {
  if (_flatCache) return _flatCache;
  const url = modulePath("encounters.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as RawEncountersFile;
  const out: EncounterTemplate[] = [];
  for (const r of raw.encounters ?? []) {
    const e = fromRaw(r);
    if (e) out.push(e);
  }
  _flatCache = out;
  return out;
}

/**
 * Flat list of every encounter in load order — the picker / sampler
 * UI uses this so it can render id + area + level alongside the name.
 */
export async function loadAllEncounters(): Promise<EncounterTemplate[]> {
  return fetchEncounters();
}

/**
 * Legacy area-bucket shape kept for back-compat with the Dungeon /
 * Interior / Quest spawners that consume `Record<area, EncounterTemplate[]>`.
 * Internally just groups the flat list by `area`.
 */
export async function loadEncounters(): Promise<Record<string, EncounterTemplate[]>> {
  if (_byAreaCache) return _byAreaCache;
  const flat = await fetchEncounters();
  const out: Record<string, EncounterTemplate[]> = {};
  for (const e of flat) {
    (out[e.area] ??= []).push(e);
  }
  _byAreaCache = out;
  return out;
}

/** Test-only: clear the encounter cache. */
export function _clearEncountersCache(): void {
  _flatCache = null;
  _byAreaCache = null;
}

/** Seed the encounter caches directly from a pre-hydrated flat list,
 *  bypassing the `modulePath` fetch. Used by the inheritance-aware
 *  cache seeder (`seedBattleCaches*`) so a module that inherits its
 *  encounters from a parent via `extends` — and therefore has no own
 *  `encounters.json` to fetch — still populates the catalog the
 *  simulator picker + spawners read. Populates both the flat list and
 *  the by-area bucket so either accessor short-circuits to the seed. */
export function _setEncountersCache(flat: EncounterTemplate[]): void {
  _flatCache = flat;
  const byArea: Record<string, EncounterTemplate[]> = {};
  for (const e of flat) {
    (byArea[e.area] ??= []).push(e);
  }
  _byAreaCache = byArea;
}

export interface SampleOptions {
  /** Inclusive lower bound on encounter level. Default 1. */
  minLevel?: number;
  /** Inclusive upper bound on encounter level. Default 8. */
  maxLevel?: number;
  rng?: RNG;
  /**
   * Monster difficulty tiers ("easy" / "normal" / "hard" / "deadly")
   * the dungeon will accept. When set together with `monsterDifficulty`,
   * candidate encounters get their `monsters` rosters pruned to entries
   * whose individual difficulty falls in this set. Encounters whose
   * roster empties out after pruning are excluded entirely; encounters
   * whose lead got pruned have it swapped to the first surviving
   * monster.
   */
  allowedDifficulties?: ReadonlySet<string>;
  /**
   * Lookup: monster catalog id → difficulty tag (from monsters.json).
   * Required when `allowedDifficulties` is set; without it the prune
   * step can't tell which monsters belong to which tier and the
   * filter no-ops to avoid silently dropping every encounter.
   */
  monsterDifficulty?: (id: string) => string | undefined;
  /**
   * Optional encounter `theme` filter (e.g. "undead", "devil"). When
   * set and non-empty, only encounters whose `theme` matches are
   * eligible — a themed dungeon draws exclusively from its theme.
   * Fallback: if NO encounter of that theme exists in the level band,
   * the filter is skipped (the full eligible pool is used) rather than
   * leaving rooms empty. Empty / unset → no theme restriction.
   */
  theme?: string;
}

/**
 * Roll one encounter from the named area, restricted to the given
 * level band. Returns null when nothing matches.
 */
export function sampleEncounter(
  table: Record<string, EncounterTemplate[]>,
  area: string,
  opts: SampleOptions = {},
): EncounterTemplate | null {
  const list = table[area];
  if (!list || list.length === 0) return null;
  const minLv = opts.minLevel ?? 1;
  const maxLv = opts.maxLevel ?? 8;
  const rng = opts.rng ?? defaultRng;
  let eligible = list.filter((e) => e.level >= minLv && e.level <= maxLv);

  // Theme filter — a themed dungeon only draws from matching-theme
  // encounters. Falls back to the unfiltered pool when the theme has
  // no encounters in this band, so a themed dungeon never generates
  // emptier than an unthemed one.
  const theme = opts.theme?.trim();
  if (theme) {
    const themed = eligible.filter((e) => e.theme === theme);
    if (themed.length > 0) eligible = themed;
  }

  const allow = opts.allowedDifficulties;
  const lookup = opts.monsterDifficulty;
  if (allow && lookup) {
    const pruned: EncounterTemplate[] = [];
    for (const e of eligible) {
      const survivors = e.monsters.filter((id) => {
        const d = lookup(id);
        return d != null && allow.has(d);
      });
      if (survivors.length === 0) continue;
      const lead = survivors.includes(e.monsterPartyTile)
        ? e.monsterPartyTile
        : survivors[0];
      pruned.push({ ...e, monsters: survivors, monsterPartyTile: lead });
    }
    eligible = pruned;
  }

  if (eligible.length === 0) return null;
  const total = eligible.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const e of eligible) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return eligible[eligible.length - 1];
}
