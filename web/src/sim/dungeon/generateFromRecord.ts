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
  normalizeDungeonStyle,
  TILE_PIT,
  type DungeonLevel,
} from "@/battle/world/Dungeon";
import type { EncounterTemplate } from "@/battle/world/Encounters";
import { TILE_DFLOOR } from "@/battle/world/Tiles";
import {
  clampDungeonSize,
  DUNGEON_DEFAULTS,
  STYLE_DEFAULTS,
  type DungeonLevelRecord,
  type DungeonRecord,
  type ResolvedLevelOptions,
} from "./types";

export interface GenerateFromRecordOptions {
  /** RNG seed for floor 0. Floor N is seeded as `(seed + N) >>> 0`,
   *  matching v1's `generateDungeon` so re-rolls are predictable. */
  seed: number;
  /** Encounters table, grouped by area (as returned by
   *  `loadEncounters` in `battle/world/Encounters`). The generator
   *  samples from `encounters.dungeon` to populate rooms with
   *  monsters; without this every floor is empty of combat.
   *
   *  Per-Level overrides aren't supported yet — every floor draws
   *  from the same area bucket. Per-level encounter pools are a
   *  future schema addition. */
  encounters?: Record<string, EncounterTemplate[]>;
  /** Monster difficulty lookup — `(monsterId) => "easy" | "normal"
   *  | …`. Used by `sampleEncounter` to prune candidate rosters so
   *  a "normal" dungeon doesn't slip a "hard" monster into a
   *  mixed-tier encounter. Built by the caller from
   *  `loadMonsters()`. Optional but recommended; without it the
   *  level-band filter still narrows the pool but per-monster tier
   *  isn't enforced. */
  monsterDifficulty?: (monsterId: string) => string | undefined;
  /** Required-monster ids keyed by 0-based floor index. Driven by
   *  accepted quests' kill-steps targeting `(dungeon, level)`. The
   *  generator passes the matching list down so each required id is
   *  guaranteed at least one placement on that floor. Floors absent
   *  from this map (or quests without monster ids) generate normally. */
  requiredMonstersByFloor?: ReadonlyMap<number, ReadonlyArray<string>>;
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
  const pitFalls: boolean[] = [];
  for (let floorIdx = 0; floorIdx < totalFloors; floorIdx++) {
    const lvl = record.levels[floorIdx];
    const resolved = resolveLevelOptions(record, lvl, floorIdx);
    pitFalls.push(resolved.pitFalls);
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
      lockProbability: resolved.locked_doors,
      torchProbability: resolved.torch_density,
      // Loot — empty `chestItem` means no chests are placed (opt-in).
      chestItemId: resolved.chestItem,
      chestProbability: resolved.chestFrequency,
      // Door frequency — 1 (the default) keeps every room opening a
      // door, preserving historical layouts; lower values thin them.
      doorProbability: resolved.doorFrequency,
      // Entrance/exit placement: edge of map vs interior rooms.
      edgeTransitions: resolved.edgeTransitions,
      // Pit frequency — 0 (the default) places none.
      pitProbability: resolved.pitFrequency,
      // Room clutter + the converter's cosmetic dials.
      objectProbability: resolved.objectFrequency,
      floorVariety: resolved.floorVariety,
      wallDecor: resolved.wallDecor,
      // Encounters table + monster-difficulty lookup — when both
      // are present, the generator samples encounter rosters per
      // non-entrance room (the `encChance` roll inside
      // `placeRandomEncounters`). When `encounters` is undefined,
      // the room loop is skipped and the floor has no monsters.
      encounters: opts.encounters,
      encounterArea: "dungeon",
      // Theme constraint (parent ⊕ level): a themed dungeon spawns only
      // matching-theme encounters. Empty string → no restriction.
      encounterTheme: resolved.theme,
      monsterDifficulty: opts.monsterDifficulty,
      requiredMonsterIds: opts.requiredMonstersByFloor?.get(floorIdx),
      seed,
    });
    out.push(normaliseAuthoredHeight(raw, resolved.size.height));
  }
  // Pit falls: each pit on a floor that drops through gets a landing
  // cell on the floor below (the bottom floor's pits stay solid).
  for (let i = 0; i + 1 < out.length; i++) {
    if (!pitFalls[i]) continue;
    const landings = pitLandingsFor(out[i], out[i + 1]);
    if (Object.keys(landings).length > 0) out[i].pitLandings = landings;
  }
  return out;
}

/**
 * For every pit cell on `floor`, the open floor cell on `below` the
 * party lands on when it falls in: the nearest plain floor cell to the
 * same coordinates (Manhattan distance; ties → top-most, then
 * left-most), never a monster's cell or the entry stairs. Deterministic,
 * so a regenerated dungeon lands the party in the same place.
 */
export function pitLandingsFor(
  floor: DungeonLevel,
  below: DungeonLevel,
): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const pits: Array<[number, number]> = [];
  floor.tiles.forEach((row, r) =>
    row.forEach((t, c) => {
      if (t === TILE_PIT) pits.push([c, r]);
    }),
  );
  if (pits.length === 0) return out;
  const taken = new Set<string>(below.monsters.map((m) => `${m.col},${m.row}`));
  taken.add(`${below.entryCol},${below.entryRow}`);
  const candidates: Array<[number, number]> = [];
  below.tiles.forEach((row, r) =>
    row.forEach((t, c) => {
      if (t === TILE_DFLOOR && !taken.has(`${c},${r}`)) candidates.push([c, r]);
    }),
  );
  if (candidates.length === 0) return out;
  for (const [pc, pr] of pits) {
    let best = candidates[0];
    let bestD = Infinity;
    for (const cand of candidates) {
      const d = Math.abs(cand[0] - pc) + Math.abs(cand[1] - pr);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    out[`${pc},${pr}`] = [best[0], best[1]];
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
  // Unknown / retired legacy styles ("caves", "ruins", "forest",
  // "custom") on older records fall back to "dungeon".
  const style = normalizeDungeonStyle(
    level.style ?? parent.style ?? DUNGEON_DEFAULTS.style,
  );
  const difficulty =
    level.difficulty ?? parent.difficulty ?? DUNGEON_DEFAULTS.difficulty;
  // Encounter theme: level override wins, else the parent's, else "" (no
  // restriction). Trimmed so a stray whitespace value reads as "any".
  const theme = (level.theme ?? parent.theme ?? DUNGEON_DEFAULTS.theme).trim();
  // Clamped so a bad authored value (negative, zero, huge, fractional)
  // still yields a playable floor instead of an undrawable map.
  const size = clampDungeonSize(
    level.size ?? parent.size,
    DUNGEON_DEFAULTS.size,
  );
  const torch_density =
    level.torch_density ?? parent.torch_density ?? DUNGEON_DEFAULTS.torch_density;
  const locked_doors =
    level.locked_doors ?? parent.locked_doors ?? DUNGEON_DEFAULTS.locked_doors;
  // Loot merges field-by-field: a Level's partial `loot` overrides only
  // the fields it sets, inheriting the rest from the parent. `chestItem`
  // empty = no chests on this floor (chests are opt-in). When a chest
  // IS configured but no frequency given, fall back to the default rate.
  const chestItem =
    level.loot?.chest_item ?? parent.loot?.chest_item ?? "";
  const chestFrequency =
    level.loot?.chest_frequency ??
    parent.loot?.chest_frequency ??
    DUNGEON_DEFAULTS.loot.chest_frequency;
  // Door frequency inherits parent→default like the other 0–1 knobs.
  // Default 1 keeps existing dungeons' doors intact.
  const doorFrequency =
    level.doors ?? parent.doors ?? DUNGEON_DEFAULTS.doors;
  // Entrance/exit placement. Authored values (level→parent) win; absent
  // → interior rooms.
  const edgeTransitions =
    level.edge_transitions ?? parent.edge_transitions ?? false;
  // Pit frequency inherits level→parent→default (0 = no pits).
  const pitFrequency = level.pits ?? parent.pits ?? DUNGEON_DEFAULTS.pits;
  const pitFalls =
    level.pit_falls ?? parent.pit_falls ?? DUNGEON_DEFAULTS.pit_falls;
  // Cosmetic dials: level → parent → the resolved style's default,
  // clamped to 0–1.
  const styleDefaults = STYLE_DEFAULTS[style];
  const dial = (v: number | undefined, fb: number) =>
    Math.min(1, Math.max(0, typeof v === "number" && Number.isFinite(v) ? v : fb));
  const objectFrequency = dial(level.objects ?? parent.objects, styleDefaults.objects);
  const floorVariety = dial(
    level.floor_variety ?? parent.floor_variety,
    styleDefaults.floor_variety,
  );
  const wallDecor = dial(level.wall_decor ?? parent.wall_decor, styleDefaults.wall_decor);
  return {
    name: level.name,
    id: level.id,
    depth: level.depth,
    floorIdx,
    style,
    difficulty,
    theme,
    size,
    torch_density,
    locked_doors,
    chestItem,
    chestFrequency,
    doorFrequency,
    edgeTransitions,
    pitFrequency,
    pitFalls,
    objectFrequency,
    floorVariety,
    wallDecor,
  };
}

// All adapters previously needed at this boundary have moved into
// the v1 generator itself. The wrapper now passes v2 fields straight
// through. If a new adapter is ever needed (e.g. for a future
// schema field that v1 doesn't speak yet), it belongs here.
