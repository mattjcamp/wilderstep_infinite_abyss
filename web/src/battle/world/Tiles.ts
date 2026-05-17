/**
 * Tile id constants and per-tile properties.
 *
 * Mirrors the relevant subset of `src/settings.py` from the Python
 * project — same numeric ids so loaded maps drop in unchanged.
 *
 * The hardcoded `DEFS` table below carries walkability + fallback
 * colour for the overworld tile set + encounter-trigger glyphs.
 * Per-cell sprite/walkable comes from the v2 map record at render
 * time; this module exists for the small set of callers that need
 * to reason about tiles synchronously by numeric id (encounter-
 * trigger detection, overworld fallback rendering).
 */

import { BASE_PATH } from "./Module";

// ── Overworld tiles ─────────────────────────────────────────────
export const TILE_GRASS = 0;
export const TILE_WATER = 1;
export const TILE_FOREST = 2;
export const TILE_MOUNTAIN = 3;
export const TILE_TOWN = 4;
export const TILE_DUNGEON = 5;
export const TILE_PATH = 6;
export const TILE_SAND = 7;
export const TILE_BRIDGE = 8;
export const TILE_DUNGEON_CLEARED = 9;
export const TILE_BOAT = 64;

// ── Combat-encounter triggers (overworld) ──────────────────────
export const TILE_SPAWN = 66;
export const TILE_SPAWN_CAMPFIRE = 67;
export const TILE_SPAWN_GRAVEYARD = 68;
export const TILE_ENCOUNTER = 69;

// ── Misc / decorative ──────────────────────────────────────────
export const TILE_FOREST_ARCHWAY_UP = 77;
export const TILE_FOREST_ARCHWAY_DOWN = 78;

// ── Town interior tiles ────────────────────────────────────────
// (subset of `src/settings.py` TILE_DEFS keyed by their id)
export const TILE_TOWN_FLOOR = 10;
export const TILE_TOWN_WALL = 11;
export const TILE_TOWN_COUNTER = 12;
export const TILE_DOOR = 13;
export const TILE_DFLOOR = 20;
export const TILE_STAIRS_DOWN = 25;
export const TILE_DDOOR = 26;
export const TILE_LOCKED_DOOR = 29;
export const TILE_WALL_TORCH = 34;
export const TILE_BRICK = 37;
export const TILE_SHRINE = 45;
export const TILE_PATH_FLOOR = 46;
export const TILE_SAND_FLOOR = 47;
export const TILE_FLOOR_GRAY = 48;
export const TILE_BRICK_BROWN = 49;
export const TILE_GRASS_PLAINS = 50;
export const TILE_BRICK_LIGHTER = 51;
export const TILE_SHOP_SIGN = 52;
export const TILE_TOWN_WATER = 53;
export const TILE_SCRUB = 54;
export const TILE_TOWN_GATE = 56;
export const TILE_WEAPON_COUNTER = 57;
export const TILE_ARMOR_COUNTER = 58;
export const TILE_MAGIC_COUNTER = 59;
export const TILE_SHOP_ARMOR = 60;
export const TILE_HEALING_COUNTER = 61;
export const TILE_FLOOR_LIGHT = 63;
export const TILE_LIGHT_SAND = 70;
export const TILE_WINDOW = 72;

/**
 * Per-tile flag block carried over from `tile_defs.json`. Authors set
 * these once per tile id (in contrast to `tile_properties` which set
 * them per-cell on a specific map).
 *
 * Most flags are radiance/light-related. `transparent` is used by the
 * lighting model to let light pass through water and similar.
 */
export interface TileFlags {
  /** This tile id always emits its own light (e.g., wall torch). */
  light_source?: boolean;
  light_radius?: number;
  light_intensity?: number;
  /**
   * The tile is a "feature" that emits light at a smaller radius —
   * doors, exits, and altars get this so a lit doorway shows up in
   * an otherwise-dark interior.
   */
  feature_light?: boolean;
  feature_radius?: number;
  feature_intensity?: number;
  /** Light passes through this tile (water, windows, etc.). */
  transparent?: boolean;
}

export interface TileDef {
  /** Fallback color when no sprite is loaded for this tile id. */
  color: [number, number, number];
  walkable: boolean;
  name: string;
  /**
   * Sprite path under /assets/. When present the renderer draws the
   * image instead of a coloured rectangle. Tiles without a sprite
   * (spawn markers, encounter glyphs) keep the rectangle fallback.
   */
  sprite?: string;
  /** Optional per-tile-id flag block. */
  flags?: TileFlags;
}

const FALLBACK: TileDef = { color: [60, 60, 60], walkable: false, name: "Unknown" };

/**
 * Hardcoded defs for overworld tiles + encounter trigger glyphs.
 *
 * Sprite paths follow the canonical `/assets/<key>.png` convention;
 * town/dungeon tiles aren't here — they're per-cell on a v2 map.
 */
const DEFS: Record<number, TileDef> = {
  [TILE_GRASS]:    { color: [34, 139, 34],  walkable: true,  name: "Grass",
                     sprite: `${BASE_PATH}/assets/overworld/grass.png` },
  [TILE_WATER]:    { color: [30, 90, 180],  walkable: false, name: "Water",
                     sprite: `${BASE_PATH}/assets/overworld/water.png` },
  [TILE_FOREST]:   { color: [0, 80, 0],     walkable: true,  name: "Forest",
                     sprite: `${BASE_PATH}/assets/overworld/forest.png` },
  [TILE_MOUNTAIN]: { color: [130, 130, 130],walkable: false, name: "Mountain",
                     sprite: `${BASE_PATH}/assets/overworld/mountain.png` },
  [TILE_TOWN]:     { color: [180, 140, 80], walkable: true,  name: "Town",
                     sprite: `${BASE_PATH}/assets/overworld/town.png` },
  [TILE_DUNGEON]:  { color: [120, 40, 80],  walkable: true,  name: "Dungeon",
                     sprite: `${BASE_PATH}/assets/overworld/dungeon.png` },
  [TILE_PATH]:     { color: [160, 140, 100],walkable: true,  name: "Path",
                     sprite: `${BASE_PATH}/assets/overworld/path.png` },
  [TILE_SAND]:     { color: [210, 190, 130],walkable: true,  name: "Sand",
                     sprite: `${BASE_PATH}/assets/overworld/sand.png` },
  [TILE_BRIDGE]:   { color: [140, 100, 50], walkable: true,  name: "Bridge",
                     sprite: `${BASE_PATH}/assets/overworld/bridge.png` },
  [TILE_DUNGEON_CLEARED]: { color: [80, 70, 60], walkable: true, name: "Cleared Dungeon",
                     sprite: `${BASE_PATH}/assets/overworld/dungeon_cleared.png` },
  // Encounter triggers: rendered with a ✦ glyph overlaid on the
  // fallback colour. Sprites in /assets/items/campfire.png etc. are
  // available via tile_defs.json runtime entries if a scene wants
  // them, but the overworld leaves these as glyphs by design so the
  // player can spot encounters at a glance.
  [TILE_BOAT]:     { color: [110, 70, 40],  walkable: true,  name: "Boat" },
  [TILE_SPAWN]:    { color: [180, 40, 40],  walkable: true,  name: "Monster Spawn" },
  [TILE_SPAWN_CAMPFIRE]: { color: [200, 120, 30], walkable: true, name: "Campfire" },
  [TILE_SPAWN_GRAVEYARD]: { color: [120, 115, 105], walkable: true, name: "Graveyard" },
  [TILE_ENCOUNTER]: { color: [180, 60, 140], walkable: true,  name: "Encounter" },
  // Forest archways — bright, distinct fallback colours so a portal
  // still reads as a portal against forest foliage even before the
  // sprite PNG loads. The canonical art is in
  // `assets/dungeon/forest_archway_*.png`; these are the safety net.
  [TILE_FOREST_ARCHWAY_UP]:   { color: [220, 180, 90],  walkable: true, name: "Forest Archway" },
  [TILE_FOREST_ARCHWAY_DOWN]: { color: [100, 120, 210], walkable: true, name: "Forest Archway" },
};

/** Path to the player avatar sprite. */
export const PLAYER_SPRITE = `${BASE_PATH}/assets/overworld/party_marker.png`;

/**
 * Look up the def for a tile id. Returns FALLBACK (grey "Unknown")
 * when the id isn't in the hardcoded table.
 */
export function tileDef(id: number): TileDef {
  return DEFS[id] ?? FALLBACK;
}

/** Tiles that should kick off a combat encounter when stepped on. */
const TRIGGER_IDS = new Set<number>([
  TILE_SPAWN,
  TILE_SPAWN_CAMPFIRE,
  TILE_SPAWN_GRAVEYARD,
  TILE_ENCOUNTER,
]);

export function isEncounterTrigger(id: number): boolean {
  return TRIGGER_IDS.has(id);
}
