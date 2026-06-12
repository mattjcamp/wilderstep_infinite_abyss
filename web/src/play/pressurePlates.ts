/**
 * Pressure plates — step-toggled tile swaps.
 *
 * A cell authored with a `pressure_plate` block names a target cell
 * (possibly on a different map) and a replacement palette tile.
 * Stepping onto the plate TOGGLES the target:
 *
 *   - OFF → ON: the target cell's tile becomes `tile_id`. Persisted
 *     as an entry in `save.maps[map_id].tileOverrides` — the same
 *     machinery quest `tile_add` rewards use — so the change is
 *     permanent: it survives reload, link traversal, and map
 *     re-entry (the mount-time override pass repaints it).
 *   - ON → OFF: the plate's override entry is REMOVED, restoring the
 *     authored tile (or whatever earlier override still applies to
 *     that cell, e.g. a quest-built bridge).
 *
 * "Is the plate on?" is derived from the override list itself — an
 * entry matching the plate's (col, row, tile_id) means ON. No extra
 * toggle state to persist, and two plates wired to the same target
 * naturally share state.
 *
 * When the target is on the CURRENTLY MOUNTED map the swap also
 * applies live: grid cell replaced (the sim + renderer share the
 * grid by reference, so walkability changes take effect on the next
 * step), sprite repainted, lighting recomputed. Restoring needs the
 * pre-override cell — callers maintain a `pristine` stash of
 * original cells (PlayHost stashes at mount-time override apply and
 * this module stashes before a live swap).
 *
 * Pure with respect to the save (returns a new WorldSave); live-map
 * mutation happens through the ctx handles, mirroring the quest
 * tile-add path in PlayHost.
 */

import type { SavedMapState, WorldSave } from "./saveTypes";

/** Authored pressure-plate block on a cell (SimCell.pressure_plate /
 *  the editor TileType's same-named field). */
export interface PressurePlateDef {
  map_id: string;
  col: number;
  row: number;
  /** Palette tile id painted onto the target while the plate is ON. */
  tile_id: string;
}

/** Narrow palette entry — just what the swap needs. Index signature
 *  keeps the full tile record intact when copied into the grid. */
export interface PlatePaletteTile {
  id: string;
  sprite?: string;
  boat?: boolean;
  [k: string]: unknown;
}

/** Live-map mutation handles. All optional — omitting them (target
 *  on another map, renderer not mounted yet) skips live application;
 *  the persisted override is applied by the mount pass next visit. */
export interface PlateToggleCtx {
  /** Id of the currently mounted map, or null when unknown. */
  liveMapId: string | null;
  /** The mounted map. `grid` cells are typed `unknown` so the host's
   *  concrete cell interface (SimCell / the editor TileType) assigns
   *  without an index-signature cast; this module only spreads and
   *  replaces whole cells, never reads typed fields off them. */
  liveMap?: {
    width: number;
    height: number;
    grid: Array<Array<unknown>>;
  } | null;
  palette: ReadonlyArray<PlatePaletteTile>;
  renderer?: {
    setCellSprite(col: number, row: number, sprite: string): void;
    relight(): void;
  } | null;
  sim?: { addBoatAt(col: number, row: number, sprite: string): void } | null;
  /** Pre-override cell stash, keyed `"col,row"`, for the live map.
   *  Read on restore; written before an ON-swap overwrites a cell
   *  that isn't stashed yet. */
  pristine?: Map<string, unknown>;
}

export type PlateToggleResult =
  | { kind: "activated" | "deactivated"; nextSave: WorldSave }
  | { kind: "invalid"; nextSave: WorldSave };

/** Read + validate a cell's pressure-plate block. Returns null when
 *  the cell isn't a plate or the block is malformed (missing target
 *  map / tile, non-finite coords) so a bad record steps like a
 *  normal tile instead of crashing the move pipeline. */
export function readPressurePlate(cell: unknown): PressurePlateDef | null {
  if (!cell || typeof cell !== "object") return null;
  const block = (cell as { pressure_plate?: unknown }).pressure_plate;
  if (!block || typeof block !== "object") return null;
  const p = block as Partial<PressurePlateDef>;
  if (typeof p.map_id !== "string" || p.map_id.length === 0) return null;
  if (typeof p.tile_id !== "string" || p.tile_id.length === 0) return null;
  if (!Number.isFinite(p.col) || !Number.isFinite(p.row)) return null;
  return {
    map_id: p.map_id,
    col: p.col as number,
    row: p.row as number,
    tile_id: p.tile_id,
  };
}

/** True when the plate's override entry is present — i.e. the plate
 *  is currently ON. */
export function plateIsActive(
  save: WorldSave,
  plate: PressurePlateDef,
): boolean {
  const overrides = save.maps[plate.map_id]?.tileOverrides ?? [];
  return overrides.some(
    (o) =>
      o.col === plate.col &&
      o.row === plate.row &&
      o.tileId === plate.tile_id,
  );
}

/** Toggle `plate` and return the next save. See module docs for the
 *  semantics. `kind: "invalid"` (save unchanged) when the replace
 *  tile isn't in the palette — a misauthored plate must not write an
 *  override the mount pass can never resolve. */
export function togglePressurePlate(
  save: WorldSave,
  plate: PressurePlateDef,
  ctx: PlateToggleCtx,
): PlateToggleResult {
  const replacement = ctx.palette.find((t) => t.id === plate.tile_id);
  if (!replacement) return { kind: "invalid", nextSave: save };

  const prev: SavedMapState = save.maps[plate.map_id] ?? {
    unlockedCells: [],
    defeatedEncounters: [],
    destroyedLairs: [],
  };
  const overrides = prev.tileOverrides ?? [];
  const matches = (o: { col: number; row: number; tileId: string }) =>
    o.col === plate.col && o.row === plate.row && o.tileId === plate.tile_id;
  const active = overrides.some(matches);

  const nextOverrides = active
    ? overrides.filter((o) => !matches(o))
    : [...overrides, { col: plate.col, row: plate.row, tileId: plate.tile_id }];

  const nextSave: WorldSave = {
    ...save,
    maps: {
      ...save.maps,
      [plate.map_id]: { ...prev, tileOverrides: nextOverrides },
    },
  };

  // ── Live application — only when the target map is mounted ──────
  applyLive(plate, !active, replacement, nextOverrides, ctx);

  return { kind: active ? "deactivated" : "activated", nextSave };
}

/** Mutate the live grid + renderer for a toggle on the mounted map.
 *  No-op when the target is elsewhere, out of bounds, or the live
 *  handles aren't available (the persisted override still applies at
 *  next mount, so skipping here is always safe). */
function applyLive(
  plate: PressurePlateDef,
  turningOn: boolean,
  replacement: PlatePaletteTile,
  remainingOverrides: ReadonlyArray<{
    col: number;
    row: number;
    tileId: string;
  }>,
  ctx: PlateToggleCtx,
): void {
  const map = ctx.liveMap;
  if (!map || ctx.liveMapId !== plate.map_id) return;
  const { col, row } = plate;
  if (row < 0 || row >= map.height || col < 0 || col >= map.width) return;
  const key = `${col},${row}`;

  if (turningOn) {
    // Stash the pre-swap cell once so a later OFF press can restore
    // it without a remount. Mount-time overrides stash their own
    // originals (PlayHost), so "first stash wins" preserves the
    // authored tile even across repeated toggles.
    if (ctx.pristine && !ctx.pristine.has(key)) {
      ctx.pristine.set(key, map.grid[row][col]);
    }
    map.grid[row][col] = { ...replacement };
    if (ctx.renderer && typeof replacement.sprite === "string") {
      ctx.renderer.setCellSprite(col, row, replacement.sprite);
    }
    // Boat-flagged replacement registers with the kernel so boarding
    // works — parity with the quest tile-add path.
    if (replacement.boat === true && ctx.sim && replacement.sprite) {
      ctx.sim.addBoatAt(col, row, replacement.sprite);
    }
  } else {
    // Restore: the latest still-applicable override for this cell
    // wins (e.g. a quest bridge painted earlier); otherwise the
    // stashed pristine cell. Neither available → leave the live
    // grid alone (next mount repaints from authored + overrides).
    let restored: Record<string, unknown> | null = null;
    for (const o of remainingOverrides) {
      if (o.col !== col || o.row !== row) continue;
      const source = ctx.palette.find((t) => t.id === o.tileId);
      if (source) restored = { ...source };
    }
    if (!restored) {
      const pristine = ctx.pristine?.get(key);
      if (pristine && typeof pristine === "object") {
        restored = { ...(pristine as Record<string, unknown>) };
      }
    }
    if (!restored) return;
    map.grid[row][col] = restored;
    if (ctx.renderer && typeof restored.sprite === "string") {
      ctx.renderer.setCellSprite(col, row, restored.sprite);
    }
  }
  // Walkability / obstruction / light_source may all have flipped —
  // recompute lighting the same way the quest tile-add path does.
  ctx.renderer?.relight();
}
