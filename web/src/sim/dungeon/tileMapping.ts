/**
 * v1-numeric-tile-id → v2-cell mapping table.
 *
 * The v1 procedural generator (`battle/world/Dungeon.ts`) emits
 * numeric tile ids (TILE_DFLOOR = 20, TILE_DWALL = 21, …). v2 paints
 * with string-keyed cells that carry their own sprite + walkability.
 * This module is the bridge: it returns a v2-shaped cell prototype
 * for any tile id the generator can emit, in either dungeon style
 * (`"dungeon"` → Dungeon Tileset, `"cavern"` → Cave Tileset).
 *
 * Each prototype carries the minimum fields the editor's `TileType`
 * and the simulator's `SimCell` both consume. Callers (the
 * dungeon-level → MapRecord converter) deep-copy the prototype per
 * cell and patch any per-cell extras (e.g. `link` on stairs).
 *
 * Floor / walls / stairs / doors / torches / traps come from the
 * style's tileset; chests and quest artifacts are shared.
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
  TILE_LOCKED_DOOR,
  TILE_STAIRS_DOWN,
  TILE_WALL_TORCH,
} from "@/battle/world/Tiles";
import {
  TILE_ARTIFACT,
  TILE_CHEST,
  TILE_DWALL,
  TILE_PILLAR,
  TILE_PIT,
  TILE_RUBBLE,
  TILE_STAIRS,
  TILE_THRONE,
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
  link?: { map_id: string; x: number; y: number; fall?: boolean } | null;
  /** Staircase direction on generated-dungeon stairs cells. Paired
   *  with `show_link_placard` so stepping onto them asks first
   *  ("Climb up / down?") instead of changing floors on contact. */
  stairs?: "up" | "down";
  show_link_placard?: boolean;
  /** Pit / chasm cell. Monsters never step onto one, even when it's a
   *  walkable drop-through for the party. */
  pit?: boolean;
  /** Room object (pillar, stalagmite, rubble, throne) — drawn over the
   *  floor beneath it. */
  object?: boolean;
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
    paletteId: "dungeon_floor_flagstone",
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

/** ── Shared dungeon furniture / bases ─────────────────────────────
 *  Chests and artifacts look the same in every style; the trap and
 *  torch prototypes are bases each tileset re-skins. */

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
  // The `paletteId` here is a base — each tileset re-stamps it with
  // its own floor so a trap reads as the surrounding floor.
  id: "dungeon_floor_trap",
  name: "Trap",
  paletteId: "dungeon_floor_flagstone",
  trap: true,
});

const ARTIFACT_PROTO = proto({
  id: "quest_artifact",
  name: "Quest Artifact",
  // Reuse the chest sprite for now — the artifact pickup path isn't
  // wired up in v2 yet.
  paletteId: CHEST_PALETTE_ID,
});

/** Pit / chasm base. Blocks movement but not sight (you can look
 *  across a chasm). The converter's pit pass swaps in the right rim
 *  piece per cell; `paletteId` here is the solid-centre fallback. */
function pitProto(prefix: "dungeon" | "cave"): DungeonTilePrototype {
  return proto({
    id: `${prefix}_pit`,
    name: prefix === "cave" ? "Cave Chasm" : "Dungeon Pit",
    walkable: false,
    obstructs: false,
    pit: true,
    paletteId: `${prefix}_pit_centre`,
  });
}
const DT_PIT_PROTO = pitProto("dungeon");
const CV_PIT_PROTO = pitProto("cave");

/** Room objects. Pillars and stalagmites are tall — they block sight
 *  like a column; rubble and the throne are low. */
function objectProto(id: string, name: string, obstructs: boolean): DungeonTilePrototype {
  return proto({ id, name, paletteId: id, walkable: false, obstructs, object: true });
}
const DT_PILLAR_PROTO = objectProto("dungeon_pillar", "Dungeon Pillar", true);
const DT_RUBBLE_PROTO = objectProto("dungeon_rubble", "Dungeon Rubble", false);
const DT_THRONE_PROTO = objectProto("dungeon_throne", "Dungeon Throne", false);
const CV_STALAGMITE_PROTO = objectProto("cave_stalagmite", "Cave Stalagmite", true);
const CV_RUBBLE_PROTO = objectProto("cave_rubble", "Cave Rubble", false);

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
  paletteId: "dungeon_wall_top",
  animation: "torch",
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
      return CV_FLOOR_PROTO;
    case TILE_DWALL:
      return CV_WALL_PROTO;
    case TILE_STAIRS:
      return CV_STAIRS_UP_PROTO;
    case TILE_STAIRS_DOWN:
      return CV_STAIRS_DOWN_PROTO;
    case TILE_DDOOR:
      return CV_DOOR_PROTO;
    case TILE_LOCKED_DOOR:
      return CV_LOCKED_DOOR_PROTO;
    case TILE_WALL_TORCH:
      return CV_WALL_TORCH_PROTO;
    case TILE_TRAP:
      return { ...TRAP_PROTO, paletteId: CAVE_TILESET_FLOOR_ID };
    case TILE_PIT:
      return CV_PIT_PROTO;
    case TILE_PILLAR:
      return CV_STALAGMITE_PROTO;
    case TILE_RUBBLE:
      return CV_RUBBLE_PROTO;
    case TILE_THRONE:
      // The Cave Tileset has no throne; the dungeon one stands in.
      return DT_THRONE_PROTO;
  }
  return null;
}

function dungeonTilesetProto(tileId: number): DungeonTilePrototype | null {
  switch (tileId) {
    case TILE_DFLOOR:
      return DT_FLOOR_PROTO;
    case TILE_DWALL:
      return DT_WALL_PROTO;
    case TILE_STAIRS:
      return DT_STAIRS_UP_PROTO;
    case TILE_STAIRS_DOWN:
      return DT_STAIRS_DOWN_PROTO;
    case TILE_DDOOR:
      return DT_DOOR_PROTO;
    case TILE_LOCKED_DOOR:
      return DT_LOCKED_DOOR_PROTO;
    case TILE_WALL_TORCH:
      return DT_WALL_TORCH_PROTO;
    case TILE_TRAP:
      return { ...TRAP_PROTO, paletteId: DUNGEON_TILESET_FLOOR_ID };
    case TILE_PIT:
      return DT_PIT_PROTO;
    case TILE_PILLAR:
      return DT_PILLAR_PROTO;
    case TILE_RUBBLE:
      return DT_RUBBLE_PROTO;
    case TILE_THRONE:
      return DT_THRONE_PROTO;
  }
  return null;
}

/** Resolve a v1 numeric tile id to a v2 cell prototype. Returns null
 *  for tile ids the generator never emits OR cosmetic ids the
 *  simulator can safely skip (puddles / moss). Callers fall back to a
 *  wall prototype on null. */
export function prototypeForTileId(
  tileId: number,
  style: DungeonStyle,
): DungeonTilePrototype | null {
  // Each tileset has its own floor / walls / stairs / doors; chests +
  // artifacts fall through to the shared furniture.
  const p =
    style === "cavern" ? cavernTilesetProto(tileId) : dungeonTilesetProto(tileId);
  if (p) return p;
  switch (tileId) {
    case TILE_CHEST:
      return CHEST_PROTO;
    case TILE_ARTIFACT:
      return ARTIFACT_PROTO;
  }
  // Cosmetic / unknown — caller can decide what to do.
  return null;
}

/** Pit rim pieces shared by both tilesets (prefixed `dungeon_` /
 *  `cave_`). `pit` is the self-contained single-cell hole. */
export const PIT_PIECES = [
  "pit",
  "pit_centre",
  "pit_top",
  "pit_bottom",
  "pit_left",
  "pit_right",
  "pit_corner_tl",
  "pit_corner_tr",
  "pit_corner_bl",
  "pit_corner_br",
] as const;

/** Every palette id the dungeon prototypes can borrow art from. */
export const DUNGEON_PALETTE_IDS: readonly string[] = [
  CHEST_PALETTE_ID,
  // Dungeon Tileset style — floor, furniture and every wall piece the
  // autotiler can pick.
  DUNGEON_TILESET_FLOOR_ID,
  "dungeon_stairs_up",
  "dungeon_stairs",
  "dungeon_door",
  "dungeon_wall_top",
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
  "cave_wall_left",
  "cave_wall_right",
  "cave_wall_divider",
  "cave_wall_corner_tl",
  "cave_wall_corner_tr",
  "cave_wall_t_down",
  "cave_wall_t_up",
  "cave_pit_centre",
  // Floor variants, wall decorations and room objects.
  "dungeon_floor_cobble",
  "dungeon_floor_smooth",
  "dungeon_floor_pebbles",
  "dungeon_floor_brick",
  "dungeon_floor_planks",
  "dungeon_floor_grate",
  "cave_floor_sand",
  "cave_floor_slab",
  "cave_floor_crystal",
  "dungeon_wall_banner",
  "dungeon_wall_window",
  "cave_wall_crack",
  "cave_wall_crystals",
  "cave_wall_webs",
  "dungeon_pillar",
  "dungeon_rubble",
  "dungeon_throne",
  // Pit rims — every piece the pit pass can pick, both tilesets.
  ...PIT_PIECES.map((p) => `dungeon_${p}`),
  ...PIT_PIECES.map((p) => `cave_${p}`),
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
