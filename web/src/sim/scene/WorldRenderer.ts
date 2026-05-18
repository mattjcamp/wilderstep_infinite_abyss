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
  tintForCell,
  type LightingResult,
} from "@/sim/lighting";
import { ANIMATION_CONFIGS } from "@/sim/tileAnimations";
import type { SimLightSource } from "@/sim/types";

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
  initialLightingMode?: "day" | "night";
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
  lightingMode: "day" | "night" = "night";

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
    if (this.scene.textures.exists(PARTICLE_TEX)) return;
    const g = this.scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture(PARTICLE_TEX, 16, 16);
    g.destroy();
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

  /** Update the player-engaged infravision flag + trigger a relight.
   *  Called by hosts that toggle infravision from React UI; the sim
   *  kernel also routes its own toggle through the bridge to this. */
  setPartyInfravisionActive(active: boolean): void {
    if (this.partyInfravisionActive === active) return;
    this.partyInfravisionActive = active;
    this.relight();
  }

  setLightingMode(mode: "day" | "night"): void {
    if (this.lightingMode === mode) return;
    this.lightingMode = mode;
    this.relight();
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
    });
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
    const tintOverlay = (img: Phaser.GameObjects.Image) => {
      const col = Math.round((img.x - TILE_SIZE / 2) / TILE_SIZE);
      const row = Math.round((img.y - TILE_SIZE / 2) / TILE_SIZE);
      const t = tintForCell(result, col, row);
      if (t.mode === "clear") img.clearTint();
      else img.setTint(t.value);
    };
    for (const img of this.roamerSprites.values()) tintOverlay(img);
    for (const img of this.placedEncounterSprites.values()) tintOverlay(img);
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
        const tex =
          p.sprite && this.scene.textures.exists(p.sprite)
            ? p.sprite
            : PARTY_MARKER_TEX;
        img = this.scene.add
          .image(px, py, tex)
          .setOrigin(0.5)
          .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
          .setDepth(250);
        map.set(id, img);
      } else {
        img.setPosition(px, py);
        if (
          p.sprite &&
          this.scene.textures.exists(p.sprite) &&
          img.texture.key !== p.sprite
        ) {
          img.setTexture(p.sprite);
        }
      }
    }
  }
}

// Re-export so callers can build their custom-overlay tinting against
// the same primitives the renderer uses internally.
export { tintForCell } from "@/sim/lighting";
export type { LightingResult } from "@/sim/lighting";
