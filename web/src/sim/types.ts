/**
 * Shared types for the map simulation kernel.
 *
 * The kernel is split into pure helpers (movement.ts) and a Phaser-
 * aware controller (MapSimulation.ts) so the pure parts can be reused
 * from anywhere — including a future /play scene that may not use
 * Phaser at all. The Phaser-aware controller is the editor's mount
 * point today, and the same controller is the natural home for the
 * /play scene's overworld layer when we build it.
 *
 * None of these types depend on Phaser. They mirror the shape of the
 * data model (Map, MapTile, Party, Character, CharacterClass, Effect)
 * but only carry the fields the simulation actually reads — that
 * isolates the kernel from churn in the editor's TileType.
 */

export type Direction = "up" | "down" | "left" | "right";

/** The subset of a painted tile cell that the simulation reads. Each
 *  field mirrors the same-named field on the editor's TileType / the
 *  data dictionary's MapTile entry. Other tile fields (sprite, name,
 *  encounter, animation, …) are ignored by the kernel — the scene
 *  renders them on its own. */
export interface SimCell {
  id: string;
  walkable: boolean;
  /** Blocks light + LOS — used to cast shadows from light sources. */
  obstructs: boolean;
  /** True = tile emits light at light_range cells. */
  light_source: boolean;
  light_range: number;
  /** Inter-map portal — null/undefined when this cell does not link. */
  link?: { map_id: string; x: number; y: number } | null;
}

/** Row-major grid: grid[row][col]. */
export type SimGrid = ReadonlyArray<ReadonlyArray<SimCell>>;

/** Result of attempting a one-step move. `stayed` means the move was
 *  rejected (off-grid or non-walkable); `moved` means the party stepped
 *  to the new cell; `linked` means the new cell carries a link that
 *  the runtime should traverse (load a different map). */
export type StepResult =
  | { kind: "stayed"; reason: "off_grid" | "blocked" }
  | { kind: "moved"; col: number; row: number }
  | {
      kind: "linked";
      col: number;
      row: number;
      link: { map_id: string; x: number; y: number };
    };

/** Position on the current map. */
export interface Position {
  col: number;
  row: number;
}

/** A single light source the renderer should treat as illuminating
 *  cells within `range` Chebyshev tiles (with obstructs-LOS shadows).
 *  The grid's own `light_source` cells are gathered separately by the
 *  scene; this type is for *additional* sources the simulation
 *  contributes — primarily the party itself. */
export interface SimLightSource {
  col: number;
  row: number;
  range: number;
}

/** Subset of the party.json record the simulation reads. Everything
 *  else (gold, inventory, …) is ignored by the kernel; the editor's
 *  panel still has the full record on hand. */
export interface SimParty {
  start_position: { col: number; row: number };
  avatar: string;
  /** Character ids in the adventuring party. Every entry is in play —
   *  v2 collapsed v1's roster + active_party into this single list. */
  roster: string[];
  /** Step countdown for a held torch. >0 = +TORCH_LIGHT_RANGE to the
   *  party's emitted light radius. Decrements one per step. */
  torch_steps: number;
  /** Step countdown for the Galadriel's Light effect (Elf race).
   *  >0 = +GALADRIELS_LIGHT_RANGE. Decrements one per step. */
  galadriels_light_steps: number;
}

/** Subset of a character record the sim reads. */
export interface SimCharacter {
  id: string;
  name: string;
  /** Class id (snake_case): "fighter", "wizard", … */
  class: string;
  /** Race id (snake_case): "human", "elf", … */
  race: string;
  level: number;
  hp: number;
  mp: number;
  sprite: string;
}

/** Subset of the character_classes record the sim reads. */
export interface SimCharacterClass {
  id: string;
  name: string;
}

/** Subset of the race record the sim reads. */
export interface SimRace {
  id: string;
  name: string;
  /** Permanent effect ids this race grants. Used to detect e.g.
   *  Infravision so the lighting kernel can extend the party's
   *  effective light radius in dark maps. */
  effects?: string[];
}

/** Subset of an effect record the sim reads. */
export interface SimEffect {
  id: string;
  name: string;
  description: string;
  duration: number | "permanent" | "instant" | "until_save";
}

/** Light range constants — same magic numbers v1 used. Held here so
 *  the panel UI and the kernel agree on what "lighting a torch" means. */
export const TORCH_LIGHT_RANGE = 3;
export const GALADRIELS_LIGHT_RANGE = 5;
/** Range used for permanent-light effects like Infravision. Practical
 *  infinity at our grid scale — bigger than any reasonable map. */
export const INFRAVISION_RANGE = 999;
