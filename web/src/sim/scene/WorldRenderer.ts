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
  DEFAULT_SIGHT_RADIUS,
  emitterVisibleAt,
  overlayVisibleAt,
  REMEMBERED_ALPHA,
  tintForCell,
  type LightingResult,
  type LightingMode,
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
  /** Optional background sprite drawn under `sprite` (purely visual). */
  background_sprite?: string;
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

/** Default duration, in milliseconds, of the slide a sprite plays when
 *  it moves from one cell to the next. The simulation kernel is
 *  unchanged and still commits every move instantly — this only
 *  controls how long the *sprite* takes to catch up to the cell the
 *  party already occupies. 140ms is roughly one step at a brisk walk;
 *  below ~90ms the motion stops reading as movement and starts reading
 *  as a smeared snap, above ~200ms input starts feeling laggy.
 *
 *  Set `moveTweenMs: 0` in the renderer config to restore the old
 *  instant-snap behaviour. */
export const DEFAULT_MOVE_TWEEN_MS = 140;

/** A move longer than this many tiles is treated as a teleport (map
 *  link, staircase, boat board, quest warp) and snaps instead of
 *  sliding — otherwise the party would visibly glide across the whole
 *  map when they take a staircase. Cardinal steps are always 1 tile,
 *  so anything above this is by definition not a walk. */
const TELEPORT_SNAP_TILES = 1.5;

/** Depth for the optional per-cell background sprite — below the base
 *  tile (default depth 0) so a transparent foreground reveals it. */
const BACKGROUND_CELL_DEPTH = -10;

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
  /** How long, in ms, the party / roamer sprites take to slide between
   *  cells. Defaults to {@link DEFAULT_MOVE_TWEEN_MS}. Pass 0 for the
   *  original instant snap — useful for the editor's paint mode, for
   *  headless tests, and as an accessibility escape hatch for players
   *  who don't want interpolated motion. */
  moveTweenMs?: number;
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
  /** Per-lighting-mode exploration sight radius — how far from the
   *  party the fog-of-war memory grows each relight (see
   *  `LightingInputs.sightRadius`). Partial: any mode omitted falls
   *  back to {@link DEFAULT_SIGHT_RADIUS}. Hosts thread the module's
   *  `settings.sight_radius` here so a campaign can widen / tighten
   *  exploration reveal globally. The party's emitted light range is
   *  folded in at relight time (`max(modeRadius, partyLight.range)`)
   *  so a torch always reveals at least its own pool regardless of
   *  the mode floor. */
  sightRadiusByMode?: Partial<Record<LightingMode, number>>;
  /** Whether fog-of-war applies on this surface. Defaults to `true`.
   *  When `false` the renderer never grows or paints the remembered /
   *  unexplored bands (and the cloud-cover layer stays hidden) — the
   *  whole map renders at its current lighting with no exploration
   *  gating. Authors flip this off per-map (e.g. shop interiors)
   *  via the Map Properties dialog so a small, already-"known" space
   *  isn't needlessly clouded. Lighting (day/twilight/night, torches,
   *  infravision) is unaffected — only the fog bands switch off. */
  fogEnabled?: boolean;
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
/** Key for the procedurally-generated cloud-cover texture drawn over
 *  unexplored cells in day / twilight (see `relight`). One shared
 *  texture, instanced per cell. */
const CLOUD_TEX = "__cloud_cover";
/** Depth for the cloud-cover layer. Sits ABOVE every terrain + overlay
 *  band (base cells 0, quest glow 60, detected traps 95, emitters 160,
 *  roamer / placed-encounter sprites 250) so undiscovered ground hides
 *  whatever stands on it, but BELOW the party sprite (300) — the party
 *  is always on an explored cell, so they never get clouded. */
const CLOUD_CELL_DEPTH = 280;

export class WorldRenderer {
  readonly scene: Phaser.Scene;
  /** Captured grid reference. Callers can mutate cells in-place; the
   *  next relight reads the latest shape. */
  grid: RenderGrid;
  partyAvatar: string;

  /** Per-cell base sprite, keyed `"col,row"`. */
  readonly cells = new Map<string, Phaser.GameObjects.Image>();
  /** Per-cell OPTIONAL background sprite, keyed `"col,row"`, drawn at
   *  a depth below the base cell (so a transparent foreground reveals
   *  it). Only present for cells whose `background_sprite` is set.
   *  Tinted by the relight pass exactly like the base cell. */
  readonly backgroundCells = new Map<string, Phaser.GameObjects.Image>();
  /** Per-cell original texture key, captured at create time so the
   *  relight pass can swap between original and grayscale textures
   *  without re-reading the grid cell. */
  private readonly cellTextureKeys = new Map<string, string>();
  /** Maps an original texture key to its grayscale-rendered variant
   *  key. Lazily populated by `ensureGrayscaleTexture` — the first
   *  time a given tile sprite appears in `createCells`, we render
   *  it through a canvas `filter: "grayscale(100%)"` and register
   *  the result under `${origKey}_gray`. Subsequent cells using the
   *  same tile share the cached variant.
   *
   *  Why texture swap instead of postFX: Phaser 4's per-sprite FX
   *  pipeline didn't apply at runtime for the bulk cell-tinting
   *  pass; remembered cells kept their hue. Texture replacement is
   *  unconditional, works in both WebGL and Canvas, and costs zero
   *  per-frame — relight just calls `setTexture(grayKey)` vs
   *  `setTexture(origKey)`. */
  private readonly grayTextureCache = new Map<string, string>();
  /** Per-cell cloud-cover sprite, keyed `"col,row"`. Lazily created
   *  the first time a cell goes unexplored-in-daylight and reused
   *  after (toggled visible/invisible each relight) so scouting a
   *  region and walking back doesn't thrash sprite allocation. A cell
   *  that never goes unexplored-in-daylight never allocates one. */
  private readonly cloudCells = new Map<string, Phaser.GameObjects.Image>();
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
  /** Transient per-cell pixel offsets applied to the quest halo,
   *  keyed by the DESTINATION cell key.
   *
   *  The halo is immediate-mode Graphics rebuilt from a set of cell
   *  keys, not a sprite, so unlike every other moving thing on the
   *  map there is nothing for a tween to target. When a quest giver
   *  wanders, its cell key changes and the disc would otherwise jump
   *  to the new cell a frame before the NPC sprite finishes walking
   *  there. So instead we draw the halo at its new cell plus an
   *  offset that starts at the OLD cell's delta and is tweened to
   *  zero on the same clock as the sprite — the two arrive together.
   *
   *  Entries are deleted when their tween completes, so the map is
   *  empty whenever nothing is mid-step. */
  private readonly questGlowOffsets = new Map<
    string,
    { dx: number; dy: number }
  >();

  /** Lazily-created Phaser Graphics layer the halo is drawn into.
   *  Single graphics object cleared + redrawn per relight — cheap,
   *  since the typical glow-cell set has a handful of entries. */
  private questGlowGraphics: Phaser.GameObjects.Graphics | null = null;

  /** The single party sprite. Null before `setPartyAt` fires. */
  partySprite: Phaser.GameObjects.Image | null = null;
  /** Duration of the inter-cell slide in ms; 0 snaps. Read from
   *  config at construction, mutable afterwards so a host can expose
   *  a "reduce motion" toggle without rebuilding the renderer. */
  moveTweenMs: number = DEFAULT_MOVE_TWEEN_MS;
  /** The in-flight party slide, or null when the sprite is at rest on
   *  its cell. Held (rather than asking Phaser via `isPlaying()`) so
   *  `isPartyMoving` stays correct across Phaser versions and so the
   *  kill-then-restart path can clear it deterministically —
   *  `killTweensOf` does not fire `onComplete`. */
  private partyMoveTween: Phaser.Tweens.Tween | null = null;
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

  /** Per-mode exploration sight-radius overrides (module-driven). Any
   *  mode absent here falls back to {@link DEFAULT_SIGHT_RADIUS}. The
   *  relight pass folds the party's emitted light range in on top, so
   *  this is a floor, not a cap. */
  sightRadiusByMode: Partial<Record<LightingMode, number>> = {};

  /** Whether fog-of-war applies on this surface (default true). When
   *  false the relight pass passes `rememberedCells: null` to the
   *  lighting helper, so no cell is ever flagged remembered or
   *  unexplored, the visited set never grows, and the cloud-cover
   *  layer stays hidden. Per-map authored via the Map Properties
   *  dialog — e.g. a shop interior turns it off. */
  fogEnabled = true;

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
    this.sightRadiusByMode = cfg.sightRadiusByMode ?? {};
    this.fogEnabled = cfg.fogEnabled ?? true;
    this.moveTweenMs = cfg.moveTweenMs ?? DEFAULT_MOVE_TWEEN_MS;
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
    // Cloud-cover tile — a soft greyish-white puff that fully covers
    // one cell's footprint. Built from a stack of overlapping
    // translucent circles so the silhouette reads as a billow rather
    // than a flat square; the per-instance `setAlpha` in relight makes
    // it semi-transparent so a hint of the (unknown) terrain colour
    // bleeds through, while neighbouring cloud tiles overlap into a
    // continuous cover. Drawn at TILE_SIZE so one texture maps 1:1 to
    // a cell.
    if (!this.scene.textures.exists(CLOUD_TEX)) {
      const g = this.scene.add.graphics();
      const s = TILE_SIZE;
      // Base fill — covers the whole cell so there are no transparent
      // gaps at the corners when tiles sit edge-to-edge.
      g.fillStyle(0xc8ccd4, 1);
      g.fillRect(0, 0, s, s);
      // Lighter billows on top for a cloudy texture. Hand-placed puffs
      // (centre + four quadrants) at varying radius read as cloud
      // rather than a flat tile while staying tileable at the seams.
      g.fillStyle(0xe8ebf0, 1);
      const puffs: Array<[number, number, number]> = [
        [s * 0.5, s * 0.5, s * 0.42],
        [s * 0.28, s * 0.34, s * 0.3],
        [s * 0.72, s * 0.32, s * 0.3],
        [s * 0.32, s * 0.72, s * 0.3],
        [s * 0.7, s * 0.7, s * 0.32],
      ];
      for (const [cx, cy, rad] of puffs) g.fillCircle(cx, cy, rad);
      g.generateTexture(CLOUD_TEX, s, s);
      g.destroy();
    }
  }

  /** First-time render of every cell. Skips cells whose `sprite` is
   *  empty or whose texture hasn't loaded — the scene's preload step
   *  is responsible for queuing every needed sprite. Also pre-builds
   *  a grayscale variant of each unique tile texture (cached across
   *  cells using the same sprite) so the relight pass can swap
   *  textures cheaply when a cell enters the remembered band. */
  createCells(): void {
    for (let r = 0; r < this.grid.length; r++) {
      const row = this.grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        // Optional background sprite — drawn UNDER the base tile
        // (depth -10) so a transparent foreground reveals it. Created
        // independently of the foreground so a cell can have just a
        // background, just a foreground, or both.
        const bgTex = cell?.background_sprite;
        if (bgTex && this.scene.textures.exists(bgTex)) {
          const bgImg = this.scene.add
            .image(c * TILE_SIZE, r * TILE_SIZE, bgTex)
            .setOrigin(0)
            .setDisplaySize(TILE_SIZE, TILE_SIZE)
            .setDepth(BACKGROUND_CELL_DEPTH);
          this.backgroundCells.set(`${c},${r}`, bgImg);
        }
        const tex = cell?.sprite;
        if (!tex || !this.scene.textures.exists(tex)) continue;
        const img = this.scene.add
          .image(c * TILE_SIZE, r * TILE_SIZE, tex)
          .setOrigin(0)
          .setDisplaySize(TILE_SIZE, TILE_SIZE);
        this.cells.set(`${c},${r}`, img);
        this.cellTextureKeys.set(`${c},${r}`, tex);
        // Eagerly build the gray variant the first time a given
        // texture appears. Doing it here (vs. lazily in relight)
        // amortises the cost into the initial scene-mount frame
        // rather than spreading hitches across early gameplay as
        // the party first walks past each tile type.
        this.ensureGrayscaleTexture(tex);
      }
    }
  }

  /** Render a grayscale variant of `texKey` to a new Phaser
   *  texture and return the new key. Cached — subsequent calls
   *  for the same texture return the same key without re-rendering.
   *  Uses 2D canvas's built-in `filter: "grayscale(100%)"`, which
   *  is the WHATWG-spec luminance formula (0.2126·R + 0.7152·G +
   *  0.0722·B) applied per pixel. Works in both WebGL and Canvas
   *  rendering modes since the output is just another texture. */
  private ensureGrayscaleTexture(texKey: string): string | null {
    const cached = this.grayTextureCache.get(texKey);
    if (cached) return cached;
    const grayKey = `${texKey}__gray`;
    if (this.scene.textures.exists(grayKey)) {
      this.grayTextureCache.set(texKey, grayKey);
      return grayKey;
    }
    const source = this.scene.textures
      .get(texKey)
      .getSourceImage() as
      | HTMLImageElement
      | HTMLCanvasElement
      | undefined;
    if (!source) return null;
    const w =
      (source as HTMLImageElement).naturalWidth || source.width || 32;
    const h =
      (source as HTMLImageElement).naturalHeight || source.height || 32;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // The CSS `grayscale` filter is supported in every browser the
    // app targets. Pixel art keeps sharp edges since we don't
    // resample.
    ctx.filter = "grayscale(100%)";
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    this.scene.textures.addCanvas(grayKey, canvas);
    this.grayTextureCache.set(texKey, grayKey);
    return grayKey;
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
      this.slideTo(this.partySprite, px, py, (t) => {
        this.partyMoveTween = t;
      });
    }
  }

  /** Move `sprite` to (px, py) — sliding when the distance reads as a
   *  single walking step and the slide is enabled, snapping otherwise.
   *
   *  Shared by the party sprite and the roamer / placed-encounter
   *  layers so every moving thing on the map obeys the same duration,
   *  easing, and teleport rule.
   *
   *  Easing is deliberately linear. An ease-in-out slide reads as a
   *  hovering object being nudged; constant velocity reads as a
   *  character walking, which is what a tile step is.
   *
   *  `onTween` receives the started tween (or null when the move
   *  snapped) so a caller that needs to know whether motion is in
   *  flight can track it. Any prior tween on the sprite is killed
   *  first, so a move arriving mid-slide retargets cleanly rather
   *  than compounding into a diagonal drift. */
  private slideTo(
    sprite: Phaser.GameObjects.Image,
    px: number,
    py: number,
    onTween?: (tween: Phaser.Tweens.Tween | null) => void,
  ): void {
    this.scene.tweens.killTweensOf(sprite);
    const far =
      Math.abs(sprite.x - px) > TILE_SIZE * TELEPORT_SNAP_TILES ||
      Math.abs(sprite.y - py) > TILE_SIZE * TELEPORT_SNAP_TILES;
    if (this.moveTweenMs <= 0 || far) {
      sprite.setPosition(px, py);
      onTween?.(null);
      return;
    }
    const tween = this.scene.tweens.add({
      targets: sprite,
      x: px,
      y: py,
      duration: this.moveTweenMs,
      ease: "Linear",
      onComplete: () => onTween?.(null),
    });
    onTween?.(tween);
  }

  /** Slide an arbitrary caller-owned sprite to the centre of
   *  (col, row), using the same duration, easing and teleport rule as
   *  the party and roamer layers.
   *
   *  Exists for overlay sprites the renderer does not own. NPCs and
   *  quest givers are the case in point: the kernel moves them by
   *  swapping an `npc` / `quest` *tag* between grid cells rather than
   *  by handing us a positions list, so their Images live in the
   *  host's own per-cell maps and never pass through `diffSprites`.
   *  Routing them here keeps one definition of what a step looks
   *  like — otherwise the timing rule gets copied into the host and
   *  the two drift, which is exactly how the party ended up gliding
   *  while the townsfolk teleported.
   *
   *  The host stays responsible for re-keying its own map; this only
   *  moves the pixels. */
  slideSprite(
    sprite: Phaser.GameObjects.Image,
    col: number,
    row: number,
  ): void {
    this.slideTo(
      sprite,
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2,
    );
  }

  /** True while the party sprite is still catching up to its cell.
   *
   *  Hosts gate movement input on this: the kernel accepts steps as
   *  fast as they arrive, and a held arrow key fires at the OS
   *  auto-repeat rate (~30/sec), which would queue moves far faster
   *  than a 140ms slide can play them and leave the sprite visibly
   *  trailing the party's real position. */
  isPartyMoving(): boolean {
    return this.partyMoveTween !== null;
  }

  /** End any in-flight slide immediately, planting the sprite on its
   *  current cell. For transitions that must not be caught mid-step —
   *  entering a battle, changing maps, opening a modal that freezes
   *  the world. */
  snapPartyToTarget(): void {
    if (this.partySprite) {
      this.scene.tweens.killTweensOf(this.partySprite);
      if (this.hasParty) {
        this.partySprite.setPosition(
          this.partyCol * TILE_SIZE + TILE_SIZE / 2,
          this.partyRow * TILE_SIZE + TILE_SIZE / 2,
        );
      }
    }
    this.partyMoveTween = null;
  }

  /** Drop the party sprite — used when sim mode toggles off. Also
   *  clears `hasParty` so the next `relight()` falls back to
   *  paint-mode behaviour (no LOS gate, emitters all visible). */
  clearParty(): void {
    if (this.partySprite) {
      // Kill first: destroying a sprite that is still a live tween
      // target leaves the tween mutating a dead game object.
      this.scene.tweens.killTweensOf(this.partySprite);
      this.partySprite.destroy();
      this.partySprite = null;
    }
    this.partyMoveTween = null;
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

  /** Swap a single cell's *live* texture. Used today by:
   *
   *   1. The destroy-lair path — defeated Monster Spawn → grass.
   *   2. The boat-position bridge — boat boards → water tile beneath
   *      the cell; boat disembarks → boat tile under the now-empty
   *      water cell. (PlayHost wraps this in its setBoatPositions
   *      diff.)
   *
   *  Critically, this updates `cellTextureKeys` alongside the live
   *  image. The relight pass treats `cellTextureKeys[key]` as the
   *  *current* base sprite and chooses between it and its grayscale
   *  variant each frame; if we only swapped the image without
   *  updating the map, the next relight would revert the cell to its
   *  authored sprite (a boarded boat cell would re-paint its boat,
   *  a destroyed lair would re-paint its lair). We also eagerly bake
   *  the grayscale variant of the new sprite so cells that later
   *  fall into remembered-fog still grayscale correctly.
   *
   *  Idempotent — guards against missing textures and unknown cell
   *  keys. Skips the texture-swap call when the live image already
   *  matches the requested sprite. */
  setCellSprite(col: number, row: number, sprite: string): void {
    const key = `${col},${row}`;
    const img = this.cells.get(key);
    if (!img) return;
    if (!this.scene.textures.exists(sprite)) return;
    if (img.texture.key !== sprite) img.setTexture(sprite);
    this.cellTextureKeys.set(key, sprite);
    this.ensureGrayscaleTexture(sprite);
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
      // Mid-step offset, if this cell's giver is still walking in.
      // Absent (the common case) reads as zero.
      const off = this.questGlowOffsets.get(key);
      const cx = cs * TILE_SIZE + TILE_SIZE / 2 + (off?.dx ?? 0);
      const cy = rs * TILE_SIZE + TILE_SIZE / 2 + (off?.dy ?? 0);
      // Slightly wider than the cell so the halo bleeds past sprite
      // edges. Matches the editor.
      g.fillCircle(cx, cy, TILE_SIZE * radiusFactor);
    }
  }

  /** Walk the quest halo from one cell to another instead of letting
   *  it jump when the giver's cell key changes.
   *
   *  Call this alongside {@link slideSprite} for a quest giver, BEFORE
   *  pushing the recomputed glow-cell set, so the first repaint
   *  already carries the offset and the halo never paints a frame at
   *  the destination.
   *
   *  Repaints on every tween frame. That is affordable precisely
   *  because the halo set is tiny — a handful of discs — and only
   *  while a giver is actually mid-step; the map is empty the rest of
   *  the time. A move that exceeds the teleport threshold snaps, so
   *  this agrees with the sprite it is chasing. */
  slideQuestGlow(
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): void {
    const key = `${to.col},${to.row}`;
    const dx = (from.col - to.col) * TILE_SIZE;
    const dy = (from.row - to.row) * TILE_SIZE;
    const far =
      Math.abs(dx) > TILE_SIZE * TELEPORT_SNAP_TILES ||
      Math.abs(dy) > TILE_SIZE * TELEPORT_SNAP_TILES;
    if (this.moveTweenMs <= 0 || far || (dx === 0 && dy === 0)) {
      this.questGlowOffsets.delete(key);
      return;
    }
    const offset = { dx, dy };
    this.questGlowOffsets.set(key, offset);
    this.scene.tweens.add({
      targets: offset,
      dx: 0,
      dy: 0,
      duration: this.moveTweenMs,
      ease: "Linear",
      onUpdate: () => this.repaintQuestGlow(),
      onComplete: () => {
        this.questGlowOffsets.delete(key);
        this.repaintQuestGlow();
      },
    });
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

  /** Toggle fog-of-war for the current surface + relight. Hosts
   *  normally set this once via the config at construction (from the
   *  map's `fog_of_war` flag); this setter exists for parity with
   *  `setLightingMode` and for any live toggle (e.g. an editor preview
   *  switch). No-ops when unchanged. */
  setFogEnabled(enabled: boolean): void {
    if (this.fogEnabled === enabled) return;
    this.fogEnabled = enabled;
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
      // seen" anything) AND when fog is enabled for this map. A map
      // with `fogEnabled === false` (e.g. a shop) passes null so the
      // helper never flags remembered / unexplored cells — the whole
      // map renders at its lighting with no exploration gating and no
      // cloud cover. Skipping the set when `hasParty` is false keeps
      // the editor's idle painting view rendering as before.
      rememberedCells:
        this.hasParty && this.fogEnabled ? this.visitedCells : null,
      // Exploration reveal radius for the fog-of-war memory. Take the
      // larger of the module-configured (or default) per-mode radius
      // and the party's emitted light range, so a torch / Magic Light
      // in a dark dungeon always maps at least its own pool while a
      // sunlit overworld maps the wide daylight circle. Only
      // meaningful with a party on the map; the helper ignores it when
      // `party` is null.
      sightRadius: this.hasParty
        ? Math.max(
            this.sightRadiusByMode[this.lightingMode] ??
              DEFAULT_SIGHT_RADIUS[this.lightingMode],
            this.partyLight && this.partyLight.range > 0
              ? this.partyLight.range
              : 0,
          )
        : null,
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
    // Cells. Remembered ("fog-of-war") cells get TWO compounding
    // tweaks on top of the lighting tint:
    //
    //   1. A grayscale texture swap — `setTexture(grayKey)` switches
    //      the sprite to the pre-rendered desaturated variant of
    //      its tile texture. True per-pixel grayscale via the canvas
    //      `filter: "grayscale(100%)"` we ran at create time, so a
    //      vivid-green grass tile reads as gray of the same
    //      luminance, water as a distinct (darker) gray, etc.
    //      Tile-type distinction is preserved through luminance
    //      variation even though hue is gone.
    //
    //   2. A fractional alpha — fades the gray sprite so it reads
    //      as "background" relative to currently-lit terrain.
    //
    // Why texture swap instead of postFX: a previous pass tried
    // `image.postFX.addColorMatrix().grayscale(1)` lazily per cell.
    // The Phaser 4 FX pipeline didn't apply at runtime for this
    // bulk per-cell path; cells kept their hue. Swapping textures
    // is unconditional, costs zero per frame after the create-time
    // bake, and avoids the FX framebuffer overhead entirely.
    //
    // In-LOS cells reset alpha to 1.0 + restore the original
    // texture every frame so a cell that re-enters the party's
    // vision pool snaps back to full opacity + full colour rather
    // than carrying a stale fade from a previous-frame "remembered"
    // state.
    for (const [key, img] of this.cells) {
      const [cs, rs] = key.split(",");
      const c = Number(cs);
      const r = Number(rs);
      const t = tintForCell(result, c, r);
      if (t.mode === "clear") img.clearTint();
      else img.setTint(t.value);
      const info = result.cells.get(`${c},${r}`);
      const remembered = info?.isRemembered ?? false;
      img.setAlpha(remembered ? REMEMBERED_ALPHA : 1);
      const origKey = this.cellTextureKeys.get(key);
      if (!origKey) continue;
      const grayKey = this.grayTextureCache.get(origKey);
      const desiredKey = remembered && grayKey ? grayKey : origKey;
      if (img.texture.key !== desiredKey) {
        img.setTexture(desiredKey);
      }
    }
    // Unexplored-cover layer — drape never-seen cells so the player
    // can't read terrain the party hasn't scouted. This covers EVERY
    // lighting mode, not just daylight: at night an unexplored cell
    // otherwise falls to the ambient floor (~grey 25), which is dim
    // but still leaks the tile's silhouette against the dark canvas —
    // the "we can still see clouded areas in grey at night" report.
    // The same cell that gets a white cloud at noon gets a near-black
    // cover at night, so it reads as solid void and stays clearly
    // distinct from the lighter grey REMEMBERED band (terrain the
    // party HAS seen).
    //
    // We tint the one shared cloud texture per mode rather than
    // swapping textures. The cover is fully OPAQUE in every mode — the
    // party hasn't seen this ground, so nothing of the terrain should
    // bleed through. Only the colour changes by time of day:
    //   - day      → bright cloud-white.
    //   - twilight → dusk-dimmed cloud.
    //   - night    → near-black void.
    //
    // (The cloud texture itself has fully-opaque pixels across the
    // whole cell footprint, so setAlpha(1) leaves no gaps.)
    //
    // `isUnexplored` is only ever set when fog is active and the party
    // is on the map (see lighting.ts), so paint-mode / no-party frames
    // naturally show no cover without a special case here. Sprites are
    // created lazily and then just toggled, so a fully-explored map
    // carries none and a re-covered cell reuses its instance.
    const coverTint =
      this.lightingMode === "night"
        ? 0x05070b // near-black void
        : this.lightingMode === "twilight"
          ? 0x6b7280 // dusk-dimmed cloud
          : 0xffffff; // daylight cloud (texture's own colour)
    const coverAlpha = 1;
    for (const key of this.cells.keys()) {
      const info = result.cells.get(key);
      const covered = info?.isUnexplored ?? false;
      let cloud = this.cloudCells.get(key);
      if (covered && !cloud) {
        // Lazy-create on first need. Anchor + size match the base
        // cell (origin 0, TILE_SIZE square) so the cover lines up.
        const [cs, rs] = key.split(",");
        const c = Number(cs);
        const r = Number(rs);
        cloud = this.scene.add
          .image(c * TILE_SIZE, r * TILE_SIZE, CLOUD_TEX)
          .setOrigin(0)
          .setDisplaySize(TILE_SIZE, TILE_SIZE)
          .setDepth(CLOUD_CELL_DEPTH);
        this.cloudCells.set(key, cloud);
      }
      if (cloud) {
        cloud.setVisible(covered);
        if (covered) {
          cloud.setAlpha(coverAlpha);
          if (coverTint === 0xffffff) cloud.clearTint();
          else cloud.setTint(coverTint);
        }
      }
    }
    // Background cells — tint + fade them exactly like the base tile
    // so the layer behind a transparent foreground lights the same.
    // (No grayscale-texture swap for the remembered band here; the
    // alpha fade is enough to read background terrain as "remembered"
    // without doubling the gray-texture cache.)
    for (const [key, bgImg] of this.backgroundCells) {
      const [cs, rs] = key.split(",");
      const c = Number(cs);
      const r = Number(rs);
      const t = tintForCell(result, c, r);
      if (t.mode === "clear") bgImg.clearTint();
      else bgImg.setTint(t.value);
      const info = result.cells.get(`${c},${r}`);
      bgImg.setAlpha(info?.isRemembered ? REMEMBERED_ALPHA : 1);
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
      // Same ordering rule as clearParty — cancel before destroy.
      this.scene.tweens.killTweensOf(img);
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
        // Roamers glide on the same clock as the party. A roamer that
        // respawns or is re-placed elsewhere exceeds the teleport
        // threshold inside slideTo and snaps instead.
        this.slideTo(img, px, py);
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
