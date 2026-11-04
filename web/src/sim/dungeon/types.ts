/**
 * v2 Dungeon + Dungeon Level record types.
 *
 * These mirror the data dictionary entries (`docs/data_dictionary/
 * dungeon.md` and `dungeon_level.md`) field-for-field. The
 * underlying enums live in `battle/world/Dungeon.ts` (single
 * source of truth — the generator and the schema agree by
 * construction). We re-export them here so callers only need to
 * touch `@/sim/dungeon/types` rather than reaching into battle.
 */

import type {
  DungeonStyle as V1DungeonStyle,
  Difficulty as V1Difficulty,
} from "@/battle/world/Dungeon";

/** Visual / thematic family the generator uses to pick a tileset —
 *  `"dungeon"` or `"cavern"`. Closed enum per
 *  docs/data_dictionary/dungeon.md. */
export type DungeonStyle = V1DungeonStyle;

/** Difficulty tier — shared with Monster's difficulty enum. */
export type DungeonDifficulty = V1Difficulty;

/** Authored dimensions — freeform width/height per the v2 schema.
 *  No "band" quantisation; the generator runs against whatever the
 *  author painted. */
export interface DungeonSize {
  width: number;
  height: number;
}

/** Loot generation knobs. `chest_item` names an item authored with
 *  `is_chest: true` (its `contents` are what the party finds on open);
 *  `chest_frequency` is the 0–1 chance a chest is placed in each
 *  eligible room. Chests only generate when a `chest_item` is set — an
 *  empty / absent `loot` block means no procedural chests on that
 *  floor. Mirrors how the rest of the generator reads 0–1 knobs. */
export interface DungeonLoot {
  /** Item id (must be `is_chest: true` in items.json). When unset, no
   *  chests are placed regardless of frequency. */
  chest_item?: string;
  /** 0–1 probability a chest of `chest_item` is placed per eligible
   *  room. Defaults to {@link DUNGEON_DEFAULTS.loot.chest_frequency}
   *  when a `chest_item` is set but no frequency is given. */
  chest_frequency?: number;
}

/** One floor in a parent Dungeon's `levels[]`. Required fields
 *  (`id`, `name`, `depth`) carry identity; everything else is an
 *  optional override of the parent Dungeon's same-named field.
 *  Absence == inherit. */
export interface DungeonLevelRecord {
  id: string;
  name: string;
  /** Editor-side organizational labels. Gameplay doesn't read them. */
  tags?: string[];
  /** 1-indexed floor number; level 1 is the entrance. */
  depth: number;
  /** Per-Level overrides — omit any to inherit from the parent. */
  style?: DungeonStyle;
  difficulty?: DungeonDifficulty;
  /** Encounter theme override for this floor (e.g. "undead"). When
   *  set, the generator only spawns encounters of this theme here.
   *  Inherits the parent dungeon's theme when absent. */
  theme?: string;
  size?: DungeonSize;
  /** 0–1 probability per eligible wall tile. */
  torch_density?: number;
  /** 0–1 probability per door. */
  locked_doors?: number;
  /** 0–1 probability each eligible room opening gets a door. Inherits
   *  the parent's value when absent (which itself defaults to `1` —
   *  doors always — so existing dungeons are unchanged). `0` = an open
   *  layout with no doorframes. */
  doors?: number;
  /** 0–1 probability each room past the entrance gets a pit. Inherits
   *  the parent's value when absent (which itself defaults to `0` — no
   *  pits). */
  pits?: number;
  /** Pits drop the party to the floor below. Inherits; default `true`. */
  pit_falls?: boolean;
  /** 0–1 room clutter (pillars / stalagmites / rubble). Inherits;
   *  default is the style's (see {@link STYLE_DEFAULTS}). */
  objects?: number;
  /** 0–1 share of floor using the tileset's alternate floors. */
  floor_variety?: number;
  /** 0–1 share of brick faces carrying a decoration. */
  wall_decor?: number;
  /** When `true`, the floor's entrance + exit transitions are placed at
   *  the map EDGE (carving a short trail inward); when `false` they're
   *  dropped in the interior rooms. Absent inherits the parent, which
   *  itself defaults to interior rooms. */
  edge_transitions?: boolean;
  /** Loot override — a Level inherits the parent's `loot` when this
   *  is absent. A partial object (e.g. only `chest_frequency`) merges
   *  field-by-field over the parent's. */
  loot?: DungeonLoot;
}

/** A complete Dungeon catalog entry — generator defaults under
 *  `levels[]`. Per docs, `style`, `difficulty`, `size`,
 *  `torch_density`, and `locked_doors` are required on the parent.
 *  We accept them as optional at the type level so older / partial
 *  records still load; the resolver fills sane defaults and logs a
 *  warning when something required is missing. */
export interface DungeonRecord {
  id: string;
  name: string;
  /** XP for clearing this dungeon (every monster on every floor
   *  defeated). Overrides the module's `settings.exploration_xp.dungeon`
   *  (default 250); 0 turns the reward off. */
  clear_xp?: number;
  description?: string;
  tags?: string[];
  style?: DungeonStyle;
  difficulty?: DungeonDifficulty;
  /** Encounter theme (e.g. "undead", "devil"). When set, the
   *  procedural generator populates the dungeon ONLY with encounters
   *  whose `theme` matches — falling back to the full pool if a level
   *  band has none of that theme. Absent / empty → any theme. Levels
   *  override per-floor. */
  theme?: string;
  size?: DungeonSize;
  torch_density?: number;
  locked_doors?: number;
  /** 0–1 probability each eligible room opening gets a door (default
   *  `1` = doors always, preserving historical layouts). `0` = no
   *  doors. Applies to every style; Levels override per-floor. */
  doors?: number;
  /** 0–1 probability each room past the entrance gets a pit (chasm).
   *  Default `0` = no pits. Applies to every style; Levels override
   *  per-floor. */
  pits?: number;
  /** When `true` (the default), stepping into a pit drops the party to
   *  the floor below (light fall damage). `false` = solid chasms. Pits
   *  on the bottom floor are always solid. */
  pit_falls?: boolean;
  /** 0–1 room clutter: pillars + rubble (dungeon), stalagmites +
   *  rubble (cavern). At 1 about one open cell in ten gets an object.
   *  Never blocks a route. Default: style's (cavern 0.5, dungeon 0). */
  objects?: number;
  /** 0–1 floor variety. Dungeon: the chance each room gets an
   *  alternate floor (cobble, smooth, pebbles, brick, planks, grate).
   *  Cavern: how much of the floor is gravel / rock / moss / sand /
   *  slab / crystal patches. Default: style's (cavern 0.6, dungeon 0). */
  floor_variety?: number;
  /** 0–1 share of brick wall faces carrying a decoration — banners /
   *  windows (dungeon), glowing cracks / crystal veins / webs (cavern).
   *  Default 0. */
  wall_decor?: number;
  /** Place entrance + exit transitions at the map edge (`true`) or in
   *  interior rooms (`false`). Applies to every style; Levels override
   *  per-floor. Absent → interior rooms. */
  edge_transitions?: boolean;
  /** Default loot for every floor (Levels override per-floor). Absent
   *  → no procedural chests anywhere in the dungeon unless a Level
   *  sets its own `loot.chest_item`. */
  loot?: DungeonLoot;
  levels: DungeonLevelRecord[];
  /** Per-dungeon background-music playlist override. Each entry is
   *  an audio file URL. When the party enters this dungeon the play
   *  host points the SoundtrackPlayer at this list; absent / empty
   *  inherits the module default playlist. */
  soundtrack?: string[];
}

/** Fully-resolved options for ONE generated floor — parent ⊕ Level
 *  overrides collapsed into a single object the v2-native generator
 *  passes through to v1's `generateDungeonLevel`. */
export interface ResolvedLevelOptions {
  /** Display name the floor renders with — Level's authored name. */
  name: string;
  /** Stable id from the Level record. */
  id: string;
  /** 1-indexed floor number. */
  depth: number;
  /** 0-indexed position in the parent's `levels[]` array. */
  floorIdx: number;
  style: DungeonStyle;
  difficulty: DungeonDifficulty;
  /** Resolved encounter theme (parent ⊕ level). Empty string = no
   *  theme restriction; otherwise the generator only spawns encounters
   *  whose `theme` matches. */
  theme: string;
  size: DungeonSize;
  /** 0–1 — passed through losslessly today; the v1 generator's
   *  banded TorchDensity is computed inside the wrapper. */
  torch_density: number;
  /** 0–1 — same caveat as torch_density. */
  locked_doors: number;
  /** Resolved loot for this floor (parent ⊕ level). `chestItem` is
   *  empty string when no chest is configured — the generator then
   *  places no chests regardless of `chestFrequency`. */
  chestItem: string;
  /** 0–1 chest placement chance per eligible room. Only consulted
   *  when `chestItem` is non-empty. */
  chestFrequency: number;
  /** 0–1 probability each eligible room opening gets a door. Defaults
   *  to {@link DUNGEON_DEFAULTS.doors} (`1`). */
  doorFrequency: number;
  /** Resolved entrance/exit placement: `true` = map edge, `false` =
   *  interior rooms (the default). */
  edgeTransitions: boolean;
  /** 0–1 chance each room past the entrance gets a pit. Defaults to
   *  {@link DUNGEON_DEFAULTS.pits} (`0`). */
  pitFrequency: number;
  /** Whether pits drop through to the floor below. */
  pitFalls: boolean;
  /** Resolved 0–1 dials (level → parent → style default). */
  objectFrequency: number;
  floorVariety: number;
  wallDecor: number;
}

/** Per-style defaults for the cosmetic dials, used when neither the
 *  Level nor the Dungeon sets them. Caverns have always had patchy
 *  floors and a scatter of stalagmites; these keep that look. */
export const STYLE_DEFAULTS: Record<
  DungeonStyle,
  { objects: number; floor_variety: number; wall_decor: number }
> = {
  dungeon: { objects: 0, floor_variety: 0, wall_decor: 0 },
  cavern: { objects: 0.5, floor_variety: 0.6, wall_decor: 0 },
};

/** Smallest / largest floor the generator will build. Below the
 *  minimum there's no room for a usable rooms-and-corridors layout;
 *  a non-positive size (a typo like `-40`) would produce a map the
 *  play screen can't draw at all. */
export const DUNGEON_SIZE_MIN = 12;
export const DUNGEON_SIZE_MAX = 128;

/** Coerce an authored size to whole numbers within
 *  [DUNGEON_SIZE_MIN, DUNGEON_SIZE_MAX]. A missing / non-numeric side
 *  falls back to `fallback`'s. */
export function clampDungeonSize(
  size: Partial<DungeonSize> | undefined,
  fallback: DungeonSize,
): DungeonSize {
  const side = (v: unknown, fb: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fb;
    return Math.min(DUNGEON_SIZE_MAX, Math.max(DUNGEON_SIZE_MIN, n));
  };
  return {
    width: side(size?.width, fallback.width),
    height: side(size?.height, fallback.height),
  };
}

/** Editor-default fallbacks used when a required parent field is
 *  missing on disk. Mirror `DungeonsBrowse.DEFAULTS` so newly-created
 *  records and older records degrade to the same baseline. */
export const DUNGEON_DEFAULTS = {
  style: "dungeon" as DungeonStyle,
  difficulty: "normal" as DungeonDifficulty,
  /** Encounter theme. Empty = any theme (no restriction). */
  theme: "",
  size: { width: 32, height: 32 } as DungeonSize,
  torch_density: 0.15,
  locked_doors: 0.25,
  /** Door frequency defaults to `1` — every eligible room opening gets
   *  a door, the historical behaviour. Authors lower it per-dungeon for
   *  open layouts. */
  doors: 1,
  /** Pit frequency defaults to `0` — no pits — so existing dungeons
   *  generate exactly as before. */
  pits: 0,
  /** Pits drop through to the floor below unless turned off. */
  pit_falls: true,
  /** Loot defaults. `chest_item` is empty by design — chests are
   *  opt-in, so a brand-new dungeon places none until the author
   *  picks a chest item. `chest_frequency` is the fallback rate used
   *  once a chest item IS chosen but no explicit frequency given. */
  loot: {
    chest_item: "",
    chest_frequency: 0.5,
  },
} as const;
