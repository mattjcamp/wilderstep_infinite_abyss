/**
 * v2-native dungeon generator wrapper.
 *
 * Consumes a `DungeonRecord` (the v2 data-model shape) directly and
 * produces one `DungeonLevel` per entry in `record.levels[]`. The
 * v1 generator's `generateDungeonLevel` does the actual room/
 * corridor/decor work — we just translate the v2 options into the
 * shape it expects, with per-Level overrides merged on top of the
 * parent Dungeon's defaults.
 *
 * The point of this layer (vs. v1's `generateDungeon`) is that the
 * v2 model lets authors set *freeform* `size.width` / `size.height`,
 * `torch_density` (0–1), and `locked_doors` (0–1). The v1 entry
 * point quantises into bands ("small" / "medium" / "large" /
 * "sparse" / "abundant" / boolean), losing the authored values.
 * This wrapper:
 *
 *   - Passes `size.width` / `size.height` through to the generator
 *     unmodified. This is the first piece of the "stop adapting to
 *     v1, read v2 natively" refactor.
 *   - Maps `torch_density` (0–1) into the v1 generator's banded
 *     TorchDensity for now. v1's torch placement only consults the
 *     band; raw-passthrough would need a small v1 change. Marked
 *     TODO so the next refactor pass can finish it.
 *   - Maps `locked_doors` (0–1) into the v1 generator's boolean
 *     `placeDoors` flag for now. Same caveat.
 *   - Honors per-Level overrides via absence-based inheritance
 *     (matches the data dictionary's contract).
 *
 * Encounters / monsters / quest placements aren't wired here yet —
 * the generator option for that is present but the launcher hasn't
 * been threaded through to encounters.json + monsters.json.
 */

import {
  generateDungeonLevel,
  type DungeonLevel,
} from "@/v1battle/world/Dungeon";
import {
  DUNGEON_DEFAULTS,
  type DungeonLevelRecord,
  type DungeonRecord,
  type ResolvedLevelOptions,
} from "./types";

export interface GenerateFromRecordOptions {
  /** RNG seed for floor 0. Floor N is seeded as `(seed + N) >>> 0`,
   *  matching v1's `generateDungeon` so re-rolls are predictable. */
  seed: number;
}

/**
 * Generate every floor of a Dungeon, reading the v2 record
 * natively. Returns one `DungeonLevel` per entry in `record.levels[]`,
 * in the same order.
 *
 * The number of floors is the length of `record.levels[]` — there is
 * no separate `numLevels`. Empty `levels` returns an empty array
 * (the caller decides whether that's a usable result).
 *
 * Each level's `width`/`height` on the returned object reflects the
 * *authored* dimensions, not the v1 generator's padded grid (see the
 * `normaliseAuthoredHeight` helper below for the rationale).
 */
export function generateDungeonFromRecord(
  record: DungeonRecord,
  opts: GenerateFromRecordOptions,
): DungeonLevel[] {
  const totalFloors = record.levels?.length ?? 0;
  const out: DungeonLevel[] = [];
  for (let floorIdx = 0; floorIdx < totalFloors; floorIdx++) {
    const lvl = record.levels[floorIdx];
    const resolved = resolveLevelOptions(record, lvl, floorIdx);
    const seed = (opts.seed + floorIdx) >>> 0;
    const raw = generateDungeonLevel({
      name: resolved.name,
      width: resolved.size.width,
      height: resolved.size.height,
      // Every v2 field flows through unmodified — the generator now
      // speaks the v2 schema natively. Style + difficulty enums
      // match; torch_density (0..1) drives placement directly; and
      // lock_probability (0..1) rolls per single-entrance room.
      style: resolved.style,
      difficulty: resolved.difficulty,
      floorIdx,
      placeStairsDown: floorIdx < totalFloors - 1,
      placeOverworldExit:
        floorIdx === totalFloors - 1 && totalFloors > 1,
      lockProbability: resolved.locked_doors,
      torchProbability: resolved.torch_density,
      seed,
    });
    out.push(normaliseAuthoredHeight(raw, resolved.size.height));
  }
  return out;
}

/**
 * Clip the v1-generated `DungeonLevel` to the *authored* height.
 *
 * v1's `generateDungeonLevel` pads the grid with a BUFFER of 3 extra
 * rows — a Python-era hack so the in-game HUD overlay (which floated
 * over the bottom of the map) wouldn't clip corridor exits. v2's
 * editor doesn't have that constraint: the author paints
 * `size: { width, height }` and expects those exact dimensions to
 * come back out.
 *
 * The fix is purely a re-labelling: the generator places all dungeon
 * content in rows `0..authoredHeight-1`, then pads `authoredHeight ..
 * authoredHeight+BUFFER-1` with wall tiles. Clipping `tiles` to the
 * authored row count drops only the wall padding; nothing the player
 * could ever see is lost. The `decorations` / `tileProperties`
 * dictionaries are keyed by `"col,row"` so we strip the few keys
 * that land on the dropped rows.
 *
 * `width` isn't padded by v1, so we leave it alone.
 */
function normaliseAuthoredHeight(
  level: DungeonLevel,
  authoredHeight: number,
): DungeonLevel {
  if (level.height <= authoredHeight) return level;
  const tiles = level.tiles.slice(0, authoredHeight);
  const decorations: Record<string, number> = {};
  for (const [key, value] of Object.entries(level.decorations)) {
    const r = Number.parseInt(key.split(",")[1] ?? "", 10);
    if (Number.isFinite(r) && r < authoredHeight) decorations[key] = value;
  }
  const tileProperties: typeof level.tileProperties = {};
  for (const [key, value] of Object.entries(level.tileProperties)) {
    const r = Number.parseInt(key.split(",")[1] ?? "", 10);
    if (Number.isFinite(r) && r < authoredHeight) tileProperties[key] = value;
  }
  return {
    ...level,
    height: authoredHeight,
    tiles,
    decorations,
    tileProperties,
  };
}

/**
 * Merge a parent Dungeon's defaults with a Level's optional
 * overrides into a fully-specified options bundle. Used internally
 * by the generator and exported for tests / preview UIs that want
 * to display "what will this floor actually look like before I
 * generate it?"
 *
 * Absence beats override on every field — matches the data
 * dictionary's inheritance rule. When the parent itself is missing
 * a required field (older records, e.g. `the_hole`), we substitute
 * a defensive default from `DUNGEON_DEFAULTS` so the dungeon still
 * generates instead of crashing.
 */
export function resolveLevelOptions(
  parent: DungeonRecord,
  level: DungeonLevelRecord,
  floorIdx: number,
): ResolvedLevelOptions {
  const style = level.style ?? parent.style ?? DUNGEON_DEFAULTS.style;
  const difficulty =
    level.difficulty ?? parent.difficulty ?? DUNGEON_DEFAULTS.difficulty;
  const size = level.size ?? parent.size ?? DUNGEON_DEFAULTS.size;
  const torch_density =
    level.torch_density ?? parent.torch_density ?? DUNGEON_DEFAULTS.torch_density;
  const locked_doors =
    level.locked_doors ?? parent.locked_doors ?? DUNGEON_DEFAULTS.locked_doors;
  return {
    name: level.name,
    id: level.id,
    depth: level.depth,
    floorIdx,
    style,
    difficulty,
    size,
    torch_density,
    locked_doors,
  };
}

// All adapters previously needed at this boundary have moved into
// the v1 generator itself. The wrapper now passes v2 fields straight
// through. If a new adapter is ever needed (e.g. for a future
// schema field that v1 doesn't speak yet), it belongs here.
