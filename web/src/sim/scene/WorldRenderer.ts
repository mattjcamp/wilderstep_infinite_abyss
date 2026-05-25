/**
 * WorldRenderer — shared Phaser scaffolding for any scene that renders
 * a v2 SimGrid with a party, light sources, roaming entities, and tile
 * animations.
 *
 * The MapSimulation kernel drives game logic identically across the
 * map editor's sim mode, the dungeon simulator, and (eventually) the
 * live /play page. Around the kernel each scene used to maintain its
 * own copy of the rendering scaffolding: cell sprite registry, party
 * sprite, roamer + placed-encounter overlays, particle emitters for
 * torch flames, and the relight pipeline that ties them all together.
 * Those copies drifted from each other in subtle ways (texture-exists
 * checks done differently, slightly different depth bands, missing
 * tint-on-overlay passes) and adding a feature meant editing every
 * scene by hand.
 *
 * This module collapses the duplication into a helper class. Callers
 * still own their Phaser.Scene — they instantiate `WorldRenderer` in
 * their `create()` method, hook it up to a `SceneBridge`, and add any
 * scene-specific layers (the editor's selection / grid / item overlay
 * graphics, the dungeon's chest overlay) on top.
 *
 * Extension model: pass `onRelight` in the config to receive the
 * shared `LightingResult` after each relight pass. Use it together
 * with `tintForCell` (re-exported from `@/sim/lighting`) to tint any
 * custom overlays your scene draws so they share the same render band
 * as the shared layers.
 *
 * What WorldRenderer owns:
 *   - Per-cell base sprite (`cells`)
 *   - Per-cell particle emitter from `cell.animation` (`emitters`)
 *   - The single party sprite (`partySprite`)
 *   - Roamer + placed-encounter sprite layers (`roamerSprites`,
 *     `placedEncounterSprites`)
 *   - The relight pass: computeLighting → tint cells, emitters,
 *     roamers, placed encounters → invoke onRelight for custom layers
 *   - The "infravision: active && has-ability" gating
 *
 * What WorldRenderer does NOT own:
 *   - Sprite preloading. Each caller knows which sprite keys it
 *     needs and runs its own `scene.load.image(...)` pass in
 *     `preload()`. WorldRenderer assumes textures are already loaded
 *     when its methods run.
 *   - The MapSimulation lifecycle. Callers construct the kernel,
 *     subscribe to events, and dispose. WorldRenderer is a one-way
 *     sink driven by the bridge methods the caller wires up.
 *   - React-level overlays (NPC dialog, lock dialog, etc.). Those
 *     stay in the host component.
 */

import type Phaser from "phaser";
import {
  computeLighting,
  emitterVisibleAt,
  overlayVisibleAt,
  tintForCell,
  type LightingResult,
} from "@/sim/lighting";
import { ANIMATION_CONFIGS } from "@/sim/tileAnimations";
import { QUEST_GLOW } from "@/sim/questGlow";
import type { SimLightSource } from "@/sim/types";
import { withBasePath } from "@/util/basePath";

/** Structural shape of a cell the renderer reads. Both v2 map cells
 *  (`MapRecord.grid[r][c]` from the editor) and dungeon cells
 *  (`DungeonMapCell` from the generator) satisfy this — the renderer
 *  doesn't care about gameplay fields (encounter, locked, etc.),
 *  only render properties. Subset, so callers can pass their own
 *  richer cell type without conversion. */
export interface RenderCell {
  sprite?: string;
  /** Optional animation key — torch / fairy / fire / smoke — mapped
   *  to a particle emitter config in `ANIMATION_CONFIGS`. Cells
   *  without this field (or with `"none"`) get no emitter. */
  animation?: string | null;
  /** Lighting flags — these aren't read here but the `computeLighting`
   *  call inside `relight()` reads them through the grid reference,
   *  so the cell shape needs to expose them. The lighting helper
   *  itself checks for missing fields gracefully. */
  light_source?: boolean;
  light_range?: number;
  obstructs?: boolean;
  walkable?: boolean;
}

/** Grid shape the renderer reads — rows of RenderCells. Same in-memory
 *  layout as `SimGrid`, but with the loosened cell type so callers'
 *  richer cell types are assignable without a cast. */
export type RenderGrid = ReadonlyArray<ReadonlyArray<RenderCell>>;

/** Cell size in pixels. Both the editor's MapScene and the dungeon
 *  scene have always used 32×32; centralising it here means every
 *  consumer agrees on tile pitch + sprite display size. */
export const TILE_SIZE = 32;

/** Roamer / placed-encounter row entry — what `setRoamerPositions`
 *  and `setPlacedEncounterPositions` accept. Matches the kernel's
 *  SceneBridge contract. */
export interface RoamerSpriteEntry {
  id: string;
  col: number;
  row: number;
  sprite: string;
  /** Optional sprite tint (packed RGB). When present, the relight
   *  pass multiplies the per-cell lighting tint by this value so the
   *  sprite carries its own colour wash on top of the ambient — used
   *  today by quest-target dungeon placements (faint gold halo).
   *  Stored on the Image via `setData("tint", value)` so re-tints
   *  during relight don't need the entry list re-passed. */
  tint?: number;
}

/** Construction options. Everything except `scene` and `grid` is
 *  optional — callers can mutate the renderer's fields directly after
 *  construction for properties that aren't known until later (e.g.
 *  the party avatar resolves only after the catalog loads). */
export interface WorldRendererConfig {
  scene: Phaser.Scene;
  /** Grid the cells are rendered from. Captured by reference — if
   *  the caller swaps tiles in-place the renderer's `relight` reads
   *  the live shape. Cell replacement should still go through
   *  `setCellSprite` so the renderer's `cells` map stays in sync. */
  grid: RenderGrid;
  /** Sprite key Phaser uses for the party. `setPartyAt` falls back to
   *  a generated `__party_marker` texture when this is empty or the
   *  named texture didn't load. */
  partyAvatar?: string;
  /** True iff any currently-active party member's race carries the
   *  `infravision` ability. Set once at scene boot — the renderer
   *  doesn't recompute it. */
  partyHasInfravision?: boolean;
  /** Initial lighting mode. The host's React effect can call
   *  `setLightingMode` later to track its `darkness` prop. */
  initialLightingMode?: "day" | "twilight" | "night";
  /** Initial value of the player-controlled "is infravision engaged"
   *  flag. Combined with `partyHasInfravision` at relight time. */
  initialInfravisionActive?: boolean;
  /** Hook fired after each relight pass — receives the shared
   *  LightingResult so callers can tint their own overlays in sync.
   *  Use `tintForCell(result, col, row)` (re-exported from this
   *  module) to compute the per-cell tint. */
  onRelight?: (result: LightingResult) => void;
}

/** Backing field key for the placeholder "party marker" texture
 *  generated on-demand when no avatar sprite is available. */
const PARTY_MARKER_TEX = "__party_marker";
/** Key for the white particle source texture used by every animation
 *  emitter. Shared with editor-side code that may also create it. */
const PARTICLE_TEX = "__particle";

export class WorldRenderer {
  readonly scene: Phaser.Scene;
  /** Captured grid reference. Callers can mutate cells in-place; the
   *  next relight reads the latest shape. */
  grid: RenderGrid;
  partyAvatar: string;

  /** Per-cell base sprite, keyed `"col,row"`. */
  readonly cells = new Map<string, Phaser.GameObjects.Image>();
  /** Particle emitters for cell animations. Same key shape. Hidden
   *  by the relight pass on cells the party can't see. */
  readonly emitters = new Map<
    string,
    Phaser.GameObjects.Particles.ParticleEmitter
  >();
  /** Live roamer sprites keyed by roamer id. Diff'd by
   *  `setRoamerPositions` — entries that disappear from the incoming
   *  list are destroyed, new ids spawn, survivors move/swap texture. */
  readonly roamerSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Live placed-encounter sprites keyed by placed-encounter id. Same
   *  diff'd-update pattern as roamers. */
  readonly placedEncounterSprites = new Map<
    string,
    Phaser.GameObjects.Image
  >();
  /** Detected-trap overlay markers keyed `"col,row"`. Each entry is a
   *  small red-X Graphics drawn over the cell that hides a trap the
   *  Detect Traps effect has revealed. `setDetectedTraps` diffs this
   *  against an incoming set of cell keys: cells that fell off the
   *  set get their graphic destroyed; new cells get a fresh one. */
  readonly detectedTrapMarks = new Map<
    string,
    Phaser.GameObjects.Graphics
  >();
  /** Cells that should carry the soft golden quest-relevance halo.
   *  Source of truth is the host (PlayHost): it computes the set via
   *  computeQuestGlowCells whenever the grid or accepted-quest set
   *  changes and pushes it here through `setQuestGlowCells`. The
   *  actual circles are drawn into `questGlowGraphics` on every
   *  `relight()` so the halo dims with ambient just like the cells. */
  questGlowCells: ReadonlySet<string> = new Set();
  /** Lazily-created Phaser Graphics layer the halo is drawn into.
   *  Single graphics object cleared + redrawn per relight — cheap,
   *  since the typical glow-cell set has a handful of entries. */
  private questGlowGraphics: Phaser.GameObjects.Graphics | null = null;

  /** The single party sprite. Null before `setPartyAt` fires. */
  partySprite: Phaser.GameObjects.Image | null = null;
  /** Whether the renderer currently has a party position. Toggled
   *  by `setPartyAt` / `clearParty`. When false (paint mode in the
   *  editor, pre-sim setup), `relight()` passes `party: null` to
   *  the lighting helper so torches don't gate on a phantom
   *  party-at-(0,0) and emitters stay visible. */
  hasParty = false;
  /** Last known party cell. Only meaningful while `hasParty` is
   *  true; reset to 0/0 on `clearParty`. */
  partyCol = 0;
  partyRow = 0;
  /** Current emitted-light source from the party (torch, etc.). The
   *  relight pass roots its party-vision pool here. Null = no
   *  party-emitted light (still 1-cell baseline). */
  partyLight: SimLightSource | null = null;
  /** Race-derived infravision capability. Set by the host at boot. */
  partyHasInfravision = false;
  /** Player-engaged infravision flag. Combined with `partyHasInfravision`
   *  at relight time — both must be true for red rendering. */
  partyInfravisionActive = false;
  /** `"day"` paints everything at full brightness; `"night"` runs the
   *  full Bresenham-LOS lighting model. */
  lightingMode: "day" | "twilight" | "night" = "night";

  /** Fog-of-war "visited cells" memory — every `"col,row"` the party
   *  has ever seen on this surface. Hosts seed it from persisted save
   *  state and call `setVisitedCells` whenever the set replaces
   *  wholesale (map swap, dungeon floor change). Each `relight()`
   *  pass unions newly-visible cells into the same Set in-place; the
   *  host's relight hook can read the updated set back via
   *  {@link getVisitedCells} and persist when convenient.
   *
   *  Held as a mutable Set so the in-place grow is allocation-free on
   *  the steady-state path (most relights add zero or one cell as the
   *  party steps). Set to a fresh empty Set when fog-of-war is
   *  disabled (today: never, but the field shape leaves the door
   *  open for an editor "show full map" debug toggle). */
  private visitedCells: Set<string> = new Set();

  /** Most recent LightingResult, stashed so per-overlay refresh
   *  paths (questGlow repaint, detected-trap repaint, future
   *  out-of-band refresh helpers) can re-read fog-of-war / tint
   *  bands without re-running the full Bresenham pass. Cleared
   *  to null until the first relight fires. */
  private lastLightingResult: LightingResult | null = null;

  private readonly onRelightHook?: (result: LightingResult) => void;

  constructor(cfg: WorldRendererConfig) {
    this.scene = cfg.scene;
    this.grid = cfg.grid;
    this.partyAvatar = cfg.partyAvatar ?? "";
    this.partyHasInfravision = !!cfg.partyHasInfravision;
    this.partyInfravisionActive = !!cfg.initialInfravisionActive;
    this.lightingMode = cfg.initialLightingMode ?? "night";
    this.onRelightHook = cfg.onRelight;
  }

  /** Generate the white-circle source texture used by every particle
   *  emitter. Idempotent — re-running on an already-initialised
   *  scene is a no-op. Call once at the start of `create()` before
   *  `createEmitters`. */
  ensureParticleTexture(): void {
    if (!this.scene.textures.exists(PARTICLE_TEX)) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 8);
      g.generateTexture(PARTICLE_TEX, 16, 16);
      g.destroy();
    }
    // Same idempotent guard for the party-marker placeholder. We
    // generate this here (rather than only lazily inside setPartyAt
    // when the avatar sprite is missing) because diffSprites uses
    // the same key as the fallback for roamer / placed-encounter
    // sprites whose texture wasn't preloaded. If the texture was
    // never generated, Phaser substitutes its built-in __MISSING
    // pattern — a green-and-magenta checker — which the user
    // (correctly) describes as a "green hollow box." Generating it
    // up front makes the fallback render the intended orange
    // marker dot in every code path.
    if (!this.scene.textures.exists(PARTY_MARKER_TEX)) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xffb84d, 1);
      g.fillCircle(16, 16, 13);
      g.lineStyle(2, 0x4a1c00, 1);
      g.strokeCircle(16, 16, 13);
      g.generateTexture(PARTY_MARKER_TEX, 32, 32);
      g.destroy();
    }
  }

  /** First-time render of every cell. Skips cells whose `sprite` is
   *  empty or whose texture hasn't loaded — the scene's preload step
   *  is responsible for queuing every needed sprite. */
  createCells(): void {
    for (let r = 0; r < this.grid.length; r++) {
      const row = this.grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const tex = cell?.sprite;
        if (!tex || !this.scene.textures.exists(tex)) continue;
        const img = this.scene.add
          .image(c * TILE_SIZE, r * TILE_SIZE, tex)
          .setOrigin(0)
          .setDisplaySize(TILE_SIZE, TILE_SIZE);
        this.cells.set(`${c},${r}`, img);
      }
    }
  }

  /** Particle emitter pass — one per cell whose `animation` value
   *  names a config in `ANIMATION_CONFIGS`. Depth 160 sits above the
   *  cell tint (multiplied onto the base image) but below party /
   *  roamer / placed-encounter sprites (250+). */
  createEmitters(): void {
    for (let r = 0; r < this.grid.length; r++) {
      const row = this.grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const animation = (cell?.animation ?? "none") as
          | keyof typeof ANIMATION_CONFIGS
          | "none";
        if (animation === "none") continue;
        const cfg = ANIMATION_CONFIGS[animation];
        if (!cfg) continue;
        const x = c * TILE_SIZE + TILE_SIZE / 2;
        const y = r * TILE_SIZE + TILE_SIZE / 2;
        const emitter = this.scene.add.particles(
          x,
          y,
          PARTICLE_TEX,
          cfg as unknown as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
        );
        emitter.setDepth(160);
        this.emitters.set(`${c},${r}`, emitter);
      }
    }
  }

  /** Move (or spawn) the party sprite. Captures `partyCol/Row`
   *  *before* the draw so a concurrent relight reads the new
   *  position. Generates a `__party_marker` placeholder texture when
   *  the configured avatar key is missing — keeps the party visible
   *  even before assets resolve. */
  setPartyAt(col: number, row: number): void {
    this.partyCol = col;
    this.partyRow = row;
    this.hasParty = true;
    const px = col * TILE_SIZE + TILE_SIZE / 2;
    const py = row * TILE_SIZE + TILE_SIZE / 2;
    if (!this.partySprite) {
      const sprite = this.partyAvatar;
      let tex = sprite && this.scene.textures.exists(sprite) ? sprite : PARTY_MARKER_TEX;
      if (
        tex === PARTY_MARKER_TEX &&
        !this.scene.textures.exists(PARTY_MARKER_TEX)
      ) {
        const g = this.scene.add.graphics();
        g.fillStyle(0xffb84d, 1);
        g.fillCircle(16, 16, 13);
        g.lineStyle(2, 0x4a1c00, 1);
        g.strokeCircle(16, 16, 13);
        g.generateTexture(PARTY_MARKER_TEX, 32, 32);
        g.destroy();
      }
      this.partySprite = this.scene.add
        .image(px, py, tex)
        .setOrigin(0.5)
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setDepth(300);
    } else {
      this.partySprite.setPosition(px, py);
    }
  }

  /** Drop the party sprite — used when sim mode toggles off. Also
   *  clears `hasParty` so the next `relight()` falls back to
   *  paint-mode behaviour (no LOS gate, emitters all visible). */
  clearParty(): void {
    if (this.partySprite) {
      this.partySprite.destroy();
      this.partySprite = null;
    }
    this.hasParty = false;
    this.partyCol = 0;
    this.partyRow = 0;
  }

  setPartyLight(source: SimLightSource | null): void {
    this.partyLight = source;
  }

  setRoamerPositions(positions: ReadonlyArray<RoamerSpriteEntry>): void {
    this.diffSprites(this.roamerSprites, positions);
  }

  setPlacedEncounterPositions(
    positions: ReadonlyArray<RoamerSpriteEntry>,
  ): void {
    this.diffSprites(this.placedEncounterSprites, positions);
  }

  /** Swap a single cell's texture (used by the destroy-lair path so a
   *  defeated Monster Spawn renders as grass). Idempotent — guards
   *  against missing textures and unknown cell keys. */
  setCellSprite(col: number, row: number, sprite: string): void {
    const img = this.cells.get(`${col},${row}`);
    if (!img) return;
    if (!this.scene.textures.exists(sprite)) return;
    img.setTexture(sprite);
  }

  /** Paint a red-X overlay on every cell whose key is in `cells`, and
   *  erase the overlay from any cell that's no longer in the set.
   *  The host calls this whenever the Detect Traps party effect
   *  toggles or a trap fires (the kernel can't paint, so the host
   *  diffs the live trap-positions list against the previously-
   *  rendered set). Depth 95 sits above placed-encounter overlays
   *  (80) and below the party sprite (300). */
  setDetectedTraps(cells: ReadonlySet<string>): void {
    // Drop markers for cells that are no longer detected.
    for (const [key, g] of this.detectedTrapMarks) {
      if (!cells.has(key)) {
        g.destroy();
        this.detectedTrapMarks.delete(key);
      }
    }
    // Add markers for new cells.
    for (const key of cells) {
      if (this.detectedTrapMarks.has(key)) continue;
      const [colStr, rowStr] = key.split(",");
      const col = Number.parseInt(colStr, 10);
      const row = Number.parseInt(rowStr, 10);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const px = col * TILE_SIZE + TILE_SIZE / 2;
      const py = row * TILE_SIZE + TILE_SIZE / 2;
      const inset = 8;
      const g = this.scene.add.graphics();
      g.lineStyle(3, 0xff3030, 0.95);
      g.beginPath();
      g.moveTo(px - TILE_SIZE / 2 + inset, py - TILE_SIZE / 2 + inset);
      g.lineTo(px + TILE_SIZE / 2 - inset, py + TILE_SIZE / 2 - inset);
      g.moveTo(px + TILE_SIZE / 2 - inset, py - TILE_SIZE / 2 + inset);
      g.lineTo(px - TILE_SIZE / 2 + inset, py + TILE_SIZE / 2 - inset);
      g.strokePath();
      g.setDepth(95);
      this.detectedTrapMarks.set(key, g);
    }
  }

  /** Update the cell set that carries the quest-relevance halo. The
   *  caller (PlayHost) computes the set from grid + quest defs +
   *  accepted-quests via `computeQuestGlowCells` (sim/questGlow) and
   *  pushes it in here whenever any input changes. We stash it and
   *  trigger a repaint; the actual draw happens inside `relight()`
   *  so the halo brightness tracks ambient lighting automatically.
   *
   *  Passing an empty set clears the halo. Idempotent — pushing the
   *  same set twice does no work beyond the cheap repaint. */
  setQuestGlowCells(cells: ReadonlySet<string>): void {
    this.questGlowCells = cells;
    this.repaintQuestGlow();
  }

  /** Redraw the quest-glow Graphics layer. Cleared and rebuilt from
   *  the live `questGlowCells` set. Each cell gets a soft gold disc
   *  whose RGB is multiplied by the cell's current ambient brightness
   *  (read from the base sprite's tint) so dim corridors get a dim
   *  halo. Pure side-effect on the Graphics object — called from
   *  `relight()` (so brightness stays current) and from
   *  `setQuestGlowCells` (so a set change shows up immediately even
   *  if no relight happens).
   *
   *  The graphics object is lazily created on first use to avoid a
   *  fixed setup cost for renderers that never use the halo (e.g. the
   *  editor, which paints its own glow). */
  private repaintQuestGlow(): void {
    if (!this.questGlowGraphics && this.questGlowCells.size === 0) {
      // Skip the lazy-init path if there's nothing to paint anyway.
      return;
    }
    if (!this.questGlowGraphics) {
      this.questGlowGraphics = this.scene.add.graphics();
      // Behind placed-encounter sprites (depth 80) and party (300),
      // ahead of base cells. Matches the editor's halo placement.
      this.questGlowGraphics.setDepth(60);
    }
    const g = this.questGlowGraphics;
    g.clear();
    if (this.questGlowCells.size === 0) return;
    const { baseColor, alpha, radiusFactor } = QUEST_GLOW;
    for (const key of this.questGlowCells) {
      const [csStr, rsStr] = key.split(",");
      const cs = Number(csStr);
      const rs = Number(rsStr);
      if (!Number.isFinite(cs) || !Number.isFinite(rs)) continue;
      // Fog-of-war gate — a quest target in a corridor the party
      // already visited but isn't currently watching shouldn't
      // glow. The halo is "where to go right now", not "where you
      // went last turn" — leaking it onto remembered cells would
      // turn the dim band into a quest beacon that bypasses
      // exploration. Skip only when we're in fog-of-war mode (i.e.
      // there's a party); paint mode keeps the prior behaviour.
      if (this.hasParty) {
        const info = this.lastLightingResult?.cells.get(key);
        if (info?.isRemembered) continue;
      }
      // Brightness from the base cell's current tint. `relight` paints
      // a grayscale tint where all three channels equal ambient * 255,
      // so the low byte is the brightness 0..255. Untinted cells
      // (Day mode / "clear") read brightness=1.
      let brightness = 1;
      const baseImg = this.cells.get(key);
      if (baseImg && baseImg.isTinted) {
        brightness = (baseImg.tintTopLeft & 0xff) / 255;
      }
      const r = Math.round(baseColor.r * brightness);
      const gg = Math.round(baseColor.g * brightness);
      const b = Math.round(baseColor.b * brightness);
      const color = (r << 16) | (gg << 8) | b;
      g.fillStyle(color, alpha);
      const cx = cs * TILE_SIZE + TILE_SIZE / 2;
      const cy = rs * TILE_SIZE + TILE_SIZE / 2;
      // Slightly wider than the cell so the halo bleeds past sprite
      // edges. Matches the editor.
      g.fillCircle(cx, cy, TILE_SIZE * radiusFactor);
    }
  }

  /** Update the player-engaged infravision flag + trigger a relight.
   *  Called by hosts that toggle infravision from React UI; the sim
   *  kernel also routes its own toggle through the bridge to this. */
  setPartyInfravisionActive(active: boolean): void {
    if (this.partyInfravisionActive === active) return;
    this.partyInfravisionActive = active;
    this.relight();
  }

  setLightingMode(mode: "day" | "twilight" | "night"): void {
    if (this.lightingMode === mode) return;
    this.lightingMode = mode;
    this.relight();
  }

  /** Replace the fog-of-war visited set wholesale. Hosts call this on
   *  map swap / dungeon-floor change to seed the renderer with the
   *  persisted set for the new surface. Triggers a relight so the
   *  swap is immediately reflected in the tints (previously-seen
   *  cells light up dim, never-seen cells stay dark). Pass an empty
   *  Set to reset the surface to "completely unexplored." */
  setVisitedCells(cells: ReadonlySet<string>): void {
    // Copy so the host can keep a private reference without us
    // mutating it under them, and so our in-place `add` on grow
    // doesn't leak back into the caller's source-of-truth set.
    this.visitedCells = new Set(cells);
    this.relight();
  }

  /** Snapshot the current visited set for the host to persist. The
   *  set returned is a defensive copy — the host can freeze it,
   *  serialise it, hand it to a save layer, without worrying about
   *  the next relight mutating their reference. */
  getVisitedCells(): ReadonlySet<string> {
    return new Set(this.visitedCells);
  }

  /** Run the shared lighting pipeline + apply tints. After the
   *  shared layers are tinted, fires `onRelight(result)` so callers
   *  can tint any custom overlays (chests, items, NPCs, etc.) using
   *  `tintForCell(result, col, row)`. */
  relight(): void {
    // `computeLighting` types its grid as `SimGrid`, but it only
    // reads structural fields (sprite/light_source/light_range/
    // obstructs) — the same subset the renderer exposes through
    // `RenderCell`. The cast bridges the wider RenderGrid to the
    // narrower SimGrid the helper declared; runtime-safe because
    // every caller's cell type carries the SimCell-required fields
    // even if the renderer's static type doesn't require them.
    const result = computeLighting({
      grid: this.grid as unknown as import("@/sim/types").SimGrid,
      // No party (`hasParty` false) keeps the renderer in
      // "painting view" — the lighting helper interprets null as
      // "no LOS gate", so the whole map renders at its static
      // ambient and emitters stay visible. The editor uses this
      // when sim mode is off so authors see what they're painting.
      party: this.hasParty
        ? { col: this.partyCol, row: this.partyRow }
        : null,
      partyLight: this.partyLight,
      partyInfravisionActive:
        this.partyHasInfravision && this.partyInfravisionActive,
      mode: this.lightingMode,
      // Fog-of-war remembrance — only meaningful with a party on the
      // surface (paint-mode previews don't have a party to "have
      // seen" anything). Skipping the set when `hasParty` is false
      // keeps the editor's idle painting view rendering exactly as
      // before this change.
      rememberedCells: this.hasParty ? this.visitedCells : null,
    });
    // Stash for out-of-band readers (quest glow repaint reads
    // isRemembered to decide whether to skip a cell, etc.).
    this.lastLightingResult = result;
    // Grow the visited set with everything the party can see right
    // now. Done IN PLACE on the same Set the host handed us so the
    // host's reference (e.g. the kernel's persisted set) sees the
    // additions next time it's read — no allocation per relight on
    // the steady-state path (typically zero or one new cell per
    // party step). Skip in paint-mode (no party) since
    // currentlyVisible would be the full grid and we'd silently
    // mark the entire map "explored" the moment the author toggled
    // sim mode on.
    if (this.hasParty) {
      for (const key of result.currentlyVisible) {
        this.visitedCells.add(key);
      }
    }
    // Cells.
    for (const [key, img] of this.cells) {
      const [cs, rs] = key.split(",");
      const t = tintForCell(result, Number(cs), Number(rs));
      if (t.mode === "clear") img.clearTint();
      else img.setTint(t.value);
    }
    // Emitters — hide on cells beyond party LOS so torch flames
    // don't leak through darkness. In painting view (`hasParty`
    // false) we keep every emitter visible so the author can see
    // what they painted at any ambient.
    if (this.hasParty) {
      for (const [key, emitter] of this.emitters) {
        const [cs, rs] = key.split(",");
        emitter.setVisible(
          emitterVisibleAt(result, Number(cs), Number(rs)),
        );
      }
    } else {
      for (const emitter of this.emitters.values()) {
        emitter.setVisible(true);
      }
    }
    // Roamer + placed-encounter overlays inherit their cell's tint.
    // When the sprite carries its own `tint` (stashed via setData
    // when the entry arrived), we multiply it with the lighting
    // tint channel-by-channel — matches how Phaser's MULTIPLY blend
    // would combine them visually, but composed explicitly so a
    // fully-lit cell ("clear" mode) still applies the per-sprite
    // tint instead of clearing it.
    const multiplyTint = (a: number, b: number): number => {
      const ar = (a >> 16) & 0xff;
      const ag = (a >> 8) & 0xff;
      const ab = a & 0xff;
      const br = (b >> 16) & 0xff;
      const bg = (b >> 8) & 0xff;
      const bb = b & 0xff;
      const r = Math.round((ar * br) / 255) & 0xff;
      const g = Math.round((ag * bg) / 255) & 0xff;
      const bl = Math.round((ab * bb) / 255) & 0xff;
      return (r << 16) | (g << 8) | bl;
    };
    const tintOverlay = (img: Phaser.GameObjects.Image) => {
      const col = Math.round((img.x - TILE_SIZE / 2) / TILE_SIZE);
      const row = Math.round((img.y - TILE_SIZE / 2) / TILE_SIZE);
      // Fog-of-war gate — overlays (roamers, NPCs, placed
      // encounters) are LIVE entities. Even when the underlying
      // cell renders in the dim "remembered" band, we don't want
      // to draw the goblin that moved into that corridor since the
      // party left — both because it's a small cheat and because
      // the sprite would visibly teleport between frames. In
      // paint mode the renderer keeps the old "always visible"
      // behaviour (no party = no LOS gate = nothing to hide).
      if (this.hasParty && !overlayVisibleAt(result, col, row)) {
        img.setVisible(false);
        return;
      }
      img.setVisible(true);
      const t = tintForCell(result, col, row);
      const spriteTint = img.getData("tint");
      const hasSpriteTint = typeof spriteTint === "number";
      if (t.mode === "clear" && !hasSpriteTint) {
        img.clearTint();
        return;
      }
      if (t.mode === "clear" && hasSpriteTint) {
        img.setTint(spriteTint as number);
        return;
      }
      if (!hasSpriteTint) {
        img.setTint(t.value);
        return;
      }
      img.setTint(multiplyTint(t.value, spriteTint as number));
    };
    for (const img of this.roamerSprites.values()) tintOverlay(img);
    for (const img of this.placedEncounterSprites.values()) tintOverlay(img);
    // Quest-relevance halo. Repainted from scratch each relight so
    // brightness tracks ambient — a quest target in a dim corridor
    // gets a dim halo, a quest giver in daylight gets a bright one.
    this.repaintQuestGlow();
    // Caller hook — tint custom overlays in sync with the shared
    // layers so a chest in a torchlit corridor reads at the same
    // ambient as the corridor floor.
    this.onRelightHook?.(result);
  }

  /** Shared diff between an existing sprite map and an incoming
   *  positions list. Destroys entries that left, creates entries
   *  that arrived, repositions / re-textures survivors. */
  private diffSprites(
    map: Map<string, Phaser.GameObjects.Image>,
    positions: ReadonlyArray<RoamerSpriteEntry>,
  ): void {
    const wanted = new Map(positions.map((p) => [p.id, p]));
    for (const [id, img] of map) {
      if (wanted.has(id)) continue;
      img.destroy();
      map.delete(id);
    }
    for (const [id, p] of wanted) {
      const px = p.col * TILE_SIZE + TILE_SIZE / 2;
      const py = p.row * TILE_SIZE + TILE_SIZE / 2;
      let img = map.get(id);
      if (!img) {
        const hasTexture =
          !!p.sprite && this.scene.textures.exists(p.sprite);
        const tex = hasTexture ? (p.sprite as string) : PARTY_MARKER_TEX;
        img = this.scene.add
          .image(px, py, tex)
          .setOrigin(0.5)
          .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
          .setDepth(250);
        map.set(id, img);
        // Lazy-load the texture if the sprite key wasn't in the
        // preload pass. Without this defense, any sprite path the
        // preload missed lands as the green PARTY_MARKER_TEX
        // placeholder for the lifetime of the scene. The lazy load
        // fires once per missing key, swaps the texture on the
        // already-placed Image when complete, and is a no-op on
        // subsequent diffSprites passes (the second call sees
        // hasTexture === true). A console warning surfaces the
        // missing key so authoring data can be fixed too.
        if (!hasTexture && p.sprite) {
          this.queueLazySpriteLoad(id, p.sprite, map);
        }
      } else {
        img.setPosition(px, py);
        if (
          p.sprite &&
          this.scene.textures.exists(p.sprite) &&
          img.texture.key !== p.sprite
        ) {
          img.setTexture(p.sprite);
        } else if (p.sprite && !this.scene.textures.exists(p.sprite)) {
          // Same self-healing as the create branch.
          this.queueLazySpriteLoad(id, p.sprite, map);
        }
      }
      // Stash the per-entry tint on the Image so the next relight
      // can read it back without the caller having to re-pass the
      // whole positions list. Setting to null when absent clears any
      // leftover tint from a prior placement.
      img.setData("tint", typeof p.tint === "number" ? p.tint : null);
    }
  }

  /** Fire a one-shot Phaser load for a sprite key that wasn't ready
   *  at diffSprites time. On completion, swap every placeholder
   *  Image in `map` whose entry references the same key (the diff
   *  could have spawned multiple). Idempotent — only one load fires
   *  per key, tracked via `lazyLoadInflight`.
   *
   *  Uses Phaser's per-file `filecomplete-image-<key>` event rather
   *  than the loader-wide `complete` event. The general event only
   *  fires when the entire queued batch finishes and can miss when
   *  the loader is already in a mid-cycle state; the per-file
   *  variant fires exactly once for the matching key regardless of
   *  what else is queued, which is what we need here.
   */
  private queueLazySpriteLoad(
    spriteId: string,
    spriteKey: string,
    map: Map<string, Phaser.GameObjects.Image>,
  ): void {
    if (this.lazyLoadInflight.has(spriteKey)) return;
    this.lazyLoadInflight.add(spriteKey);
    // eslint-disable-next-line no-console
    console.warn(
      `[WorldRenderer] sprite "${spriteKey}" was not preloaded; ` +
        `lazy-loading. Add it to the host's preload list to avoid the ` +
        `placeholder marker on first paint.`,
    );
    const url = withBasePath(`/sprites/${spriteKey}`);
    this.scene.load.image(spriteKey, url);
    this.scene.load.once(
      `filecomplete-image-${spriteKey}`,
      () => {
        if (!this.scene.textures.exists(spriteKey)) return;
        // Re-scan the live sprite map and swap every image whose
        // texture still references the placeholder. A diff pass
        // between queueing and completion could have moved entries
        // around — we don't trust the captured spriteId alone.
        for (const [, img] of map) {
          if (img.texture.key !== spriteKey) {
            // Capture: only swap if the image is currently the
            // placeholder (or any non-target key). Skip images
            // that already got their real texture from another
            // path.
            if (img.texture.key === "__party_marker") {
              img.setTexture(spriteKey);
            }
          }
        }
        // Fast-path: also try the original spriteId in case the
        // image is fine and just needs a swap.
        const direct = map.get(spriteId);
        if (
          direct &&
          direct.texture.key !== spriteKey &&
          this.scene.textures.exists(spriteKey)
        ) {
          direct.setTexture(spriteKey);
        }
      },
    );
    this.scene.load.start();
  }
  /** Sprite keys we've already kicked off a lazy load for. Stops the
   *  same key from re-firing on every diffSprites pass. */
  private readonly lazyLoadInflight = new Set<string>();
}

// Re-export so callers can build their custom-overlay tinting against
// the same primitives the renderer uses internally.
export { tintForCell } from "@/sim/lighting";
export type { LightingResult } from "@/sim/lighting";
