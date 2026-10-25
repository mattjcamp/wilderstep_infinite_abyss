/**
 * Town interior data.
 *
 * The Python module-editor format stores town tiles as a dict keyed by
 * "col,row" with values that are full tile-manifest entries (tile_id +
 * name + sprite path), e.g.:
 *
 *   "0,0": { "tile_id": 50, "name": "Grass Sparse", "path": "..." }
 *
 * That's a strict superset of what we need — we only consume `tile_id`
 * here. Missing positions fall back to a "void" tile id (36) so the
 * border/exterior renders as non-walkable empty space.
 */

import { TileMap, type TileLink } from "./TileMap";
import { modulePath, withBase } from "./Module";

/** Tile id 36 = TILE_VOID per `src/settings.py`. Non-walkable, black. */
const TILE_VOID = 36;

export interface NpcDef {
  name: string;
  /** "villager" | "shopkeep" | "priest" | "elder" | … (free-form). */
  npcType: string;
  /** Path under /assets/ — translated from the Python source path. */
  sprite: string;
  col: number;
  row: number;
  /** Anchor position the NPC wanders around — set to the NPC's initial
   *  col/row at load time. Wandering NPCs must stay within
   *  `wanderRange` Manhattan tiles of this point, matching the Python
   *  game's `npc.home_col`/`npc.home_row`. */
  homeCol: number;
  homeRow: number;
  /** Either a single line or a list of lines the NPC speaks. */
  dialogue: string[];
  godName?: string;
  wanderRange?: number;
  /**
   * For shopkeep NPCs only — keys into counters.json
   * (general/weapon/armor/magic/reagent/inn/guild). Tells the shop UI
   * which catalog to display. Priests use the "healing" counter
   * implicitly so this field is unused for them.
   */
  shopType?: string;
  /**
   * For NPCs of type `"module_quest_giver"` — the quest name from
   * `quests.json` this NPC offers. Lets `openDialog` look up the
   * quest state and branch between Accept / Active / Turn-in. Set
   * by whichever scene-side injector wires module quests onto the
   * town's NPC list.
   */
  _questName?: string;
}

/**
 * Authored fixed-position encounter pinned to a town/building space.
 * The Python module editor writes these for every "Auto" combat the
 * author drops into a building (Sea Shrine's Troll Den, Dark Patrol,
 * etc.). The web port spawns one InteriorMonster per entry on scene
 * boot so the player can engage them like any other floor monster.
 */
export interface AuthoredEncounter {
  /** Encounter name — must match an `encounters.json` entry whose
   *  roster supplies the monster names handed to CombatScene. */
  name: string;
  /** "combat" or "scripted" — only "combat" is honoured in v1. */
  encounterType: string;
  col: number;
  row: number;
  description: string;
}

export interface Town {
  name: string;
  width: number;
  height: number;
  /** The tile-id 2D grid, normalised from the dict format. */
  tiles: number[][];
  /** Where the player drops in when entering from the overworld. */
  entry: { col: number; row: number };
  npcs: NpcDef[];
  /** Per-tile properties dict, same shape as overworld TileMap. */
  tileProperties: Record<string, unknown>;
  /** Authored fixed-position encounters from the module's town /
   *  building data. Building spaces use these heavily — Sea Shrine's
   *  Citadel 4 has a Troll Den at (11, 11) the spawn pass turns into
   *  an engageable monster on entry. Empty for plain towns. */
  encounters: AuthoredEncounter[];
  /**
   * Building interiors that live inside this town. Each interior is
   * structurally identical to a Town (same tile dict, npcs, tile_properties)
   * — we just expose them under their parent so navigation can be
   * resolved by a "Town/Interior" path.
   */
  interiors: Town[];
}

interface RawNpc {
  name?: string;
  npc_type?: string;
  sprite?: string;
  col?: number;
  row?: number;
  dialogue?: string | string[];
  god_name?: string;
  wander_range?: number;
  shop_type?: string;
}

interface RawEncounter {
  name?: string;
  encounter_type?: string;
  col?: number;
  row?: number;
  description?: string;
}

interface RawTown {
  name?: string;
  width?: number;
  height?: number;
  tiles?: Record<string, { tile_id?: number } | number> | number[][];
  entry_col?: number;
  entry_row?: number;
  npcs?: RawNpc[];
  tile_properties?: Record<string, unknown>;
  encounters?: RawEncounter[];
  interiors?: RawTown[];
}

/**
 * Translate a Python-style asset path (e.g. `src/assets/game/characters/cleric.png`)
 * into the web path (`/assets/characters/cleric.png`). Returns the
 * input unchanged if it already starts with `/assets/`.
 *
 * The web asset structure flattens `assets/game/<category>/...` to
 * `assets/<category>/...`, so a `/game/` segment is stripped on the way.
 */
export function normalizeSpritePath(path: string): string {
  if (!path) return "";
  if (path.startsWith("/assets/")) return withBase(path);
  // Capture the tail after `assets/[game/]`. Both source layouts hit this:
  //   src/assets/game/characters/cleric.png → characters/cleric.png
  //   assets/characters/cleric.png          → characters/cleric.png
  const m = path.match(/assets\/(?:game\/)?(.+)$/);
  if (m) return withBase("/assets/" + m[1]);
  // Fallback for un-prefixed paths: assume a relative web path.
  return withBase("/assets/" + path.replace(/^\/+/, ""));
}

// ── NPC sprite resolution ─────────────────────────────────────────

/**
 * Resolve a sprite path for an NPC: its own `sprite` when set (and,
 * when the scene supplies `textureExists`, loaded). No built-in role
 * or villager art — NPC art comes from module data only. Empty means
 * "no sprite"; callers skip drawing it.
 */
export function resolveNpcSprite(
  npc: { name: string; npcType?: string; sprite?: string },
  textureExists?: (path: string) => boolean,
): string {
  if (npc.sprite && (!textureExists || textureExists(npc.sprite))) {
    return npc.sprite;
  }
  return "";
}

/** Convert a "col,row"-keyed dict of rich tile entries into a 2D grid. */
export function normalizeTownTiles(
  source: RawTown["tiles"],
  width: number,
  height: number
): number[][] {
  const grid: number[][] = [];
  // Already a 2D array — accept as-is.
  if (Array.isArray(source) && Array.isArray(source[0])) {
    for (let r = 0; r < height; r++) {
      const row = source[r] ?? [];
      const out: number[] = [];
      for (let c = 0; c < width; c++) out.push(typeof row[c] === "number" ? row[c] : TILE_VOID);
      grid.push(out);
    }
    return grid;
  }
  const dict = (source as Record<string, { tile_id?: number } | number> | undefined) ?? {};
  for (let r = 0; r < height; r++) {
    const row: number[] = [];
    for (let c = 0; c < width; c++) {
      const v = dict[`${c},${r}`];
      if (v == null) {
        row.push(TILE_VOID);
      } else if (typeof v === "number") {
        row.push(v);
      } else if (typeof v === "object" && typeof v.tile_id === "number") {
        row.push(v.tile_id);
      } else {
        row.push(TILE_VOID);
      }
    }
    grid.push(row);
  }
  return grid;
}

export function townFromRaw(raw: RawTown): Town {
  const w = raw.width ?? 0;
  const h = raw.height ?? 0;
  if (!w || !h) throw new Error(`Town '${raw.name ?? "?"}' missing width/height`);
  const tiles = normalizeTownTiles(raw.tiles, w, h);
  const npcs: NpcDef[] = (raw.npcs ?? []).map((n) => {
    const col = n.col ?? 0;
    const row = n.row ?? 0;
    return {
      name: n.name ?? "?",
      npcType: n.npc_type ?? "villager",
      sprite: normalizeSpritePath(n.sprite ?? ""),
      col,
      row,
      homeCol: col,
      homeRow: row,
      dialogue: Array.isArray(n.dialogue)
        ? n.dialogue.map(String)
        : n.dialogue
          ? [String(n.dialogue)]
          : [],
      godName: n.god_name,
      wanderRange: n.wander_range,
      shopType: n.shop_type,
    };
  });
  // Interiors are structurally identical to towns — recurse with the
  // same parser and treat them as nested Town objects. We don't allow
  // interiors-of-interiors today (none in the data); a too-deep nest
  // would just be parsed but unreachable via the path resolver.
  const interiors: Town[] = (raw.interiors ?? []).map(townFromRaw);
  const encounters: AuthoredEncounter[] = (raw.encounters ?? [])
    .filter((e): e is RawEncounter =>
      !!e && typeof e === "object" && typeof e.name === "string"
        && typeof e.col === "number" && typeof e.row === "number",
    )
    .map((e) => ({
      name: e.name ?? "",
      encounterType: e.encounter_type ?? "combat",
      col: e.col ?? 0,
      row: e.row ?? 0,
      description: e.description ?? "",
    }));
  return {
    name: raw.name ?? "Unknown",
    width: w,
    height: h,
    tiles,
    entry: { col: raw.entry_col ?? 0, row: raw.entry_row ?? 0 },
    npcs,
    tileProperties: (raw.tile_properties ?? {}) as Record<string, unknown>,
    encounters,
    interiors,
  };
}

/**
 * NPC types that never wander — shopkeeps stay behind the counter,
 * priests stay at the altar, etc. Mirrors the Python game's
 * `NPC.STATIONARY_TYPES` (in `town_generator.py`).
 */
export const STATIONARY_NPC_TYPES: ReadonlySet<string> = new Set([
  "shopkeep", "innkeeper", "priest", "quest_item",
]);

/** Default Manhattan distance an NPC may stray from `homeCol`/`homeRow`
 *  when their entry omits `wander_range`. Matches `NPC_WANDER_RANGE` in
 *  `src/settings.py` (= 3). */
export const DEFAULT_NPC_WANDER_RANGE = 3;

/**
 * Per-turn probability that a non-stationary NPC actually attempts a
 * step. The Python game uses real-time random timers (1.5–4 sec); in
 * a turn-based port this maps to a fraction-per-turn. 0.5 keeps the
 * town feeling alive without making it visually noisy.
 */
const NPC_STEP_CHANCE = 0.5;

/**
 * Step every wandering town NPC at most one tile in a random cardinal
 * direction. Mutates each `NpcDef`'s `col`/`row` in place. Skips
 * stationary types, candidates that fail the per-turn dice roll, and
 * any move that would leave the NPC's wander range, hit a non-walkable
 * tile, or collide with another NPC or the player.
 *
 * The `playerCol`/`playerRow` block keeps NPCs from stepping onto the
 * party — same rule the Python `_update_npc_wandering` follows. Returns
 * the list of NPCs whose position actually changed, so the scene can
 * tween only those sprites.
 */
export function wanderTownNpcs(
  npcs: NpcDef[],
  playerCol: number,
  playerRow: number,
  isWalkable: (col: number, row: number) => boolean,
  rng: () => number = Math.random,
): NpcDef[] {
  const occupied = new Set<string>();
  for (const n of npcs) occupied.add(`${n.col},${n.row}`);
  occupied.add(`${playerCol},${playerRow}`);

  const moved: NpcDef[] = [];
  for (const npc of npcs) {
    if (STATIONARY_NPC_TYPES.has(npc.npcType)) continue;
    if (rng() >= NPC_STEP_CHANCE) continue;

    const range = npc.wanderRange ?? DEFAULT_NPC_WANDER_RANGE;
    const dirs: Array<[number, number]> = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ];
    // Fisher-Yates shuffle so direction preference doesn't bias.
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dc, dr] of dirs) {
      const nc = npc.col + dc;
      const nr = npc.row + dr;
      if (Math.abs(nc - npc.homeCol) > range) continue;
      if (Math.abs(nr - npc.homeRow) > range) continue;
      if (!isWalkable(nc, nr)) continue;
      if (occupied.has(`${nc},${nr}`)) continue;
      occupied.delete(`${npc.col},${npc.row}`);
      npc.col = nc;
      npc.row = nr;
      occupied.add(`${nc},${nr}`);
      moved.push(npc);
      break;
    }
  }
  return moved;
}

/** Build a TileMap from a Town so existing walkability/link helpers apply. */
export function tileMapForTown(town: Town): TileMap {
  return new TileMap(town.width, town.height, town.tiles, {
    tileProperties: town.tileProperties as Record<string, never>,
    label: town.name,
  });
}

let _townCache: Town[] | null = null;

/**
 * Fetch and parse the active module's towns.json. Result is cached.
 *
 * Path matches the Python project: `modules/<name>/towns.json`.
 */
export async function loadTowns(url = modulePath("towns.json")): Promise<Town[]> {
  if (_townCache) return _townCache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as RawTown[];
  if (!Array.isArray(raw)) throw new Error("towns.json is not an array");
  _townCache = raw.map(townFromRaw);
  return _townCache;
}

export function getTownByName(towns: Town[], name: string): Town | null {
  return towns.find((t) => t.name === name) ?? null;
}

/**
 * Find a building interior inside a named parent town.
 *
 * Path syntax: `"<TownName>/<InteriorName>"`. Both the town and the
 * interior are looked up by exact name match.
 */
export function getInteriorByPath(towns: Town[], path: string): Town | null {
  const idx = path.indexOf("/");
  if (idx <= 0) return null;
  const townName = path.slice(0, idx);
  const interiorName = path.slice(idx + 1);
  const town = getTownByName(towns, townName);
  if (!town) return null;
  return town.interiors.find((i) => i.name === interiorName) ?? null;
}

/**
 * Resolve either a bare town name or a "Town/Interior" path to the
 * matching map. This is the single entry point scenes should use when
 * they receive a `mapPath` from a tile link — the caller doesn't need
 * to know whether it's a town or an interior.
 */
export function resolveTownOrInterior(towns: Town[], path: string): Town | null {
  if (path.includes("/")) return getInteriorByPath(towns, path);
  return getTownByName(towns, path);
}

/**
 * Returns the parent town's name for a "Town/Interior" path, or null
 * for a bare town name (which has no parent).
 *
 * Useful for scenes that need to know which town to return to from an
 * interior — interior exits link back via `town:<TownName>` already,
 * so this is mostly a fallback for cases where the interior data is
 * missing that link.
 */
export function parentTownName(path: string): string | null {
  const idx = path.indexOf("/");
  return idx > 0 ? path.slice(0, idx) : null;
}

/** Re-export the link type so scenes don't need to import from TileMap. */
export type { TileLink };

/** Test-only: clear the loader cache so each test starts fresh. */
export function _clearTownCache(): void {
  _townCache = null;
}
