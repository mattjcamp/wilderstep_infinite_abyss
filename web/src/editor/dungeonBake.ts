/**
 * Bake a DungeonRecord into a set of persistable Map records the
 * editor can drop into `maps.json`. Pure — no DOM, no IO, no Phaser
 * — so it's straightforward to unit-test.
 *
 * What it does:
 *
 *   - Runs the existing v2 generator (`generateDungeonFromRecord`)
 *     to produce one `DungeonLevel` per floor.
 *   - Converts each level into a map record via `dungeonLevelToMap`
 *     (same path the procedural runtime uses).
 *   - Rewrites the synthetic floor-ids (`__dungeon_<id>_f<n>__`) the
 *     converter stamps on stair-link `map_id`s into REAL, persistable
 *     map ids (`<dungeonId>_<suffix>_l<depth>`). Stair links that
 *     pointed at `EXIT_TO_OVERWORLD_MAP_ID` (top-of-L1 stairs-up,
 *     bottom-of-LN stairs-down) are cleared to `null` — the author
 *     wires those up by hand after the bake.
 *   - Rewrites the synthetic encounter ids (`__dungeon_enc_<m.id>__`)
 *     the converter stamps onto monster cells into REAL encounter
 *     ids pulled from the source EncounterTemplate (captured by the
 *     generator on `DungeonMonster.encounterId`). No new entries are
 *     added to `encounters.json`; baked cells reference the same
 *     encounter records the procedural runtime samples from.
 *   - Picks an auto-incrementing suffix so successive bakes don't
 *     collide. Suffix is selected by scanning existing maps for tags
 *     matching `dungeon:<dungeonId>_<n>` and picking `max(n) + 1`
 *     (or `1` if none exist). The full grouping tag
 *     (`dungeon:<dungeonId>_<suffix>`) is stamped on every minted
 *     map so they group together in the MapsBrowse tag-tree. We
 *     intentionally do NOT also stamp a generic `dungeon` tag —
 *     duplicate-tag groups (every map appearing under both
 *     `dungeon` and `dungeon:<id>_<n>`) clutter the tree without
 *     adding signal. Authors who want an "all dungeons" view can
 *     filter on the `dungeon:` tag prefix.
 *
 * What it does NOT do (deliberate):
 *
 *   - Touch `encounters.json`. Baked maps reuse existing encounter
 *     ids; the author can add or rename encounters separately.
 *   - Touch the overworld dungeon-entry cell. The cell still has
 *     `cell.dungeon = "<dungeonId>"` and routes the party into the
 *     procedural runtime. Baked maps exist alongside, available for
 *     authoring / placement under different overworld cells, but the
 *     procedural entry continues to work unchanged.
 *   - Detect or warn about prior bakes. Each invocation produces a
 *     fresh independent set under a new suffix — repeat bakes of the
 *     same dungeon are encouraged (snapshot v1, edit it, then snapshot
 *     v2 to compare).
 */

import {
  generateDungeonFromRecord,
  type GenerateFromRecordOptions,
} from "@/sim/dungeon/generateFromRecord";
import {
  dungeonLevelToMap,
  EXIT_TO_OVERWORLD_MAP_ID,
  floorMapId,
  type DungeonMapCell,
  type DungeonMapRecord,
} from "@/sim/dungeon/dungeonLevelToMap";
import type { DungeonRecord } from "@/sim/dungeon/types";

/** A baked map record — same shape as `DungeonMapRecord` but with
 *  real persistable ids and tags. Distinct alias kept so callers can
 *  state intent in their signatures. */
export interface BakedMapRecord extends DungeonMapRecord {}

/** Options bundle for `bakeDungeon`. Extends the standard generator
 *  options (seed, encounters table, monster-difficulty lookup) with
 *  the one extra input the bake needs — the existing maps catalog,
 *  so it can scan tags and pick the next free suffix. */
export interface BakeDungeonOptions extends GenerateFromRecordOptions {
  /** Existing map records — only their `tags` are consulted, used
   *  to find the next free `<dungeonId>_<n>` suffix. Pass the merged
   *  `maps[]` list from MapsBrowse. */
  existingMaps: ReadonlyArray<{ tags?: string[] }>;
  /** `map_tiles` palette id → sprite path. Forwarded to the converter
   *  so a baked custom-style dungeon resolves its floor/wall sprites.
   *  Omit for non-custom dungeons. */
  customTileSprites?: ReadonlyMap<string, string>;
}

export interface BakeDungeonResult {
  /** Minted maps, ready to append to maps.json (or hand to
   *  MapsBrowse's `persistMaps`). One entry per floor in
   *  `record.levels[]`, in declared depth order. */
  maps: BakedMapRecord[];
  /** Suffix selected for this bake — surfaced so the dialog can
   *  preview "will create <dungeonId>_<suffix>_l1, _l2, …". */
  suffix: number;
  /** Grouping tag stamped on every minted map — same value the
   *  dialog can show as "creates the group <groupTag>". */
  groupTag: string;
  /** Real map ids that were minted, in declared order. Surfaced for
   *  preview + tests. */
  mapIds: string[];
}

/**
 * Bake a dungeon into a fresh set of editable maps. See module doc
 * for the full behaviour contract.
 *
 * Throws nothing — empty `record.levels` yields an empty `maps`
 * array (caller decides whether that's a usable result).
 */
export function bakeDungeon(
  record: DungeonRecord,
  opts: BakeDungeonOptions,
): BakeDungeonResult {
  const suffix = nextFreeSuffix(record.id, opts.existingMaps);
  const groupTag = `dungeon:${record.id}_${suffix}`;

  const levels = generateDungeonFromRecord(record, opts);
  const totalFloors = levels.length;

  // Pre-compute the synthetic→real map-id mapping. The converter
  // (`dungeonLevelToMap`) stamps `floorMapId(record.id, i)` onto
  // stair-link `map_id`s for inter-floor stairs; we rewrite those in
  // a second pass to the real `<dungeonId>_<suffix>_l<depth>` ids.
  const synthToReal = new Map<string, string>();
  const realIds: string[] = [];
  for (let i = 0; i < totalFloors; i++) {
    const depth = depthForFloor(record, i);
    const realId = bakedMapId(record.id, suffix, depth);
    synthToReal.set(floorMapId(record.id, i), realId);
    realIds.push(realId);
  }

  const maps: BakedMapRecord[] = levels.map((level, i) => {
    const depth = depthForFloor(record, i);
    const realId = realIds[i];
    const raw = dungeonLevelToMap(level, {
      dungeonId: record.id,
      floorIdx: i,
      totalFloors,
      customTileSprites: opts.customTileSprites,
    });

    // Rewrite stair links: synthetic neighbour-floor ids → real
    // baked ids; EXIT_TO_OVERWORLD_MAP_ID → null (author wires up).
    for (const row of raw.grid) {
      for (const cell of row) {
        if (!cell.link) continue;
        const target = synthToReal.get(cell.link.map_id);
        if (target) {
          cell.link = { ...cell.link, map_id: target };
        } else {
          // EXIT_TO_OVERWORLD_MAP_ID or any other unrecognised
          // synthetic id — clear, author wires up later.
          cell.link = null;
        }
      }
    }

    // Re-stamp encounter ids: clear every synthetic
    // `__dungeon_enc_*` the converter wrote, then walk the level's
    // monster list and stamp the real source EncounterTemplate id
    // onto each placement. Monsters whose `encounterId` is missing
    // (defensive: the generator now always sets it, but older code
    // paths or future generators might not) leave the cell blank.
    for (const row of raw.grid) {
      for (const cell of row) {
        if (cell.encounter?.startsWith("__dungeon_enc_")) {
          cell.encounter = "";
        }
      }
    }
    for (const m of level.monsters) {
      const cell: DungeonMapCell | undefined = raw.grid[m.row]?.[m.col];
      if (!cell) continue;
      if (typeof m.encounterId === "string" && m.encounterId.length > 0) {
        cell.encounter = m.encounterId;
      }
    }

    return {
      ...raw,
      id: realId,
      name: `${record.name} — ${level.name}`,
      description: `Floor ${depth} of ${record.name}. Generated from the dungeon spec.`,
      tags: [groupTag],
    };
  });

  return { maps, suffix, groupTag, mapIds: realIds };
}

/** Compute the real, persistable map id for a baked floor. Exposed
 *  for tests and for the dialog's preview. */
export function bakedMapId(
  dungeonId: string,
  suffix: number,
  depth: number,
): string {
  return `${dungeonId}_${suffix}_l${depth}`;
}

/** Find the smallest unused suffix for this dungeon. Scans every
 *  tag on every existing map for the prefix `dungeon:<id>_` and
 *  returns one past the largest integer suffix found (or `1` when
 *  no prior bakes exist). Non-integer suffixes (e.g. someone hand-
 *  tagged `dungeon:goblin_lair_legacy`) are ignored — we only count
 *  numerics so the author can use named tags freely without
 *  poisoning the auto-increment. */
export function nextFreeSuffix(
  dungeonId: string,
  existingMaps: ReadonlyArray<{ tags?: string[] }>,
): number {
  const prefix = `dungeon:${dungeonId}_`;
  let max = 0;
  for (const m of existingMaps) {
    for (const tag of m.tags ?? []) {
      if (!tag.startsWith(prefix)) continue;
      const rest = tag.slice(prefix.length);
      // Strict integer match — reject "1_old", "legacy", etc.
      if (!/^\d+$/.test(rest)) continue;
      const n = Number.parseInt(rest, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

/** Resolve the 1-indexed depth for a floor. Prefers the authored
 *  `depth` on the level record; falls back to `floorIdx + 1` when
 *  absent (defensive — older records). */
function depthForFloor(record: DungeonRecord, floorIdx: number): number {
  const lvl = record.levels[floorIdx];
  const depth = lvl?.depth;
  return typeof depth === "number" && Number.isFinite(depth)
    ? depth
    : floorIdx + 1;
}

// Re-export the constant from the converter so callers that want to
// reason about "did this stair link originally point at the
// overworld exit" don't have to reach across two modules.
export { EXIT_TO_OVERWORLD_MAP_ID };
