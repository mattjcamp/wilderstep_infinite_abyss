/**
 * v1-numeric-tile-id → v2-cell mapping table.
 *
 * The v1 procedural generator (`v1battle/world/Dungeon.ts`) emits
 * numeric tile ids (TILE_DFLOOR = 20, TILE_DWALL = 21, …). v2 paints
 * with string-keyed cells that carry their own sprite + walkability.
 * This module is the bridge: it returns a v2-shaped cell prototype
 * for any tile id the generator can emit, in any of the three
 * dungeon styles.
 *
 * Each prototype carries the minimum fields the editor's `TileType`
 * and the simulator's `SimCell` both consume. Callers (the
 * dungeon-level → MapRecord converter) deep-copy the prototype per
 * cell and patch any per-cell extras (e.g. `link` on stairs).
 *
 * The mapping is intentionally hardcoded by *style* (cave / forest /
 * default). When a tile id has no style override (e.g. TILE_CHEST),
 * the default prototype is reused across all styles.
 */

import {
  TILE_DFLOOR,
  TILE_DDOOR,
  TILE_DUNGEON,
  TILE_FOREST,
  TILE_FOREST_ARCHWAY_DOWN,
  TILE_FOREST_ARCHWAY_UP,
  TILE_GRASS,
  TILE_LOCKED_DOOR,
  TILE_MOUNTAIN,
  TILE_PATH,
  TILE_SAND,
  TILE_STAIRS_DOWN,
  TILE_WALL_TORCH,
  TILE_WATER,
} from "@/v1battle/world/Tiles";
import {
  TILE_ARTIFACT,
  TILE_CHEST,
  TILE_DWALL,
  TILE_STAIRS,
  TILE_TRAP,
} from "@/v1battle/world/Dungeon";
import type { DungeonStyle } from "@/v1battle/world/Dungeon";

/** Prototype shape — the union of fields TileType (editor) and
 *  SimCell (simulator) read. Deep-copied per cell; per-cell extras
 *  (link, encounter overrides, …) are patched on top. */
export interface DungeonTilePrototype {
  /** v2 tile id used by the cell. Snake_case so it lines up with
   *  palette entries authors might add later — but no palette entry
   *  is required at runtime; the cell renders from `sprite` directly. */
  id: string;
  name: string;
  tag: string;
  walkable: boolean;
  obstructs: boolean;
  /** True = tile emits light (wall torches). Paired with
   *  `light_range`. The simulator's lighting pass picks this up the
   *  same as overworld torches. */
  light_source: boolean;
  light_range: number;
  /** Render texture path relative to `/sprites/`. The Phaser scene
   *  resolves it through `withBasePath("/sprites/" + sprite)`. */
  sprite: string;
  /** Most fields below are inert for dungeons but the editor's
   *  TileType schema requires them — populate with neutral defaults
   *  so the cell shape is fully compatible. */
  boat: boolean;
  locked: boolean;
  text: string;
  animation: "none" | "torch" | "fire" | "fairy" | "smoke";
  counter: string;
  encounter: string;
  spawn: string;
  item: string;
  quest: string;
  dungeon: string;
  npc: string;
  flags?: Record<string, unknown>;
  link?: { map_id: string; x: number; y: number } | null;
}

/** Build a fully-defaulted prototype with the supplied fields. Spread
 *  pattern keeps each call site short. */
function proto(over: Partial<DungeonTilePrototype>): DungeonTilePrototype {
  return {
    id: "dungeon_floor",
    name: "Dungeon Floor",
    tag: "dungeon",
    walkable: true,
    obstructs: false,
    light_source: false,
    light_range: 0,
    sprite: "map/stone_floor.png",
    boat: false,
    locked: false,
    text: "",
    animation: "none",
    counter: "",
    encounter: "",
    spawn: "",
    item: "",
    quest: "",
    dungeon: "",
    npc: "",
    link: null,
    ...over,
  };
}

/** ── Style-agnostic dungeon furniture ─────────────────────────────
 *  Stairs / chests / traps / torches look the same regardless of
 *  whether you're in a cave or a stone dungeon. */

const STAIRS_UP_PROTO = proto({
  id: "stairs_up",
  name: "Stairs Up",
  sprite: "map/stairs_up.png",
});

const STAIRS_DOWN_PROTO = proto({
  id: "stairs_down",
  name: "Stairs Down",
  sprite: "map/stairs_down.png",
});

const CHEST_PROTO = proto({
  id: "chest",
  name: "Chest",
  sprite: "map/chest_tile.png",
  // Walkable so the party can stand on the cell to open the chest.
  // The simulator doesn't model loot yet — the cell just reads as
  // floor with a chest overlay.
  walkable: true,
});

const TRAP_PROTO = proto({
  // Traps render as plain floor (concealed). The simulator doesn't
  // implement trap mechanics yet — this is the visual stand-in until
  // a trap subsystem lands.
  id: "dungeon_floor_trap",
  name: "Trap",
  sprite: "map/stone_floor.png",
});

const ARTIFACT_PROTO = proto({
  id: "quest_artifact",
  name: "Quest Artifact",
  // Reuse the chest sprite for now — the artifact pickup path isn't
  // wired up in v2 yet.
  sprite: "map/chest_tile.png",
});

const WALL_TORCH_PROTO = proto({
  id: "wall_torch",
  name: "Wall Torch",
  // A wall torch sits on a wall: blocks movement, casts light. The
  // sprite includes the wall + torch composite. Light radius is 5
  // tiles — the dungeon-specific convention; the regular map
  // editor still uses smaller torches for overworld scenes.
  walkable: false,
  obstructs: true,
  light_source: true,
  light_range: 5,
  sprite: "map/wall_torch.png",
  animation: "torch",
});

const DUNGEON_DOOR_PROTO = proto({
  id: "dungeon_door",
  name: "Dungeon Door",
  sprite: "map/dungeon_door.png",
});

const LOCKED_DOOR_PROTO = proto({
  id: "door_locked",
  name: "Locked Door",
  // Locked doors gate movement until picked / knocked. The simulator
  // already handles `locked: true` and opens the Pick Lock dialog.
  walkable: false,
  obstructs: false,
  locked: true,
  sprite: "map/locked_door.png",
});

/** ── Style-default tiles (stone dungeon) ──────────────────────── */
const DEFAULT_FLOOR_PROTO = proto({
  id: "dungeon_floor",
  name: "Dungeon Floor",
  sprite: "map/stone_floor.png",
});

const DEFAULT_WALL_PROTO = proto({
  id: "dungeon_wall",
  name: "Dungeon Wall",
  walkable: false,
  obstructs: true,
  sprite: "map/stone_wall.png",
});

/** ── Cave style tiles ─────────────────────────────────────────── */
const CAVE_FLOOR_PROTO = proto({
  id: "path",
  name: "Cave Floor",
  tag: "terrain",
  sprite: "map/path.png",
});

const CAVE_WALL_PROTO = proto({
  id: "mountain",
  name: "Cave Wall",
  tag: "outdoor",
  walkable: false,
  obstructs: true,
  sprite: "map/mountains.png",
});

/** ── Forest style tiles ──────────────────────────────────────── */
const FOREST_FLOOR_PROTO = proto({
  id: "grass",
  name: "Grass",
  tag: "outdoor",
  sprite: "map/grass1.png",
});

const FOREST_WALL_PROTO = proto({
  id: "forest",
  name: "Forest",
  tag: "outdoor",
  walkable: false,
  obstructs: true,
  sprite: "map/forest2.png",
});

const FOREST_PATH_PROTO = proto({
  id: "path",
  name: "Path",
  tag: "terrain",
  sprite: "map/path.png",
});

const FOREST_ARCHWAY_UP_PROTO = proto({
  id: "stairs_up",
  name: "Forest Archway",
  // Reuse the stairs-up sprite — v2's seed module doesn't ship a
  // dedicated archway tile yet. Authors can swap the sprite later.
  sprite: "map/stairs_up.png",
});

const FOREST_ARCHWAY_DOWN_PROTO = proto({
  id: "stairs_down",
  name: "Forest Archway (Down)",
  sprite: "map/stairs_down.png",
});

/** Resolve a v1 numeric tile id to a v2 cell prototype. Returns null
 *  for tile ids the generator never emits OR cosmetic ids the
 *  simulator can safely skip (puddles / moss). Callers default to a
 *  plain-floor prototype on null. */
export function prototypeForTileId(
  tileId: number,
  style: DungeonStyle,
): DungeonTilePrototype | null {
  // Style-agnostic furniture takes precedence.
  switch (tileId) {
    case TILE_STAIRS:
      return STAIRS_UP_PROTO;
    case TILE_STAIRS_DOWN:
      return STAIRS_DOWN_PROTO;
    case TILE_CHEST:
      return CHEST_PROTO;
    case TILE_TRAP:
      return TRAP_PROTO;
    case TILE_ARTIFACT:
      return ARTIFACT_PROTO;
    case TILE_WALL_TORCH:
      return WALL_TORCH_PROTO;
    case TILE_DDOOR:
      return DUNGEON_DOOR_PROTO;
    case TILE_LOCKED_DOOR:
      return LOCKED_DOOR_PROTO;
    case TILE_FOREST_ARCHWAY_UP:
      return FOREST_ARCHWAY_UP_PROTO;
    case TILE_FOREST_ARCHWAY_DOWN:
      return FOREST_ARCHWAY_DOWN_PROTO;
  }
  // Style-dependent floor / wall.
  if (style === "caves") {
    switch (tileId) {
      case TILE_PATH:
      case TILE_DFLOOR:
        return CAVE_FLOOR_PROTO;
      case TILE_MOUNTAIN:
      case TILE_DWALL:
        return CAVE_WALL_PROTO;
    }
  }
  if (style === "forest") {
    switch (tileId) {
      case TILE_GRASS:
      case TILE_DFLOOR:
        return FOREST_FLOOR_PROTO;
      case TILE_FOREST:
      case TILE_DWALL:
        return FOREST_WALL_PROTO;
      case TILE_PATH:
        return FOREST_PATH_PROTO;
    }
  }
  // "ruins" (stone-block dungeon) — and the fallback for any style
  // we haven't taught the mapper about yet.
  switch (tileId) {
    case TILE_DFLOOR:
    case TILE_PATH:
      return DEFAULT_FLOOR_PROTO;
    case TILE_DWALL:
    case TILE_MOUNTAIN:
      return DEFAULT_WALL_PROTO;
    case TILE_GRASS:
      return FOREST_FLOOR_PROTO; // generic grass fallback
    case TILE_WATER:
      return proto({
        id: "water",
        name: "Water",
        tag: "water",
        walkable: false,
        sprite: "map/water.png",
      });
    case TILE_SAND:
      return proto({
        id: "sand",
        name: "Sand",
        tag: "outdoor",
        sprite: "map/sand.png",
      });
    case TILE_FOREST:
      return FOREST_WALL_PROTO;
    case TILE_DUNGEON:
      return proto({
        id: "dungeon_entrance",
        name: "Dungeon Entrance",
        sprite: "map/dungeon_entrance.png",
      });
  }
  // Cosmetic / unknown — caller can decide what to do.
  return null;
}

/** Sprite paths every dungeon scene needs preloaded, regardless of
 *  which tile ids the level actually carries. Hand to Phaser's
 *  preload pass so transitions feel instant. */
export const DUNGEON_SPRITE_KEYS: readonly string[] = [
  "map/stone_floor.png",
  "map/stone_wall.png",
  "map/stairs_up.png",
  "map/stairs_down.png",
  "map/chest_tile.png",
  "map/wall_torch.png",
  "map/dungeon_door.png",
  "map/locked_door.png",
  "map/path.png",
  "map/mountains.png",
  "map/grass1.png",
  "map/forest2.png",
  "map/water.png",
  "map/sand.png",
  "map/dungeon_entrance.png",
];
