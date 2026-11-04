/**
 * Convert a v1 `DungeonLevel` (numeric-tile grid + decorations +
 * stairs metadata) into a v2-shaped map record the simulator can
 * mount. Pure — no DOM / Phaser dependencies.
 *
 * Each cell of the input grid maps onto a `DungeonTilePrototype`
 * (see tileMapping.ts) which is deep-cloned and patched with
 * per-cell extras:
 *   - Stairs cells (up / down) get a `link` field
 *     pointing at a synthetic neighbour map id so the simulator's
 *     existing link traversal fires on step. The host wires the
 *     synthetic ids to the actual floor-swap behaviour.
 *   - Cells that fall in `decorations` apply a torch / wall-torch
 *     overlay (light source). Cosmetic puddles / moss are dropped
 *     since the simulator doesn't use them.
 *
 * The resulting `DungeonMapRecord` is intentionally compatible with
 * the editor's `MapRecord` so the same Phaser scene + simulator can
 * render it without a code branch.
 */

import { autotileDungeonWalls } from "./dungeonAutotile";
import { TILE_WALL_TORCH } from "@/battle/world/Tiles";
import {
  TILE_CHEST,
  TILE_DWALL,
  TILE_STAIRS,
  TILE_STAIRS_DOWN,
} from "@/battle/world/Dungeon";
import { TILE_DFLOOR } from "@/battle/world/Tiles";
import {
  normalizeDungeonStyle,
  type DungeonLevel,
  type DungeonStyle,
} from "@/battle/world/Dungeon";
import {
  prototypeForTileId,
  CHEST_PALETTE_ID,
  DUNGEON_TILESET_FLOOR_ID,
  CAVE_TILESET_FLOOR_ID,
  PIT_PIECES,
  resolveDungeonSprite,
  type DungeonTilePrototype,
} from "./tileMapping";

/** A dungeon-level cell. Compatible with the editor's `TileType` and
 *  the simulator's `SimCell` — both consume this subset of fields. */
export interface DungeonMapCell extends DungeonTilePrototype {}

/** Link target for stairs-up at floor index 0 — the host wires this
 *  id to "exit the dungeon and resume the overworld sim". */
export const EXIT_TO_OVERWORLD_MAP_ID = "__dungeon_exit__";

/** Build the synthetic map id used to thread floors together via
 *  `tile.link.map_id`. Stable per dungeon so re-entering produces
 *  the same wiring. The MapEditor's dungeon-session bookkeeping
 *  intercepts these ids — they never resolve to a real authored
 *  map. */
export function floorMapId(dungeonId: string, floorIdx: number): string {
  return `__dungeon_${dungeonId}_f${floorIdx}__`;
}

/** Output shape. Mirrors enough of the editor's `MapRecord` to feed
 *  the same Phaser preload pass + the simulator. The `tags` carry a
 *  `dungeon` marker so any future filtering knows this isn't a
 *  hand-painted map. */
export interface DungeonMapRecord {
  id: string;
  name: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  grid: DungeonMapCell[][];
}

export interface DungeonLevelToMapOptions {
  dungeonId: string;
  /** 0-based floor index. Drives the stairs-up link target — F0
   *  exits to the overworld; F1+ goes back to the previous floor. */
  floorIdx: number;
  /** Total floor count for the dungeon. Used to decide whether
   *  stairs-down link to the next floor or to the overworld (bottom-
   *  floor exit). */
  totalFloors: number;
  /** `map_tiles` palette id → sprite path, built from the module's
   *  tile palette. Every cell's art resolves through it: each tile
   *  prototype names a palette id (`paletteId`). A missing id leaves
   *  that cell without art (the renderer skips empty sprites). */
  paletteSprites?: ReadonlyMap<string, string>;
}

/** Convert one floor. The output grid is `[row][col]` to match the
 *  editor's authoring convention. */
export function dungeonLevelToMap(
  level: DungeonLevel,
  opts: DungeonLevelToMapOptions,
): DungeonMapRecord {
  const { dungeonId, floorIdx, totalFloors } = opts;
  // Levels restored from older saves may carry a retired style name;
  // those render with the default Dungeon Tileset.
  const style: DungeonStyle = normalizeDungeonStyle(level.style);
  const grid: DungeonMapCell[][] = [];

  // The generator's tile grid carries a few "buffer" rows past the
  // declared height (see Dungeon.ts: `const BUFFER = 3;`). We respect
  // the level's *declared* dimensions and clip the buffer so the
  // simulator's grid lines up with what authoring expected.
  const renderHeight = level.height;
  const renderWidth = level.width;

  for (let r = 0; r < renderHeight; r++) {
    const row: DungeonMapCell[] = [];
    for (let c = 0; c < renderWidth; c++) {
      const tileId = level.tiles[r]?.[c] ?? -1;
      // Chests render as a "placed item" overlay on top of the
      // style's floor, not as a cell whose own sprite is the chest
      // art. With the chest sprite's background pixels alpha-zero,
      // the floor shows through naturally — the chest reads as
      // sitting on the floor, not floating in a void. Stairs and
      // other "placed" things could follow this same pattern
      // later; today only chests get it.
      const isChest = tileId === TILE_CHEST;
      const lookupId = isChest ? TILE_DFLOOR : tileId;
      const proto = prototypeForTileId(lookupId, style);
      // Fallback to a wall when the generator emitted an unmapped
      // tile id — safer than a walkable floor since we don't know
      // what the cell was supposed to be.
      const base: DungeonMapCell = proto
        ? cloneProto(proto)
        : cloneProto(prototypeForTileId(TILE_DWALL, style) ?? FALLBACK_WALL);
      // Art comes from the module's tile palette, never from a path
      // baked into the engine (see tileMapping.ts).
      base.sprite = resolveDungeonSprite(base.paletteId, opts.paletteSprites);
      // A trap that's already been triggered in this dungeon session
      // is just floor now — disarm the cell so it doesn't re-fire on
      // re-mount. The TRAP_PROTO already paints the floor sprite, so
      // we only need to clear the `trap` flag.
      if (base.trap && level.triggeredTraps.has(`${c},${r}`)) {
        base.trap = false;
      }
      if (isChest) {
        // Identity bits carry over so the rest of the system can
        // tell "this is a chest cell" — walkability stays true (the
        // party can step onto a chest to interact), the sprite
        // stays the floor's, and an overlay carries the chest art.
        base.id = "chest";
        base.name = "Chest";
        base.placedItemSprite =
          resolveDungeonSprite(CHEST_PALETTE_ID, opts.paletteSprites) ||
          resolveDungeonSprite("chest", opts.paletteSprites);
        // Bind the cell to the configured chest ITEM so the kernel's
        // bump pipeline fires `chest_encountered` (the item is
        // authored `is_chest: true`) and the party gets its real
        // `contents` on Open — the same flow painted-map chests use.
        // `level.chestItem` is empty only on legacy levels generated
        // before loot config; those fall back to a contents-less chest
        // overlay exactly as before.
        if (level.chestItem) base.item = level.chestItem;
      }
      patchStairsLink(base, tileId, dungeonId, floorIdx, totalFloors);
      patchTileProperties(base, level, c, r);
      patchDecoration(base, level, c, r, style);
      row.push(base);
    }
    grid.push(row);
  }

  // Walking onto monster positions kicks off combat through the
  // placed-encounter subsystem. We do that by stamping an
  // `encounter` id onto each cell that holds a `DungeonMonster`.
  // The simulator's encounter pursuit picks them up at mount time.
  for (const m of level.monsters) {
    const cell = grid[m.row]?.[m.col];
    if (!cell) continue;
    // The encounter id mirrors the per-monster `encounterName` so
    // the host can resolve it back to a real encounter record. Falls
    // back to a synthesized id when the generator only carried a
    // monster name.
    if (m.encounterNames.length > 0) {
      // Use a per-cell unique synthetic id so two adjacent encounters
      // don't collapse into one. The host's encounter catalog must
      // include matching entries — see DungeonSimMount where we
      // synthesize them.
      cell.encounter = `__dungeon_enc_${m.id}__`;
    }
  }

  // Tileset dressing — floors, pits, walls, decorations, backdrops.
  applyTilesetStyle(grid, style, level, opts.paletteSprites, { dungeonId, floorIdx });

  return {
    id: floorMapId(dungeonId, floorIdx),
    name: level.name,
    description: "",
    tags: ["dungeon"],
    width: renderWidth,
    height: renderHeight,
    grid,
  };
}

/** Roll-up summary of every placed encounter on a floor. Hosts pass
 *  this into the simulator's encounter catalog so each
 *  `__dungeon_enc_*__` id the cells reference resolves to a real
 *  roster.
 *
 *  When `monsterSpriteById` is supplied, the helper resolves each
 *  lead monster's id (the generator stores it as `DungeonMonster.name`
 *  — really a monster_party_tile id, not a display name) to its
 *  sprite path. That populates `monster_party_tile` on the result
 *  so the placed-encounter renderer in DungeonSimMount draws the
 *  real monster sprite instead of falling back to the red marker.
 *
 *  Pure — no dependency on the simulator types. */
export function dungeonEncounterRefs(
  level: DungeonLevel,
  monsterSpriteById?: ReadonlyMap<string, string | undefined>,
): Array<{
  id: string;
  name: string;
  monster_party_tile?: string;
  monsters: string[];
  /** Optional tint (RGB, e.g. 0xffe580) applied on top of the
   *  cell's lighting tint at render time. Used to flag quest-target
   *  placements with a soft gold halo — the renderer multiplies
   *  this with the per-cell lighting so the tint reads naturally at
   *  any ambient. */
  tint?: number;
}> {
  return level.monsters.map((m) => {
    // `m.name` is what the v1 generator stored as
    // `enc.monsterPartyTile`. Despite the EncounterTemplate doc
    // comment calling that "monster id of the lead", the actual
    // encounters.json values (and what the generator copies
    // through here) are SPRITE PATHS in the form
    // "monster/giant_rat.png" — directly usable as Phaser texture
    // keys without going through the id-keyed monsterSpriteById
    // lookup. (A prior version of this helper tried to resolve
    // `m.name` as an id, always missed, and the placed-encounter
    // renderer fell back to the green party-marker placeholder —
    // the missing-sprite bug the user reported on quest monsters.)
    //
    // We still accept `monsterSpriteById` as a parameter for
    // forward compat: if a future generator path ever stores a
    // real monster id in `m.name`, the lookup picks up its sprite
    // first; otherwise we keep `m.name` as the resolved key.
    const looked = monsterSpriteById?.get(m.name);
    const spritePath = looked ?? m.name;
    return {
      id: `__dungeon_enc_${m.id}__`,
      name: m.encounterName,
      monster_party_tile: spritePath,
      monsters: m.encounterNames.length > 0
        ? [...m.encounterNames]
        : [m.name],
      // Quest-target placements get the gold halo. The exact hue
      // is `0xffe580` — bright enough to stand out at full
      // lighting, soft enough that the multiply blend with a dim
      // ambient still reads as "tinted yellow" rather than
      // washing out the underlying sprite.
      tint: m.questName ? 0xffe580 : undefined,
    };
  });
}

// ── internals ──────────────────────────────────────────────────────

const FALLBACK_WALL: DungeonTilePrototype = {
  id: "dungeon_wall",
  name: "Dungeon Wall",
  tag: "dungeon",
  walkable: false,
  obstructs: true,
  light_source: false,
  light_range: 0,
  sprite: "",
  paletteId: "dungeon_wall_top",
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
};

function cloneProto(p: DungeonTilePrototype): DungeonMapCell {
  return { ...p, link: p.link ? { ...p.link } : null };
}

/** Stairs cells need a `link.map_id` so the simulator's existing
 *  link-traversal path fires on step. The `x`/`y` in the link
 *  describe *where on the destination map* the party should land —
 *  this matches the editor's link convention. For dungeon transitions
 *  the host swaps maps wholesale, so the coords are best-effort
 *  (host pins to the destination floor's matching stairs cell). */
function patchStairsLink(
  cell: DungeonMapCell,
  tileId: number,
  dungeonId: string,
  floorIdx: number,
  totalFloors: number,
): void {
  // Up — exit to previous floor, or to overworld at floor 0.
  if (tileId === TILE_STAIRS) {
    if (floorIdx === 0) {
      cell.link = { map_id: EXIT_TO_OVERWORLD_MAP_ID, x: 0, y: 0 };
    } else {
      cell.link = {
        map_id: floorMapId(dungeonId, floorIdx - 1),
        x: 0,
        y: 0,
      };
    }
    return;
  }
  // Down — descend, or exit at the bottom of a multi-level dungeon.
  if (tileId === TILE_STAIRS_DOWN) {
    if (floorIdx >= totalFloors - 1) {
      cell.link = { map_id: EXIT_TO_OVERWORLD_MAP_ID, x: 0, y: 0 };
    } else {
      cell.link = {
        map_id: floorMapId(dungeonId, floorIdx + 1),
        x: 0,
        y: 0,
      };
    }
    return;
  }
}

/** The generator's per-cell `tileProperties` overrides apply on top of
 *  the prototype's walkability default. Same field shape v1 used; we copy through. */
function patchTileProperties(
  cell: DungeonMapCell,
  level: DungeonLevel,
  col: number,
  row: number,
): void {
  const key = `${col},${row}`;
  const overrides = level.tileProperties[key];
  if (!overrides) return;
  if (typeof overrides.walkable === "boolean") {
    cell.walkable = overrides.walkable;
  }
}

/** Decoration layer — only the wall-torch matters for the
 *  simulator (it's a light source). Puddles / moss are visual-only
 *  and silently ignored since v2 doesn't render the decoration
 *  channel yet. */
function patchDecoration(
  cell: DungeonMapCell,
  level: DungeonLevel,
  col: number,
  row: number,
  _style: DungeonStyle,
): void {
  const key = `${col},${row}`;
  const decoTile = level.decorations[key];
  if (decoTile === TILE_WALL_TORCH) {
    cell.light_source = true;
    // Dungeon torches throw a 5-tile light pool — matches the
    // `WALL_TORCH_PROTO` default in `tileMapping.ts`. Authoring
    // convention: overworld torches stay smaller; dungeon torches
    // are the bigger source.
    cell.light_range = 5;
    // The underlying wall sprite stays in place — the particle
    // emitter (`animation: "torch"`) renders the flame on top so
    // the torch reads as "mounted on this wall" rather than
    // replacing the wall with a composite that may not match the
    // surrounding style. v1's wall_torch.png was authored against
    // overworld brick walls; dungeon stone walls would clash.
    cell.animation = "torch";
  }
}

/** Give every pit cell its rim piece from its 4 neighbours. Pits are
 *  drawn as an overlay on the solid-black centre: a cell with open
 *  floor to the north gets the top rim, north + west the top-left
 *  corner, and so on; a fully enclosed cell is plain centre. A cell
 *  open on two opposite sides (a 1-wide run) uses the self-contained
 *  single-hole piece. The generator only carves rectangles ≥2×2 or
 *  single cells, so that fallback is just a safety net. */
function paintPits(
  grid: DungeonMapCell[][],
  prefix: "dungeon" | "cave",
  sprites: ReadonlyMap<string, string> | undefined,
): void {
  const pitId = `${prefix}_pit`;
  // Ids are only renamed after the scan, so every pit still reads as
  // the generic `${prefix}_pit` here.
  const isPit = (r: number, c: number) => grid[r]?.[c]?.id === pitId;
  const centre = resolveDungeonSprite(`${prefix}_pit_centre`, sprites);
  const pieces: Array<[number, number, string]> = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c].id !== pitId) continue;
      const n = !isPit(r - 1, c);
      const s = !isPit(r + 1, c);
      const w = !isPit(r, c - 1);
      const e = !isPit(r, c + 1);
      let piece: (typeof PIT_PIECES)[number];
      if ((n && s) || (w && e)) piece = "pit";
      else if (n && w) piece = "pit_corner_tl";
      else if (n && e) piece = "pit_corner_tr";
      else if (s && w) piece = "pit_corner_bl";
      else if (s && e) piece = "pit_corner_br";
      else if (n) piece = "pit_top";
      else if (s) piece = "pit_bottom";
      else if (w) piece = "pit_left";
      else if (e) piece = "pit_right";
      else piece = "pit_centre";
      pieces.push([r, c, piece]);
    }
  }
  // Paint after the scan so renamed ids don't confuse neighbour tests.
  for (const [r, c, piece] of pieces) {
    const cell = grid[r][c];
    const paletteId = `${prefix}_${piece}`;
    cell.id = paletteId;
    cell.paletteId = paletteId;
    cell.sprite = resolveDungeonSprite(paletteId, sprites) || centre;
    // Rim pieces are transparent inside the lip — the black centre
    // shows through as the drop.
    if (piece !== "pit_centre" && centre) cell.background_sprite = centre;
    else delete cell.background_sprite;
  }
}

/** Small deterministic hash → [0, 1). Keeps tileset dressing (cave
 *  floor patches, stalagmites) stable for a given dungeon + floor, so
 *  re-entering a floor or re-baking it paints the same map. */
function hash01(seed: string, x: number, y: number): number {
  let h = 2166136261;
  const s = `${seed}|${x}|${y}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise over a coarse lattice — big soft patches. */
function patchNoise(seed: string, c: number, r: number, cell = 5): number {
  const gx = c / cell, gy = r / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (x: number, y: number) => hash01(seed, x, y);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Floor variants per tileset. Dungeon variants are whole-room themes;
 *  cavern variants are soft patches over the dirt. Weights skew the
 *  pick toward the plainer floors. */
const DUNGEON_ROOM_FLOORS: Array<[string, number]> = [
  ["dungeon_floor_cobble", 3],
  ["dungeon_floor_smooth", 3],
  ["dungeon_floor_pebbles", 2],
  ["dungeon_floor_brick", 2],
  ["dungeon_floor_planks", 1],
  ["dungeon_floor_grate", 1],
];
const CAVE_PATCH_FLOORS: Array<[string, number]> = [
  ["cave_floor_gravel", 3],
  ["cave_floor_rock", 3],
  ["cave_floor_moss", 3],
  ["cave_floor_sand", 2],
  ["cave_floor_slab", 1],
  ["cave_floor_crystal", 1],
];
/** Wall-face decorations per tileset — [palette id, weight, glows]. */
const WALL_DECOR: Record<"dungeon" | "cave", Array<[string, number, boolean]>> = {
  dungeon: [
    ["dungeon_wall_banner", 2, false],
    ["dungeon_wall_window", 1, false],
  ],
  cave: [
    ["cave_wall_crack", 1, true],
    ["cave_wall_crystals", 1, false],
    ["cave_wall_webs", 1, false],
  ],
};

/** Weighted pick from `list` with `u` in [0, 1). */
function weighted<T extends [string, number, ...unknown[]]>(list: T[], u: number): T {
  const total = list.reduce((sum, e) => sum + e[1], 0);
  let x = u * total;
  for (const e of list) {
    x -= e[1];
    if (x < 0) return e;
  }
  return list[list.length - 1];
}

/**
 * Tileset dressing for both styles, in order:
 *   1. Floor variety (`level.floorVariety`): dungeon rooms each roll
 *      for an alternate floor; caverns get soft noise patches.
 *   2. Pits get their rim pieces; pits with a landing below become
 *      walkable drop-throughs linked to the next floor.
 *   3. Walls are autotiled; thin strips take the floor beside them as
 *      their backdrop so variant floors run right up to the wall.
 *   4. Wall decorations (`level.wallDecor`) on plain brick faces.
 *   5. Doors get the solid-rock backdrop; room objects get the floor
 *      under them.
 * Everything keyed off a stable hash of (dungeon, floor, cell), so a
 * floor repaints identically every time it mounts.
 */
function applyTilesetStyle(
  grid: DungeonMapCell[][],
  style: DungeonStyle,
  level: DungeonLevel,
  sprites: ReadonlyMap<string, string> | undefined,
  where: { dungeonId: string; floorIdx: number },
): void {
  const seed = `${where.dungeonId}:${where.floorIdx}`;
  const cave = style === "cavern";
  const prefix = cave ? "cave" : "dungeon";
  const baseFloorId = cave ? CAVE_TILESET_FLOOR_ID : DUNGEON_TILESET_FLOOR_ID;
  const floorSprite = resolveDungeonSprite(baseFloorId, sprites);
  const wallId = cave ? "cave_wall" : "dungeon_wall";
  const variety = Math.min(1, Math.max(0, level.floorVariety ?? 0));

  // ── 1. Floor variety ───────────────────────────────────────────
  // `floorAt` is the floor palette id each open cell shows. Room
  // objects and strip walls read it for their backdrop too.
  const roomFloor: Array<string | null> = (level.rooms ?? []).map((_, i) => {
    if (cave || variety <= 0) return null;
    if (hash01(seed + ":room", i, 0) >= variety) return null;
    return weighted(DUNGEON_ROOM_FLOORS, hash01(seed + ":roomfloor", i, 0))[0];
  });
  const floorAt = (c: number, r: number): string => {
    if (cave) {
      if (variety <= 0) return baseFloorId;
      const n = patchNoise(seed, c, r);
      if (n < 1 - variety) return baseFloorId;
      // A second, coarser noise field picks WHICH patch floor, so each
      // patch is one material with soft edges rather than a speckle.
      return weighted(CAVE_PATCH_FLOORS, patchNoise(seed + ":kind", c, r, 7))[0];
    }
    const rooms = level.rooms ?? [];
    for (let i = rooms.length - 1; i >= 0; i--) {
      const rm = rooms[i];
      if (c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h) {
        return roomFloor[i] ?? baseFloorId;
      }
    }
    return baseFloorId;
  };
  const floorSpriteAt = (c: number, r: number): string =>
    resolveDungeonSprite(floorAt(c, r), sprites) || floorSprite;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      // Plain floor, concealed traps and chest bases all render on the
      // floor, so a trap never looks different from the floor around it.
      const floorBacked = cell.id === baseFloorId || cell.trap || cell.id === "chest";
      if (!floorBacked) continue;
      const id = floorAt(c, r);
      if (id === baseFloorId) continue;
      const sprite = resolveDungeonSprite(id, sprites);
      if (!sprite) continue;
      cell.sprite = sprite;
      if (cell.id === baseFloorId) {
        cell.id = id;
        cell.paletteId = id;
      }
    }
  }

  // ── 2. Pits ────────────────────────────────────────────────────
  paintPits(grid, prefix, sprites);
  if (level.pitLandings) {
    for (const [key, [lc, lr]] of Object.entries(level.pitLandings)) {
      const [c, r] = key.split(",").map(Number);
      const cell = grid[r]?.[c];
      if (!cell?.pit) continue;
      cell.walkable = true;
      cell.link = { map_id: floorMapId(where.dungeonId, where.floorIdx + 1), x: lc, y: lr, fall: true };
    }
  }

  // ── 3. Walls ───────────────────────────────────────────────────
  autotileDungeonWalls(grid, {
    isWall: (cell) => cell.id === wallId || cell.id === "wall_torch",
    sprites,
    floorSprite,
    keepId: (cell) => cell.id === "wall_torch",
    tileset: cave ? "cave" : "dungeon",
  });
  // Strips are drawn over the floor beside them — use that cell's
  // (possibly variant) floor rather than the base one.
  const leftStrip = `${prefix}_wall_left`;
  const rightStrip = `${prefix}_wall_right`;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (cell.id === leftStrip) cell.background_sprite = floorSpriteAt(c + 1, r);
      else if (cell.id === rightStrip) cell.background_sprite = floorSpriteAt(c - 1, r);
    }
  }

  // ── 4. Wall decorations ────────────────────────────────────────
  const decor = Math.min(1, Math.max(0, level.wallDecor ?? 0));
  if (decor > 0) {
    const face = `${prefix}_wall_top`;
    const isDoorish = (cell: DungeonMapCell | undefined) =>
      !!cell && (cell.id === `${prefix}_door` || cell.id === "door_locked");
    const decorated = new Set<string>();
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];
        if (cell.id !== face) continue;
        // Only faces looking onto open floor, never right beside a door
        // or another decoration, and at most ~30% of faces at full dial.
        const below = grid[r + 1]?.[c];
        if (!below?.walkable) continue;
        if (isDoorish(grid[r][c - 1]) || isDoorish(grid[r][c + 1])) continue;
        if (decorated.has(`${c - 1},${r}`)) continue;
        if (hash01(seed + ":decor", c, r) >= 0.3 * decor) continue;
        const [id, , glows] = weighted(WALL_DECOR[cave ? "cave" : "dungeon"], hash01(seed + ":decorkind", c, r));
        const sprite = resolveDungeonSprite(id, sprites);
        if (!sprite) continue;
        cell.id = id;
        cell.paletteId = id;
        cell.sprite = sprite;
        if (glows) {
          cell.light_source = true;
          cell.light_range = 3;
        }
        decorated.add(`${c},${r}`);
      }
    }
  }

  // ── 5. Backdrops: doors on solid rock, objects on their floor ──
  const rock = resolveDungeonSprite(`${prefix}_pit_centre`, sprites);
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (rock && (cell.id === `${prefix}_door` || cell.id === "door_locked")) {
        cell.background_sprite = rock;
      } else if (cell.object) {
        cell.background_sprite = floorSpriteAt(c, r);
      }
    }
  }
}
