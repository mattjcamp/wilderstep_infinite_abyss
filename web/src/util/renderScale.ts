/**
 * Render scale — how many real canvas pixels back one logical pixel.
 *
 * All game code (tile pitch, HUD layout, the 960×720 frame) is written
 * in LOGICAL pixels. Each Phaser game allocates a backbuffer that is
 * RENDER_SCALE× larger and each scene's main camera zooms by the same
 * factor (origin pinned top-left), so:
 *
 *   - layout math, scroll math and hit-testing stay in logical units;
 *   - a tile is TILE_SIZE (32) logical px but RENDER_SCALE × 32 = 64
 *     real px on the canvas — a 64×64 sprite draws 1:1 and crisp;
 *   - legacy 32×32 sprites are nearest-neighbour upscaled 2× (still
 *     sharp, just chunkier) so art can be replaced incrementally;
 *   - Text is rasterised at RENDER_SCALE so it stays sharp under zoom.
 *
 * Rule for new code: always give a sprite an explicit display size in
 * logical units (`setDisplaySize(TILE_SIZE, TILE_SIZE)`), never rely
 * on its native texture size.
 */
import type PhaserNS from "phaser";

export const RENDER_SCALE = 2;

/** Logical size of the standard game frame. */
export const LOGICAL_WIDTH = 960;
export const LOGICAL_HEIGHT = 720;

let textPatched = false;

/** Make every Phaser Text default to RENDER_SCALE resolution. Call
 *  once before creating a Phaser.Game (idempotent). Explicit
 *  `resolution` values in a text style are left untouched. */
export function installHiDpiText(Phaser: typeof PhaserNS): void {
  if (textPatched) return;
  textPatched = true;
  const proto = Phaser.GameObjects.TextStyle.prototype as unknown as {
    setStyle: (...args: unknown[]) => unknown;
    resolution: number;
  };
  const orig = proto.setStyle;
  proto.setStyle = function (this: { resolution: number }, ...args: unknown[]) {
    const out = orig.apply(this, args);
    if (!this.resolution) this.resolution = RENDER_SCALE;
    return out;
  };
}

/** Zoom a scene's main camera so logical coordinates map onto the
 *  RENDER_SCALE× backbuffer. Call first thing in `create()`. */
export function applyRenderScale(scene: PhaserNS.Scene): void {
  scene.cameras.main.setOrigin(0, 0).setZoom(RENDER_SCALE);
}

/** Convert a pointer's canvas-space coordinate to logical units
 *  (ignores camera scroll — for screen-fixed UI). */
export function pointerLogical(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x / RENDER_SCALE, y: p.y / RENDER_SCALE };
}

// ── World zoom (physical tile size) ─────────────────────────────────
//
// On top of RENDER_SCALE, the overworld can zoom the WORLD in so tiles
// are physically bigger on screen (fewer tiles in view). The UI — the
// log strip, help screen, quest log; anything with scrollFactor 0 —
// is drawn by a separate "ui" camera that stays at RENDER_SCALE, so
// it keeps its size and position regardless of world zoom.

/** Selectable world-zoom steps. 1 = ~30×22 tiles in view, 1.5 = ~20×15,
 *  2 = ~15×11. Cycled in play with the Z key. */
/** Z-key steps, as multiples of the NATIVE tile size (a 64×64 sprite
 *  shown at 64 CSS px per tile — see {@link nativeWorldZoom}). */
export const WORLD_ZOOM_STEPS = [1, 1.5, 2] as const;

/** Size of one map tile on screen at "native" resolution, in CSS px:
 *  the art is 64×64, so a tile is shown 1:1 with its sprite. */
export const NATIVE_TILE_CSS_PX = 64;

/**
 * World zoom (on top of RENDER_SCALE) that shows a TILE_SIZE-logical
 * tile at {@link NATIVE_TILE_CSS_PX} CSS pixels, given how many CSS
 * pixels the canvas currently spends per backbuffer pixel
 * (`displayScale`; Phaser FIT mode changes this with the window).
 * The camera zoom is rounded so a tile is a whole number of
 * backbuffer pixels, which keeps the pixel art as even as possible.
 */
export function nativeWorldZoom(
  displayScale: number,
  tileSizeLogical: number,
  step = 1,
): number {
  if (!(displayScale > 0)) return step;
  const wantTileBackbufferPx = (NATIVE_TILE_CSS_PX * step) / displayScale;
  const tileBb = Math.max(1, Math.round(wantTileBackbufferPx));
  return tileBb / (tileSizeLogical * RENDER_SCALE);
}
const WORLD_ZOOM_KEY = "wilderstep.worldZoomIdx";

export function loadWorldZoomIdx(): number {
  try {
    const n = Number(window.localStorage.getItem(WORLD_ZOOM_KEY));
    return Number.isInteger(n) && n >= 0 && n < WORLD_ZOOM_STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

export function saveWorldZoomIdx(i: number): void {
  try {
    window.localStorage.setItem(WORLD_ZOOM_KEY, String(i));
  } catch {
    // Best-effort.
  }
}

/** Split a scene into a zoomable world camera (main) and a fixed "ui"
 *  camera. Objects with scrollFactor 0 render only on the ui camera;
 *  everything else only on the world camera. Re-evaluated every frame
 *  (cheap bitmask writes) so objects created later sort themselves. */
export function installWorldAndUiCameras(
  scene: PhaserNS.Scene,
  worldZoom: number,
): { world: PhaserNS.Cameras.Scene2D.Camera; ui: PhaserNS.Cameras.Scene2D.Camera } {
  const world = scene.cameras.main;
  world.setOrigin(0, 0).setZoom(RENDER_SCALE * worldZoom);
  const ui = scene.cameras
    .add(0, 0, scene.scale.width, scene.scale.height, false, "ui")
    .setOrigin(0, 0)
    .setZoom(RENDER_SCALE);
  const worldId = world.id;
  const uiId = ui.id;
  scene.events.on("prerender", () => {
    const list = scene.children.list as Array<{
      scrollFactorX?: number;
      cameraFilter: number;
    }>;
    for (const go of list) {
      go.cameraFilter = go.scrollFactorX === 0 ? worldId : uiId;
    }
  });
  return { world, ui };
}

/** Zoom of the camera that draws screen-fixed UI (the "ui" camera when
 *  present, else main). Use to convert pointer.x/y to logical px. */
export function uiZoomOf(scene: PhaserNS.Scene): number {
  const cams = (scene as { cameras?: PhaserNS.Cameras.Scene2D.CameraManager }).cameras;
  if (!cams) return 1;
  const ui = cams.getCamera?.("ui") ?? cams.main;
  return ui?.zoom || 1;
}

/** Minimal shape of a Phaser Image for {@link swapTexture}. */
interface TextureSwappable {
  displayWidth?: number;
  displayHeight?: number;
  setTexture(key: string): unknown;
  setDisplaySize?(w: number, h: number): unknown;
}

/**
 * Swap an image's texture WITHOUT changing its on-screen size.
 *
 * Phaser's `setTexture` keeps the image's scale, not its display size,
 * so swapping a 32×32 texture for a 64×64 one doubles the drawn size
 * (the tile spills into its neighbours, which then cover it and make
 * it look cropped and zoomed). Every texture swap on a sized sprite
 * goes through here instead.
 */
export function swapTexture<T extends TextureSwappable>(img: T, key: string): T {
  const w = img.displayWidth;
  const h = img.displayHeight;
  img.setTexture(key);
  if (img.setDisplaySize && w && h) img.setDisplaySize(w, h);
  return img;
}
