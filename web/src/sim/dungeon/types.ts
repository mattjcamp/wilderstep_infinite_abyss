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
} as const;
