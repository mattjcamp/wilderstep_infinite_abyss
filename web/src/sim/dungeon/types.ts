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

/** Visual / thematic family the generator uses to pick a tile
 *  palette and decor. Closed enum per docs/data_dictionary/dungeon.md. */
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
  /** `map_tiles` palette id for the walkable floor sprite. Only read
   *  when the resolved `style` is `"custom"`. */
  custom_floor?: string;
  /** `map_tiles` palette id for the wall sprite (forced blocking +
   *  sight-obstructing). Only read when `style` is `"custom"`. */
  custom_wall?: string;
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
  description?: string;
  tags?: string[];
  style?: DungeonStyle;
  difficulty?: DungeonDifficulty;
  size?: DungeonSize;
  torch_density?: number;
  locked_doors?: number;
  /** 0–1 probability each eligible room opening gets a door (default
   *  `1` = doors always, preserving historical layouts). `0` = no
   *  doors. Applies to every style; Levels override per-floor. */
  doors?: number;
  /** `map_tiles` palette id for the floor sprite when `style` is
   *  `"custom"`. Ignored for other styles. */
  custom_floor?: string;
  /** `map_tiles` palette id for the wall sprite when `style` is
   *  `"custom"`. Ignored for other styles. */
  custom_wall?: string;
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
  /** `map_tiles` palette id for the floor sprite — only meaningful
   *  when `style` is `"custom"`. Empty string otherwise. */
  customFloor: string;
  /** `map_tiles` palette id for the wall sprite — only meaningful when
   *  `style` is `"custom"`. Empty string otherwise. */
  customWall: string;
}

/** Editor-default fallbacks used when a required parent field is
 *  missing on disk. Mirror `DungeonsBrowse.DEFAULTS` so newly-created
 *  records and older records degrade to the same baseline. */
export const DUNGEON_DEFAULTS = {
  style: "caves" as DungeonStyle,
  difficulty: "normal" as DungeonDifficulty,
  size: { width: 32, height: 32 } as DungeonSize,
  torch_density: 0.15,
  locked_doors: 0.25,
  /** Door frequency defaults to `1` — every eligible room opening gets
   *  a door, the historical behaviour. Authors lower it per-dungeon for
   *  open layouts (e.g. a doorless forest). */
  doors: 1,
  /** Custom-style palette ids. Empty by default; the editor requires
   *  the author to pick real `map_tiles` ids when `style` is
   *  `"custom"`. */
  custom_floor: "",
  custom_wall: "",
  /** Loot defaults. `chest_item` is empty by design — chests are
   *  opt-in, so a brand-new dungeon places none until the author
   *  picks a chest item. `chest_frequency` is the fallback rate used
   *  once a chest item IS chosen but no explicit frequency given. */
  loot: {
    chest_item: "",
    chest_frequency: 0.5,
  },
} as const;
