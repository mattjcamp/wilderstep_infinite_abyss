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
  name: string;
  /** 1..8, used by area / difficulty filters. */
  level: number;
  weight: number;
  /** Monster id of the lead (shown on the map). */
  monsterPartyTile: string;
  /** Full roster handed to CombatScene. First entry should match the lead. */
  monsters: string[];
}

interface RawEncounter {
  id?: string;
  area?: string;
  name?: string;
  level?: number;
  weight?: number;
  monster_party_tile?: string;
  monsters?: string[];
}

interface RawEncountersFile {
  _comment?: string;
  encounters?: RawEncounter[];
}

let _flatCache: EncounterTemplate[] | null = null;
let _byAreaCache: Record<string, EncounterTemplate[]> | null = null;

function fromRaw(raw: RawEncounter): EncounterTemplate | null {
  const monsters = Array.isArray(raw.monsters)
    ? raw.monsters.filter((m): m is string => typeof m === "string" && m.length > 0)
    : [];
  if (monsters.length === 0) return null;
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : "";
  const lead = typeof raw.monster_party_tile === "string" && raw.monster_party_tile.length > 0
    ? raw.monster_party_tile
    : monsters[0];
  return {
    id,
    area: typeof raw.area === "string" && raw.area.length > 0 ? raw.area : "overworld",
    name: raw.name ?? "Encounter",
    level: typeof raw.level === "number" && Number.isFinite(raw.level) ? raw.level : 1,
    weight: typeof raw.weight === "number" && raw.weight > 0 ? raw.weight : 1,
    monsterPartyTile: lead,
    monsters,
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
