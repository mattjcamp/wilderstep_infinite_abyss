/**
 * Shared lighting model for the editor's map + dungeon scenes.
 *
 * Pure function: given a grid, a party position, the party's
 * emitted light source (if any), whether the party has infravision,
 * and an ambient mode, returns a per-cell tint decision plus a
 * per-source visibility flag.
 *
 * The math here used to live inline in two places (MapEditor's
 * relight + DungeonSimMount's relight) with slight drift each
 * pass. Pulling it out means:
 *   - One Bresenham LOS implementation, one falloff formula.
 *   - Party LOS gating of torches works the same in dungeons and
 *     overworld maps.
 *   - Infravision renders the same red shade everywhere.
 *   - The 1-tile party-vision baseline applies uniformly.
 *
 * Callers stay responsible for applying the returned tints to
 * whatever Phaser sprites they're rendering (cells, encounter
 * overlays, NPC overlays, etc.). This module only computes; it
 * never touches Phaser.
 */

import type { Position, SimCell, SimGrid, SimLightSource } from "./types";

/** Ambient brightness band the scene is rendered against. */
export type LightingMode = "day" | "twilight" | "night";

/** RGB intensity used when an infravision-revealed cell isn't lit
 *  by any other source. Pure red (G=B=0) at this brightness reads
 *  obviously different from torch light. */
export const INFRAVISION_RED = 180;

/** Grayscale brightness used for the "remembered" (fog-of-war) band —
 *  cells the party has previously seen but can't see right now. Sits
 *  comfortably above the night-mode ambient floor (~25) and well
 *  below in-LOS torch-pool brightness (~150+) so the player can
 *  spot at a glance "I've been here, but I'm not looking at it now."
 *  Tuned by eye: 90 is dim enough to read as "memory" against a
 *  fully-lit current view, bright enough to keep terrain readable
 *  in a corridor the party already mapped. */
export const REMEMBERED_BRIGHTNESS = 90;

/** Lighting "currently illuminated" threshold used to decide which
 *  cells the host should fold into its persistent visited set. Any
 *  cell whose post-relight brightness clears this bar counts as
 *  "the party can see this RIGHT NOW" — torchlit floor, party
 *  baseline pool, infravision-revealed terrain — and gets added.
 *  Sits above the night ambient (~25) but below the dimmest real
 *  source contribution so cells that are merely dim-ambient don't
 *  pollute the visited set. */
export const VISIBILITY_THRESHOLD = 60;

/** What `computeLighting` decides for one cell. The caller picks a
 *  Phaser tint from this — both fields are needed because overlay
 *  sprites (roamers, NPCs, etc.) inherit the same render band as
 *  their underlying cell. */
export interface CellLightingResult {
  /** RGB tint to apply (8-bit packed: `(R << 16) | (G << 8) | B`).
   *  `null` means "clear the tint" — Phaser renders the sprite at
   *  full brightness with no colour multiply. */
  tint: number | null;
  /** Grayscale brightness in 0..255 that drove the tint. Useful to
   *  the caller when tinting an overlay sprite: outside of
   *  infravision red the overlay tint is `(b<<16)|(b<<8)|b`. */
  brightness: number;
  /** True when the cell falls in the infravision-only render band
   *  (party in LOS, no other source reached it). Overlay sprites
   *  on this cell should tint red too, not grayscale. */
  isInfravisionRed: boolean;
  /** True when the cell isn't currently visible to the party but
   *  the host's `rememberedCells` set says the party has seen it
   *  before — the "fog of war" band. Cells in this band render at
   *  {@link REMEMBERED_BRIGHTNESS} so the player can still read the
   *  map shape after walking away. Overlay sprites (roamers, NPCs,
   *  emitters, quest glow) deliberately stay hidden on remembered-
   *  only cells — what was there when the party visited may have
   *  moved or burned out, so we only remember terrain. Mutually
   *  exclusive with `isInfravisionRed` (an in-LOS cell is currently
   *  visible, not remembered). */
  isRemembered: boolean;
}

export interface LightingResult {
  /** Per-cell render decision keyed by `"col,row"`. Every cell in
   *  the input grid appears exactly once. */
  cells: Map<string, CellLightingResult>;
  /** Per `light_source` cell, whether the source is currently
   *  visible to the party (`true` = LOS, `false` = hidden behind a
   *  wall). Drives particle-emitter visibility on torch cells. In
   *  Day mode every source reads `true`. */
  sourceVisible: Map<string, boolean>;
  /** Set of `"col,row"` keys the party can currently see — every
   *  cell whose post-lighting brightness clears
   *  {@link VISIBILITY_THRESHOLD}, including infravision-red cells.
   *  The host folds this into its persistent visited set on every
   *  relight so subsequent frames render unvisited cells dark,
   *  remembered cells dim, and currently-visible cells bright. In
   *  Day mode this is every cell on the grid (the whole map is
   *  considered visited the moment the party steps onto it). */
  currentlyVisible: Set<string>;
}

export interface LightingInputs {
  /** Row-major grid the relight runs against. */
  grid: SimGrid;
  /** Party's current cell. When `null` the result behaves as if
   *  the party isn't on the map: no baseline pool, no LOS gating
   *  on torches. Used by the editor's painting view (no sim
   *  active) so the relight pass still produces sensible tints. */
  party: Position | null;
  /** Party's emitted light source — torch / Galadriel's Light /
   *  whatever the sim contributes via `setPartyLight`. `null` when
   *  the party emits no light; the 1-tile baseline still applies. */
  partyLight: SimLightSource | null;
  /** True when the party should render with infravision: any
   *  in-LOS cell not lit by another source gets the red band.
   *
   *  This is a single combined flag — the caller has already ANDed
   *  "a roster member has the ability" with "the player has
   *  activated it". The helper itself doesn't know or care about
   *  race traits; it just renders red when this is true. When
   *  `party` is null (painting view, no sim) the flag is ignored. */
  partyInfravisionActive: boolean;
  /** Ambient band — same enum the editor's lighting toggle uses. */
  mode: LightingMode;
  /** Override the ambient brightness for `"twilight"` / `"night"`.
   *  Optional — defaults to 0.4 / 0.1 (matches the editor today). */
  ambientByMode?: Partial<Record<LightingMode, number>>;
  /** "Fog of war" — cells the party has visited at some point in
   *  the past (current frame or earlier). Cells in this set that
   *  aren't currently lit / in LOS render at a dim grayscale
   *  ({@link REMEMBERED_BRIGHTNESS}) instead of being collapsed to
   *  the ambient floor, so the player keeps a faint sense of map
   *  shape after walking away.
   *
   *  Pass `null` (or omit) to disable the band entirely — every
   *  cell falls back to the existing currently-lit-or-dark
   *  behaviour. The editor's painting view + tests that don't
   *  care about fog can leave this off. Day mode short-circuits
   *  this band (every cell is already fully lit), so the host
   *  doesn't have to special-case it. */
  rememberedCells?: ReadonlySet<string> | null;
}

/** Default ambients. Day is special-cased to skip the math. */
const DEFAULT_AMBIENT: Record<LightingMode, number> = {
  day: 1,
  twilight: 0.4,
  night: 0.1,
};

/**
 * Compute the lighting state for every cell on the grid plus the
 * visibility of each light source. Pure and synchronous.
 */
export function computeLighting(inputs: LightingInputs): LightingResult {
  const { grid, party, partyLight, partyInfravisionActive, mode } = inputs;
  const ambient = inputs.ambientByMode?.[mode] ?? DEFAULT_AMBIENT[mode];
  const rememberedCells = inputs.rememberedCells ?? null;
  const cells = new Map<string, CellLightingResult>();
  const sourceVisible = new Map<string, boolean>();
  const currentlyVisible = new Set<string>();

  // ── Day fast path ────────────────────────────────────────────────
  // Full bright; no LOS gating. Every cell + every emitter shows.
  // The fog-of-war band is meaningless here (no cell is dim enough
  // for "remembered" to matter), so we skip it and add every cell
  // to currentlyVisible — Day mode functionally "visits" the whole
  // map on first relight.
  if (mode === "day") {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const key = `${c},${r}`;
        cells.set(key, {
          tint: null,
          brightness: 255,
          isInfravisionRed: false,
          isRemembered: false,
        });
        currentlyVisible.add(key);
        if (cell?.light_source) sourceVisible.set(key, true);
      }
    }
    return { cells, sourceVisible, currentlyVisible };
  }

  // ── Night / twilight ────────────────────────────────────────────
  // Two source bands stack:
  //   1. Party baseline — range 1 by default, expanded by
  //      `partyLight.range` when the sim contributes a real source.
  //      Tracked separately from `sources` so the infravision pass
  //      can tell "lit by a real source" from "lit by baseline."
  //   2. Torches with LOS to the party — each one becomes a source
  //      that casts light to its surroundings (subject to LOS from
  //      the source too, so walls cast shadows).
  const partyBaselineRange =
    partyLight && partyLight.range > 0 ? partyLight.range : 1;
  const partyBaselineIsRealLight =
    partyLight !== null && partyLight.range > 1;

  /** Bresenham LOS between two cells. The source + destination
   *  cells themselves are NOT checked, so a wall's visible face
   *  still reads as lit even though it blocks light beyond. Empty
   *  / out-of-grid cells don't obstruct. */
  const hasLOS = (
    srcCol: number,
    srcRow: number,
    dstCol: number,
    dstRow: number,
  ): boolean => {
    if (srcCol === dstCol && srcRow === dstRow) return true;
    const dx = Math.abs(dstCol - srcCol);
    const dy = Math.abs(dstRow - srcRow);
    const sx = srcCol < dstCol ? 1 : -1;
    const sy = srcRow < dstRow ? 1 : -1;
    let err = dx - dy;
    let c = srcCol;
    let r = srcRow;
    const maxSteps = dx + dy + 2;
    for (let i = 0; i < maxSteps; i++) {
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        c += sx;
      }
      if (e2 < dx) {
        err += dx;
        r += sy;
      }
      if (c === dstCol && r === dstRow) return true;
      const cell = grid[r]?.[c];
      if (cell?.obstructs) return false;
    }
    return false;
  };

  // Walk every light-source cell once: a torch with LOS to the
  // party contributes to the source list AND keeps its emitter
  // visible; a torch without LOS stays hidden and casts nothing.
  // When no party position is supplied (painting view), every
  // torch contributes and every emitter shows.
  const torchSources: Array<{
    col: number;
    row: number;
    range: number;
  }> = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell?.light_source) continue;
      const range = cell.light_range ?? 0;
      if (range <= 0) continue;
      const key = `${c},${r}`;
      const visible = party === null
        ? true
        : hasLOS(party.col, party.row, c, r);
      sourceVisible.set(key, visible);
      if (visible) torchSources.push({ col: c, row: r, range });
    }
  }

  // Per-cell tint pass.
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      let brightness = ambient;
      let litByRealSource = false;

      // Party baseline. Applies when the party is on the map.
      if (party) {
        const dist = Math.max(
          Math.abs(c - party.col),
          Math.abs(r - party.row),
        );
        if (
          dist <= partyBaselineRange &&
          hasLOS(party.col, party.row, c, r)
        ) {
          const falloff = 1 - dist / (partyBaselineRange + 1);
          const lit = ambient + (1 - ambient) * falloff;
          if (lit > brightness) brightness = lit;
          if (partyBaselineIsRealLight) litByRealSource = true;
        }
      }

      // Torches the party can see.
      for (const s of torchSources) {
        const dist = Math.max(
          Math.abs(c - s.col),
          Math.abs(r - s.row),
        );
        if (dist > s.range) continue;
        if (!hasLOS(s.col, s.row, c, r)) continue;
        const falloff = 1 - dist / (s.range + 1);
        const lit = ambient + (1 - ambient) * falloff;
        if (lit > brightness) brightness = lit;
        litByRealSource = true;
      }

      // Infravision band — applies when:
      //   (a) the party has the ability,
      //   (b) no real source already lit this cell,
      //   (c) the party has LOS to the cell.
      const key = `${c},${r}`;
      const inInfraLOS =
        party !== null &&
        partyInfravisionActive &&
        !litByRealSource &&
        hasLOS(party.col, party.row, c, r);
      if (inInfraLOS) {
        cells.set(key, {
          tint: (INFRAVISION_RED << 16) | 0 | 0,
          brightness: INFRAVISION_RED,
          isInfravisionRed: true,
          isRemembered: false,
        });
        currentlyVisible.add(key);
        continue;
      }

      const level = clampByte(Math.floor(brightness * 255));

      // Fog-of-war band — when the cell is currently dim (no real
      // source lit it, no infravision LOS) BUT the host's
      // `rememberedCells` set says the party has been here before,
      // paint it at the dim REMEMBERED_BRIGHTNESS grayscale instead
      // of collapsing to ambient. Gate on `level < REMEMBERED_BRIGHTNESS`
      // so a cell that's actually lit brighter than the fog band
      // (e.g. inside the party's torch pool right now) doesn't get
      // unintentionally dimmed — we only ever paint UP into the fog
      // band, never down.
      const isRemembered =
        rememberedCells !== null &&
        rememberedCells.has(key) &&
        level < REMEMBERED_BRIGHTNESS;
      if (isRemembered) {
        cells.set(key, {
          tint:
            (REMEMBERED_BRIGHTNESS << 16) |
            (REMEMBERED_BRIGHTNESS << 8) |
            REMEMBERED_BRIGHTNESS,
          brightness: REMEMBERED_BRIGHTNESS,
          isInfravisionRed: false,
          isRemembered: true,
        });
        // Remembered cells are NOT currently visible — they don't
        // grow the visited set on this frame. They were added on a
        // previous frame when the party stood within range.
        continue;
      }

      cells.set(key, {
        tint:
          level >= 255 ? null : (level << 16) | (level << 8) | level,
        brightness: level,
        isInfravisionRed: false,
        isRemembered: false,
      });
      if (level >= VISIBILITY_THRESHOLD) currentlyVisible.add(key);
    }
  }

  return { cells, sourceVisible, currentlyVisible };
}

/** Caller-side instruction for applying a cell's tint to a sprite.
 *  Pure data — the lighting helper doesn't import Phaser. The
 *  caller dispatches: `clear` → `img.clearTint()`, `tint` →
 *  `img.setTint(value)`. (Phaser's MULTIPLY mode is implied.)
 *
 *  We deliberately keep multiply tinting everywhere — including
 *  the infravision red band. v2 tile sprites lean heavily on
 *  "mostly-black with coloured detail pixels" (grass renders as
 *  scattered green specks on a near-black background, water as
 *  faint blue ripples, etc.). Multiply preserves that: black
 *  pixels stay black, and a non-black pixel's red channel is what
 *  the tint actually reveals. The result is "mostly black tiles
 *  with their detail pixels recoloured red" — closer to what
 *  infravision is supposed to feel like than a solid red
 *  rectangle filling the whole cell. */
export interface CellTintApplication {
  mode: "clear" | "tint";
  /** RGB value to pass to `setTint`. Ignored when
   *  `mode === "clear"`. */
  value: number;
}

/** Build the tint application instruction for a single cell.
 *  Returns `mode: "clear"` for cells the result doesn't cover
 *  (off-grid lookups) or fully-lit cells. */
export function tintForCell(
  result: LightingResult,
  col: number,
  row: number,
): CellTintApplication {
  const info = result.cells.get(`${col},${row}`);
  if (!info) return { mode: "clear", value: 0 };
  if (info.tint === null) return { mode: "clear", value: 0 };
  return { mode: "tint", value: info.tint };
}

/** Whether a particle emitter on the given cell should currently
 *  render. Decorative emitters (fairy lights, smoke, fire) shouldn't
 *  pop through darkness — if the party can't see the cell, the
 *  ambient grayscale tint dims the cell sprite to near-black but
 *  the particles draw at full brightness, leaving bright specks
 *  floating in unreached corners. This helper applies the rule
 *  the dungeon scene already followed implicitly for torches:
 *
 *    - Lit by a real source (brightness above the ambient floor) →
 *      visible. Includes torch cells themselves, cells inside the
 *      party's vision pool, and cells reached by a torch beam.
 *    - Infravision-red → hidden. Heat vision wouldn't pick up
 *      decorative magic, and the red fill would just stomp on the
 *      particles anyway.
 *    - Outside everything → hidden.
 *
 *  Threshold of 30 lands just above the night-mode ambient (≈25)
 *  and well below twilight (≈102), so emitters stay visible in
 *  the editor's twilight pass even on cells with no other source. */
export function emitterVisibleAt(
  result: LightingResult,
  col: number,
  row: number,
): boolean {
  const info = result.cells.get(`${col},${row}`);
  if (!info) return false;
  if (info.isInfravisionRed) return false;
  // Remembered cells aren't currently watched by the party — the
  // brightness floor of REMEMBERED_BRIGHTNESS clears the >30 check
  // below, so we have to explicitly suppress emitters here. Without
  // this, every torch on a tile the party once visited would keep
  // flickering even after the party walked back into darkness.
  if (info.isRemembered) return false;
  return info.brightness > 30;
}

/**
 * Whether a moving / live overlay (roamer, NPC, placed encounter,
 * quest glow, detected-trap mark) should currently render at the
 * given cell. Stricter than {@link emitterVisibleAt} in one way:
 * remembered cells are excluded here too, since the party can't see
 * a goblin that's currently in a corridor they walked past last
 * turn. (Showing them would be both a gameplay cheat and visually
 * misleading — the goblin moves between frames.) Tile sprites
 * themselves don't go through this gate; they're static and the
 * dim "remembered" tint is exactly what we want for terrain.
 */
export function overlayVisibleAt(
  result: LightingResult,
  col: number,
  row: number,
): boolean {
  const info = result.cells.get(`${col},${row}`);
  if (!info) return false;
  if (info.isRemembered) return false;
  // Infravision sees moving things, so the red band counts as
  // visible for overlays (matches the existing behaviour where
  // roamers tint red on infravision tiles).
  if (info.isInfravisionRed) return true;
  return info.brightness > 30;
}


function clampByte(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

// SimCell isn't imported above because `grid[r][c]` types it
// transitively. This re-export keeps consumers that want to type
// helper code against the cell shape from having to dual-import.
export type { SimCell };
