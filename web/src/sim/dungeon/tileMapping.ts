/**
 * v1-numeric-tile-id → v2-cell mapping table.
 *
 * The v1 procedural generator (`battle/world/Dungeon.ts`) emits
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
 * The mapping is hardcoded by *style* (cave / forest / default). When
 * a tile id has no style override (e.g. TILE_CHEST), the default
 * prototype is reused across all styles.
 *
 * Prototypes never name a sprite file. Each names the `map_tiles`
 * palette id it borrows art from (`paletteId`); the converter looks
 * the sprite up in the module's palette. A palette missing that id
 * leaves the cell without art rather than pointing at a file the
 * module may not ship.
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
} from "@/battle/world/Tiles";
import {
  TILE_ARTIFACT,
  TILE_CHEST,
  TILE_DWALL,
  TILE_STAIRS,
  TILE_TRAP,
} from "@/battle/world/Dungeon";
import type { DungeonStyle } from "@/battle/world/Dungeon";

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
  /** Render texture path relative to `/sprites/`. Empty on the
   *  prototypes — filled from the module's tile palette via
   *  `paletteId` (see `resolveDungeonSprite`), so dungeon art always
   *  comes from the module, never from paths baked into the engine. */
  sprite: string;
  /** `map_tiles` palette id whose sprite this cell borrows. */
  paletteId: string;
  /** Most fields below are inert for dungeons but the editor's
   *  TileType schema requires them — populate with neutral defaults
   *  so the cell shape is fully compatible. */
  boat: boolean;
  /** True for water cells (boats sail, NPCs avoid). */
  water?: boolean;
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
  /** True for TILE_TRAP cells — picked up by the kernel's step
   *  handler to fire a `trap_triggered` event. Cleared once the
   *  trap goes off so a single tile is one-shot. */
  trap: boolean;
  flags?: Record<string, unknown>;
  link?: { map_id: string; x: number; y: number } | null;
  /** Optional overlay sprite drawn ON TOP of the cell's base
   *  sprite — used by "placed item" tiles (chests, etc.) so the
   *  floor underneath shows through the sprite's transparent
   *  pixels. The base sprite is the style's floor; this is the
   *  thing sitting on it. When undefined / empty, the cell
   *  renders as just its base. */
  placedItemSprite?: string;
  /** Sprite drawn UNDER `sprite` — set by the Dungeon Tileset
   *  autotiler on thin strip walls so the room's floor shows through
   *  their transparent pixels. */
  background_sprite?: string;
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
    sprite: "",
    paletteId: "floor",
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
    trap: false,
    link: null,
    ...over,
  };
}

/** Palette id of the chest art (the old bare "chest" id was retired
 *  in the 2026-10 tile trim; the Default palette ships "object_chest"). */
export const CHEST_PALETTE_ID = "object_chest";

/** ── Style-agnostic dungeon furniture ─────────────────────────────
 *  Stairs / chests / traps / torches look the same regardless of
 *  whether you're in a cave or a stone dungeon. */

const STAIRS_UP_PROTO = proto({
  id: "stairs_up",
  name: "Stairs Up",
  paletteId: "stairs_up",
});

const STAIRS_DOWN_PROTO = proto({
  id: "stairs_down",
  name: "Stairs Down",
  paletteId: "stairs_down",
});

const CHEST_PROTO = proto({
  id: "chest",
  name: "Chest",
  paletteId: CHEST_PALETTE_ID,
  // Walkable so the party can stand on the cell to open the chest.
  // The simulator doesn't model loot yet — the cell just reads as
  // floor with a chest overlay.
  walkable: true,
});

const TRAP_PROTO = proto({
  // Traps render as plain floor (concealed) until the party either
  // steps on one (triggers it, dealing 3-8 damage to a random alive
  // member) or has the Detect Traps party effect active (host paints
  // a red-X overlay through the bridge). The `trap: true` flag is
  // what the kernel's step handler reads to emit `trap_triggered`.
  //
  // The `sprite` here is a fallback — the actual rendered sprite is
  // re-stamped per dungeon style at lookup time in `prototypeForTileId`
  // so a cave-style dungeon's trap reads as a cave floor (not a
  // ruins-style stone-block floor that pops as an obviously-different
  // gray square in the surrounding map). Hardcoding stone_floor.png
  // here only matched the "ruins" style by coincidence.
  id: "dungeon_floor_trap",
  name: "Trap",
  paletteId: "floor",
  trap: true,
});

/** Resolve the style-appropriate floor sprite. Mirrors the floor
 *  resolution `prototypeForTileId` does for TILE_DFLOOR but is
 *  surfaced as a tiny helper because the trap prototype needs the
 *  same answer (so a trap reads as floor-on-the-current-style, not
 *  as a hardcoded stone block). */
function floorPaletteIdFor(style: DungeonStyle): string {
  if (style === "caves") return CAVE_FLOOR_PROTO.paletteId;
  if (style === "forest") return FOREST_FLOOR_PROTO.paletteId;
  return DEFAULT_FLOOR_PROTO.paletteId;
}

const ARTIFACT_PROTO = proto({
  id: "quest_artifact",
  name: "Quest Artifact",
  // Reuse the chest sprite for now — the artifact pickup path isn't
  // wired up in v2 yet.
  paletteId: CHEST_PALETTE_ID,
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
  paletteId: "wall_stone",
  animation: "torch",
});

const DUNGEON_DOOR_PROTO = proto({
  id: "dungeon_door",
  name: "Dungeon Door",
  paletteId: "door",
});

const LOCKED_DOOR_PROTO = proto({
  id: "door_locked",
  name: "Locked Door",
  // Locked doors gate movement until picked / knocked. The simulator
  // already handles `locked: true` and opens the Pick Lock dialog.
  walkable: false,
  obstructs: false,
  locked: true,
  paletteId: "door_locked",
});

/** ── Style-default tiles (stone dungeon) ──────────────────────── */
const DEFAULT_FLOOR_PROTO = proto({
  id: "dungeon_floor",
  name: "Dungeon Floor",
  paletteId: "floor",
});

const DEFAULT_WALL_PROTO = proto({
  id: "dungeon_wall",
  name: "Dungeon Wall",
  walkable: false,
  obstructs: true,
  paletteId: "wall_stone",
});

/** ── Cave style tiles ─────────────────────────────────────────── */
const CAVE_FLOOR_PROTO = proto({
  id: "grass",
  name: "Cave Floor",
  tag: "terrain",
  paletteId: "grass",
});

const CAVE_WALL_PROTO = proto({
  id: "mountain",
  name: "Cave Wall",
  tag: "outdoor",
  walkable: false,
  obstructs: true,
  paletteId: "mountain",
});

/** ── Forest style tiles ──────────────────────────────────────── */
const FOREST_FLOOR_PROTO = proto({
  id: "grass",
  name: "Grass",
  tag: "outdoor",
  paletteId: "grass",
});

const FOREST_WALL_PROTO = proto({
  id: "tree",
  name: "Tree",
  tag: "outdoor",
  walkable: false,
  obstructs: true,
  paletteId: "tree",
});

const FOREST_PATH_PROTO = proto({
  id: "grass",
  name: "Grass",
  tag: "terrain",
  paletteId: "grass",
});

const FOREST_ARCHWAY_UP_PROTO = proto({
  id: "stairs_up",
  name: "Forest Archway",
  // Was a gold archway sprite; uses the stairs-up art since the
  // 2026-10 tile trim until a forest arch is redrawn.
  paletteId: "stairs_up",
});

const FOREST_ARCHWAY_DOWN_PROTO = proto({
  id: "stairs_down",
  name: "Forest Archway (Down)",
  // Was a blue archway sprite; uses the stairs-down art since the
  // 2026-10 tile trim until a forest arch is redrawn.
  paletteId: "stairs_down",
});

/** ── Dungeon Tileset style ("dungeon") ─────────────────────────
 *  Flagstone floor, Dungeon Tileset doors / stairs. Walls start as
 *  one generic block (id "dungeon_wall"); the converter's autotile
 *  pass then picks each wall's directional piece from its
 *  neighbours (`autotileDungeonWalls`). */
export const DUNGEON_TILESET_FLOOR_ID = "dungeon_floor_flagstone";

const DT_FLOOR_PROTO = proto({
  id: DUNGEON_TILESET_FLOOR_ID,
  name: "Dungeon Floor, Flagstone",
  paletteId: DUNGEON_TILESET_FLOOR_ID,
});
const DT_WALL_PROTO = proto({
  id: "dungeon_wall",
  name: "Dungeon Wall",
  walkable: false,
  obstructs: true,
  paletteId: "dungeon_wall_top",
});
const DT_STAIRS_UP_PROTO = proto({
  id: "stairs_up",
  name: "Dungeon Stairs, Up",
  paletteId: "dungeon_stairs_up",
});
const DT_STAIRS_DOWN_PROTO = proto({
  id: "stairs_down",
  name: "Dungeon Stairs, Down",
  paletteId: "dungeon_stairs",
});
const DT_DOOR_PROTO = proto({
  id: "dungeon_door",
  name: "Dungeon Door",
  paletteId: "dungeon_door",
});
const DT_LOCKED_DOOR_PROTO = proto({
  id: "door_locked",
  name: "Locked Door",
  walkable: false,
  obstructs: false,
  locked: true,
  paletteId: "dungeon_door",
});
const DT_WALL_TORCH_PROTO = proto({
  ...WALL_TORCH_PROTO,
  paletteId: "dungeon_wall_top",
});

/** ── Cave Tileset style ("cavern") ─────────────────────────────
 *  Same shape as the Dungeon Tileset style with the cave pieces:
 *  dirt floor (the converter mixes in gravel / rock / moss patches),
 *  cave door + steps, walls autotiled from the generic "cave_wall". */
export const CAVE_TILESET_FLOOR_ID = "cave_floor_dirt";

const CV_FLOOR_PROTO = proto({
  id: CAVE_TILESET_FLOOR_ID,
  name: "Cave Floor, Dirt",
  paletteId: CAVE_TILESET_FLOOR_ID,
});
const CV_WALL_PROTO = proto({
  id: "cave_wall",
  name: "Cave Wall",
  walkable: false,
  obstructs: true,
  paletteId: "cave_wall_top",
});
const CV_STAIRS_UP_PROTO = proto({ id: "stairs_up", name: "Cave Steps, Up", paletteId: "cave_stairs_up" });
const CV_STAIRS_DOWN_PROTO = proto({ id: "stairs_down", name: "Cave Steps, Down", paletteId: "cave_stairs" });
const CV_DOOR_PROTO = proto({ id: "cave_door", name: "Cave Door", paletteId: "cave_door" });
const CV_LOCKED_DOOR_PROTO = proto({
  id: "door_locked",
  name: "Locked Door",
  walkable: false,
  obstructs: false,
  locked: true,
  paletteId: "cave_door",
});
const CV_WALL_TORCH_PROTO = proto({ ...WALL_TORCH_PROTO, paletteId: "cave_wall_top" });

function cavernTilesetProto(tileId: number): DungeonTilePrototype | null {
  switch (tileId) {
    case TILE_DFLOOR:
    case TILE_PATH:
    case TILE_GRASS:
    case TILE_SAND:
      return CV_FLOOR_PROTO;
    case TILE_DWALL:
    case TILE_MOUNTAIN:
    case TILE_FOREST:
      return CV_WALL_PROTO;
    case TILE_STAIRS:
    case TILE_FOREST_ARCHWAY_UP:
      return CV_STAIRS_UP_PROTO;
    case TILE_STAIRS_DOWN:
    case TILE_FOREST_ARCHWAY_DOWN:
      return CV_STAIRS_DOWN_PROTO;
    case TILE_DDOOR:
      return CV_DOOR_PROTO;
    case TILE_LOCKED_DOOR:
      return CV_LOCKED_DOOR_PROTO;
    case TILE_WALL_TORCH:
      return CV_WALL_TORCH_PROTO;
    case TILE_TRAP:
      return { ...TRAP_PROTO, paletteId: CAVE_TILESET_FLOOR_ID };
  }
  return null;
}

function dungeonTilesetProto(tileId: number): DungeonTilePrototype | null {
  switch (tileId) {
    case TILE_DFLOOR:
    case TILE_PATH:
    case TILE_GRASS:
    case TILE_SAND:
      return DT_FLOOR_PROTO;
    case TILE_DWALL:
    case TILE_MOUNTAIN:
    case TILE_FOREST:
      return DT_WALL_PROTO;
    case TILE_STAIRS:
    case TILE_FOREST_ARCHWAY_UP:
      return DT_STAIRS_UP_PROTO;
    case TILE_STAIRS_DOWN:
    case TILE_FOREST_ARCHWAY_DOWN:
      return DT_STAIRS_DOWN_PROTO;
    case TILE_DDOOR:
      return DT_DOOR_PROTO;
    case TILE_LOCKED_DOOR:
      return DT_LOCKED_DOOR_PROTO;
    case TILE_WALL_TORCH:
      return DT_WALL_TORCH_PROTO;
    case TILE_TRAP:
      return { ...TRAP_PROTO, paletteId: DUNGEON_TILESET_FLOOR_ID };
  }
  return null;
}

/** Resolve a v1 numeric tile id to a v2 cell prototype. Returns null
 *  for tile ids the generator never emits OR cosmetic ids the
 *  simulator can safely skip (puddles / moss). Callers default to a
 *  plain-floor prototype on null. */
export function prototypeForTileId(
  tileId: number,
  style: DungeonStyle,
): DungeonTilePrototype | null {
  // The Dungeon Tileset style has its own floor / walls / stairs /
  // doors; chests + artifacts fall through to the shared furniture.
  if (style === "dungeon") {
    const p = dungeonTilesetProto(tileId);
    if (p) return p;
  }
  if (style === "cavern") {
    const p = cavernTilesetProto(tileId);
    if (p) return p;
  }
  // Style-agnostic furniture takes precedence.
  switch (tileId) {
    case TILE_STAIRS:
      return STAIRS_UP_PROTO;
    case TILE_STAIRS_DOWN:
      return STAIRS_DOWN_PROTO;
    case TILE_CHEST:
      return CHEST_PROTO;
    case TILE_TRAP:
      // Concealed: a trap reads as the style's plain floor so the
      // player can't spot it without Detect Traps. The red-X reveal
      // is drawn separately by WorldRenderer.setDetectedTraps on top
      // of this base sprite, so swapping the base doesn't affect
      // detection.
      return { ...TRAP_PROTO, paletteId: floorPaletteIdFor(style) };
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
        water: true,
        walkable: false,
        paletteId: "water",
      });
    case TILE_SAND:
      // Sand was merged into Grass in the palette.
      return FOREST_FLOOR_PROTO;
    case TILE_FOREST:
      return FOREST_WALL_PROTO;
    case TILE_DUNGEON:
      return proto({
        id: "cave_entrance",
        name: "Cave Entrance",
        paletteId: "cave_entrance",
      });
  }
  // Cosmetic / unknown — caller can decide what to do.
  return null;
}

/** Every palette id the dungeon prototypes can borrow art from. */
export const DUNGEON_PALETTE_IDS: readonly string[] = [
  "floor",
  "wall_stone",
  "stairs_up",
  "stairs_down",
  CHEST_PALETTE_ID,
  // Dungeon Tileset style — floor, furniture and every wall piece the
  // autotiler can pick.
  DUNGEON_TILESET_FLOOR_ID,
  "dungeon_stairs_up",
  "dungeon_stairs",
  "dungeon_door",
  "dungeon_wall_top",
  "dungeon_wall_bottom",
  "dungeon_wall_left",
  "dungeon_wall_right",
  "dungeon_wall_divider",
  "dungeon_wall_corner_tl",
  "dungeon_wall_corner_tr",
  "dungeon_wall_t_down",
  "dungeon_wall_t_up",
  "dungeon_pit_centre",
  // Cave Tileset style — floors, furniture, features, wall pieces.
  CAVE_TILESET_FLOOR_ID,
  "cave_floor_gravel",
  "cave_floor_rock",
  "cave_floor_moss",
  "cave_stairs_up",
  "cave_stairs",
  "cave_door",
  "cave_stalagmite",
  "cave_rubble",
  "cave_wall_top",
  "cave_wall_bottom",
  "cave_wall_left",
  "cave_wall_right",
  "cave_wall_divider",
  "cave_wall_corner_tl",
  "cave_wall_corner_tr",
  "cave_wall_t_down",
  "cave_wall_t_up",
  "cave_pit_centre",
  "door",
  "door_locked",
  "mountain",
  "grass",
  "tree",
  "water",
  "cave_entrance",
];

/** Palette id → sprite lookup for a prototype's `paletteId`. Returns
 *  "" when the module's palette has no such tile. */
export function resolveDungeonSprite(
  paletteId: string,
  paletteSprites: ReadonlyMap<string, string> | undefined,
): string {
  return paletteSprites?.get(paletteId) ?? "";
}

/** Sprites a dungeon scene should preload, resolved from the module
 *  palette: every sprite the prototypes can borrow. */
export function dungeonSpriteKeys(
  paletteSprites: ReadonlyMap<string, string> | undefined,
): string[] {
  const out = new Set<string>();
  for (const id of DUNGEON_PALETTE_IDS) {
    const s = resolveDungeonSprite(id, paletteSprites);
    if (s) out.add(s);
  }
  return [...out];
}
