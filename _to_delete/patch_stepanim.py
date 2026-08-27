#!/usr/bin/env python3
"""Option 1 — procedural step animation on the existing single-pose art."""
import io, os

WR = os.path.expanduser(
    "~/mnt/wilderstep_infinite_abyss/web/src/sim/scene/WorldRenderer.ts"
)

src = io.open(WR, encoding="utf-8").read()
orig = src


def sub(old, new, label):
    global src
    n = src.count(old)
    assert n == 1, "%s: expected 1 match, found %d" % (label, n)
    src = src.replace(old, new)
    print("  ok  %s" % label)


# ── Config type + defaults ──────────────────────────────────────────
sub(
    '''/** A move longer than this many tiles is treated as a teleport''',
    '''/** Shape of the procedural "step" a sprite performs while it slides
 *  between cells.
 *
 *  The art in this project is one static pose per character — no walk
 *  frames exist, and drawing them for 337 sprites is not a weekend.
 *  These four cheap transforms buy most of the read of a walk cycle
 *  without a single new pixel: the sprite rises and settles once per
 *  tile, squashes as it lands, and turns to face the way it is going.
 *
 *  Every field can be zeroed independently, so this doubles as the
 *  reduce-motion escape hatch. */
export interface StepAnimConfig {
  /** Peak height in px of the hop arc. 0 disables the bob. */
  bobPx: number;
  /** Peak stretch as a fraction of base scale — 0.08 is an 8% rise on
   *  Y at the apex with half that taken off X, the classic
   *  squash-and-stretch pairing. 0 disables. */
  squashFactor: number;
  /** Mirror the sprite horizontally to face the direction of travel.
   *  Only touched on horizontal moves, so facing persists while
   *  walking north or south. */
  flipToFaceTravel: boolean;
  /** Degrees of lean into the direction of travel.
   *
   *  Defaults to 0 deliberately. The game renders with `pixelArt:
   *  true` (nearest-neighbour), and rotating a 32px sprite by a few
   *  degrees shears its outline into visible stair-stepping. Raise it
   *  if you switch to smoothed textures, or for a specific sprite
   *  that can carry it. */
  leanDegrees: number;
}

/** Tuned for a 32px tile at {@link DEFAULT_MOVE_TWEEN_MS}. */
export const DEFAULT_STEP_ANIM: StepAnimConfig = {
  bobPx: 2,
  squashFactor: 0.08,
  flipToFaceTravel: true,
  leanDegrees: 0,
};

/** Sprite-data key holding the pre-animation scale, captured once per
 *  sprite so the per-frame maths always multiplies a clean base.
 *  Sprites do not all start at scale 1 — `setDisplaySize` derives it
 *  from texture size, roamers render at 0.95, and a couple of source
 *  PNGs are 54px or 64px rather than 32. */
const STEP_BASE_KEY = "__stepBase";
/** Sprite-data key holding the bob offset currently folded into `y`,
 *  so an interrupted step can be unwound exactly. */
const STEP_BOB_KEY = "__stepBob";

/** A move longer than this many tiles is treated as a teleport''',
    "StepAnimConfig",
)

# ── Renderer config option ──────────────────────────────────────────
sub(
    '''  moveTweenMs?: number;''',
    '''  moveTweenMs?: number;
  /** Overrides for the per-step animation. Merged over
   *  {@link DEFAULT_STEP_ANIM}, so passing `{ bobPx: 0 }` disables just
   *  the hop and leaves squash and facing alone. */
  stepAnim?: Partial<StepAnimConfig>;''',
    "config.stepAnim",
)

# ── Field ───────────────────────────────────────────────────────────
sub(
    '''  moveTweenMs: number = DEFAULT_MOVE_TWEEN_MS;''',
    '''  moveTweenMs: number = DEFAULT_MOVE_TWEEN_MS;
  /** Live step-animation settings. Mutable so a host can wire these to
   *  a settings screen without rebuilding the renderer. */
  stepAnim: StepAnimConfig = { ...DEFAULT_STEP_ANIM };''',
    "stepAnim field",
)

# ── Constructor ─────────────────────────────────────────────────────
sub(
    '''    this.moveTweenMs = cfg.moveTweenMs ?? DEFAULT_MOVE_TWEEN_MS;''',
    '''    this.moveTweenMs = cfg.moveTweenMs ?? DEFAULT_MOVE_TWEEN_MS;
    this.stepAnim = { ...DEFAULT_STEP_ANIM, ...(cfg.stepAnim ?? {}) };''',
    "constructor stepAnim",
)

# ── slideTo body ────────────────────────────────────────────────────
sub(
    '''    this.scene.tweens.killTweensOf(sprite);
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
  }''',
    '''    this.scene.tweens.killTweensOf(sprite);
    // Unwind any half-finished step first, so both the distance test
    // below and the tween's captured start position read the sprite's
    // true cell rather than a position 2px up mid-hop.
    this.clearStepAnim(sprite);
    const fromX = sprite.x;
    const fromY = sprite.y;
    const far =
      Math.abs(fromX - px) > TILE_SIZE * TELEPORT_SNAP_TILES ||
      Math.abs(fromY - py) > TILE_SIZE * TELEPORT_SNAP_TILES;
    if (this.moveTweenMs <= 0 || far) {
      sprite.setPosition(px, py);
      onTween?.(null);
      return;
    }
    const anim = this.stepAnim;
    // Facing is set once, up front — it should read as a turn taken
    // before the step, not something that happens partway across the
    // tile. Left untouched on a vertical move so the character keeps
    // whichever way they were last facing.
    if (anim.flipToFaceTravel && px !== fromX) {
      sprite.setFlipX(px < fromX);
    }
    const base = this.stepBaseScale(sprite);
    const lean = (anim.leanDegrees * Math.PI) / 180;
    const leanSign = px === fromX ? 0 : px < fromX ? -1 : 1;
    const tween = this.scene.tweens.add({
      targets: sprite,
      x: px,
      y: py,
      duration: this.moveTweenMs,
      ease: "Linear",
      onUpdate: (tw: Phaser.Tweens.Tween) => {
        // One arc per tile: 0 at both feet-down ends, 1 at the apex.
        // Two arcs per tile reads as a vibration at this duration.
        const arc = Math.sin(tw.progress * Math.PI);
        if (anim.bobPx) {
          const bob = -arc * anim.bobPx;
          // Recomputed from the endpoints rather than read back off
          // the sprite, so the offset never compounds across frames.
          // Ease is linear, so progress IS the interpolant.
          sprite.y = fromY + (py - fromY) * tw.progress + bob;
          sprite.setData(STEP_BOB_KEY, bob);
        }
        if (anim.squashFactor) {
          // Stretched along travel at the apex, squat at the ends.
          sprite.scaleY = base.sy * (1 + arc * anim.squashFactor);
          sprite.scaleX = base.sx * (1 - arc * anim.squashFactor * 0.5);
        }
        if (lean) sprite.rotation = lean * leanSign * arc;
      },
      onComplete: () => {
        // Land exactly on the cell centre with every transform undone —
        // a sprite left 1px high or 3% tall would accumulate a visible
        // drift over a long walk.
        this.clearStepAnim(sprite);
        sprite.setPosition(px, py);
        onTween?.(null);
      },
    });
    onTween?.(tween);
  }

  /** Capture (once) and return a sprite's resting scale. */
  private stepBaseScale(sprite: Phaser.GameObjects.Image): {
    sx: number;
    sy: number;
  } {
    let base = sprite.getData(STEP_BASE_KEY) as
      | { sx: number; sy: number }
      | undefined;
    if (!base) {
      base = { sx: sprite.scaleX, sy: sprite.scaleY };
      sprite.setData(STEP_BASE_KEY, base);
    }
    return base;
  }

  /** Undo the bob, squash and lean, returning the sprite to its
   *  resting presentation. Facing is deliberately NOT reset — which
   *  way a character is turned outlives the step that turned them. */
  private clearStepAnim(sprite: Phaser.GameObjects.Image): void {
    const bob = (sprite.getData(STEP_BOB_KEY) as number | undefined) ?? 0;
    if (bob) {
      sprite.y -= bob;
      sprite.setData(STEP_BOB_KEY, 0);
    }
    const base = sprite.getData(STEP_BASE_KEY) as
      | { sx: number; sy: number }
      | undefined;
    if (base) {
      sprite.scaleX = base.sx;
      sprite.scaleY = base.sy;
    }
    if (sprite.rotation) sprite.rotation = 0;
  }''',
    "slideTo step animation",
)

assert src != orig
io.open(WR, "w", encoding="utf-8").write(src)
print("wrote %s" % WR)
