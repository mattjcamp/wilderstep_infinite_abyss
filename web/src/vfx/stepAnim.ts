/**
 * stepAnim — the procedural "step" a sprite performs while it slides
 * from one grid cell to the next. Pure maths plus property writes; no
 * Phaser import, no scene, no tween.
 *
 * Why this is its own module: the art in this project is one static
 * pose per character. No walk frames exist, and drawing them for 337
 * sprites is not a weekend. Instead a sprite in motion rises and
 * settles once per tile, squashes as it lands, and turns to face the
 * way it is going — which buys most of the read of a walk cycle
 * without a single new pixel.
 *
 * TWO renderers need that behaviour and they share no other code: the
 * overworld's WorldRenderer, and the battle screen's CombatScene. They
 * deliberately keep DIFFERENT tempos — the overworld walks at
 * DEFAULT_MOVE_TWEEN_MS, combat steps faster because a turn you are
 * waiting on should feel decisive — but the shape of the step is the
 * same in both. Splitting tempo (each caller's own) from dressing
 * (here) is what stops the two drifting apart, which is exactly how
 * the party ended up gliding while the townsfolk teleported.
 *
 * Callers own their tween. This module hands back a per-frame function
 * and expects `clearStepAnim` on completion.
 */

/** Shape of the step. Every field zeroes independently, so this also
 *  serves as the reduce-motion escape hatch. */
export interface StepAnimConfig {
  /** Peak height in px of the hop arc. 0 disables the bob. */
  bobPx: number;
  /** Peak stretch as a fraction of base scale — 0.08 is an 8% rise on
   *  Y at the apex with half that taken off X, the classic
   *  squash-and-stretch pairing. 0 disables. */
  squashFactor: number;
  /** Mirror the sprite horizontally to face the direction of travel.
   *  Only touched on horizontal moves, so facing persists while
   *  walking north or south. Silently skipped for targets that cannot
   *  flip (the battle screen's selection ring is a Rectangle). */
  flipToFaceTravel: boolean;
  /** Degrees of lean into the direction of travel.
   *
   *  Defaults to 0 deliberately. Both scenes render with `pixelArt:
   *  true` (nearest-neighbour), and rotating a 32px sprite by a few
   *  degrees shears its outline into visible stair-stepping. Raise it
   *  if you switch to smoothed textures, or for a specific sprite that
   *  can carry it. */
  leanDegrees: number;
}

/** Tuned for a 32px tile at roughly an eighth of a second per step. */
export const DEFAULT_STEP_ANIM: StepAnimConfig = {
  bobPx: 2,
  squashFactor: 0.08,
  flipToFaceTravel: true,
  leanDegrees: 0,
};

/** Sprite-data key holding the pre-animation scale, captured once per
 *  sprite so the per-frame maths always multiplies a clean base.
 *  Sprites do not all rest at scale 1 — `setDisplaySize` derives scale
 *  from texture size, overworld roamers render at 0.95 of a tile, and
 *  boss-class monsters in combat render at 2. */
export const STEP_BASE_KEY = "__stepBase";
/** Sprite-data key holding the bob offset currently folded into `y`,
 *  so an interrupted step can be unwound exactly. */
export const STEP_BOB_KEY = "__stepBob";

/** The slice of a Phaser game object this module touches. Structural
 *  rather than `Phaser.GameObjects.Image` so the battle screen can pass
 *  a Rectangle body (used for monsters with no sprite art) through the
 *  same path. */
export interface StepTarget {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  setData(key: string, value: unknown): unknown;
  getData(key: string): unknown;
  /** Absent on Shape-derived objects; guarded at the call site. */
  setFlipX?(value: boolean): unknown;
}

interface BaseScale {
  sx: number;
  sy: number;
}

/** Capture (once) and return a target's resting scale. */
function baseScale(target: StepTarget): BaseScale {
  let base = target.getData(STEP_BASE_KEY) as BaseScale | undefined;
  if (!base) {
    base = { sx: target.scaleX, sy: target.scaleY };
    target.setData(STEP_BASE_KEY, base);
  }
  return base;
}

/**
 * Undo the bob, squash and lean, returning the target to its resting
 * presentation.
 *
 * Call this on tween completion AND before starting a replacement step,
 * so a move that interrupts a half-finished one starts from the
 * target's true line rather than from a position 2px up mid-hop — the
 * bob would otherwise bake itself into the sprite's position and
 * accumulate over a long walk.
 *
 * Facing is deliberately NOT reset: which way a character is turned
 * outlives the step that turned them.
 */
export function clearStepAnim(target: StepTarget): void {
  const bob = (target.getData(STEP_BOB_KEY) as number | undefined) ?? 0;
  if (bob) {
    target.y -= bob;
    target.setData(STEP_BOB_KEY, 0);
  }
  const base = target.getData(STEP_BASE_KEY) as BaseScale | undefined;
  if (base) {
    target.scaleX = base.sx;
    target.scaleY = base.sy;
  }
  if (target.rotation) target.rotation = 0;
}

/**
 * Begin a step and return the per-frame update.
 *
 * Sets facing immediately — a turn reads as something taken before the
 * step, not partway across the tile — then returns a function the
 * caller invokes from its tween's `onUpdate` with progress in 0..1.
 *
 * The returned function recomputes `y` from `from`/`to` each frame
 * rather than adding an offset to the target's live position, so the
 * bob cannot compound. It assumes a LINEAR ease, where progress is the
 * interpolant; pass an eased tween and the vertical will lag the
 * horizontal.
 */
export function beginStep(
  target: StepTarget,
  from: { x: number; y: number },
  to: { x: number; y: number },
  cfg: StepAnimConfig,
): (progress: number) => void {
  if (cfg.flipToFaceTravel && to.x !== from.x && target.setFlipX) {
    target.setFlipX(to.x < from.x);
  }
  const base = baseScale(target);
  const lean = (cfg.leanDegrees * Math.PI) / 180;
  const leanSign = to.x === from.x ? 0 : to.x < from.x ? -1 : 1;

  return (progress: number) => {
    // One arc per tile: 0 at both feet-down ends, 1 at the apex. Two
    // arcs per tile reads as a vibration at these durations.
    const arc = Math.sin(progress * Math.PI);
    if (cfg.bobPx) {
      const bob = -arc * cfg.bobPx;
      target.y = from.y + (to.y - from.y) * progress + bob;
      target.setData(STEP_BOB_KEY, bob);
    }
    if (cfg.squashFactor) {
      // Stretched along travel at the apex, squat at the ends.
      target.scaleY = base.sy * (1 + arc * cfg.squashFactor);
      target.scaleX = base.sx * (1 - arc * cfg.squashFactor * 0.5);
    }
    if (lean) target.rotation = lean * leanSign * arc;
  };
}
