#!/usr/bin/env python3
"""Point WorldRenderer at the extracted stepAnim module, then give
CombatScene the same step at its own 110ms tempo."""
import io, os, re

ROOT = os.path.expanduser("~/mnt/wilderstep_infinite_abyss/web")
WR = os.path.join(ROOT, "src/sim/scene/WorldRenderer.ts")
CS = os.path.join(ROOT, "src/battle/scenes/CombatScene.ts")


def patch(path, edits):
    src = io.open(path, encoding="utf-8").read()
    orig = src
    for old, new, label in edits:
        n = src.count(old)
        assert n == 1, "%s: expected 1 match, found %d" % (label, n)
        src = src.replace(old, new)
        print("  ok  %s" % label)
    assert src != orig
    io.open(path, "w", encoding="utf-8").write(src)
    print("wrote %s" % path)


# ── WorldRenderer: delete the local copy, import the shared one ─────
src = io.open(WR, encoding="utf-8").read()

# Drop the inline StepAnimConfig block (interface + default + keys),
# which now lives in @/vfx/stepAnim.
start = src.index('/** Shape of the procedural "step"')
end = src.index("/** A move longer than this many tiles is treated as a teleport")
removed = src[start:end]
assert "STEP_BOB_KEY" in removed and len(removed) < 4000, len(removed)
src = src[:start] + src[end:]

# Re-export so existing importers (and the test file) keep working.
src = src.replace(
    'import { withBasePath } from "@/util/basePath";',
    'import { withBasePath } from "@/util/basePath";\n'
    'import {\n'
    '  beginStep,\n'
    '  clearStepAnim,\n'
    '  DEFAULT_STEP_ANIM,\n'
    '  type StepAnimConfig,\n'
    '} from "@/vfx/stepAnim";\n'
    '\n'
    '// Re-exported so callers configuring the renderer can reach the\n'
    '// step-animation types without a second import path. The battle\n'
    '// screen imports them from @/vfx/stepAnim directly.\n'
    'export { DEFAULT_STEP_ANIM, type StepAnimConfig };',
    1,
)

io.open(WR, "w", encoding="utf-8").write(src)
print("  ok  WorldRenderer imports shared stepAnim")

# Swap the inlined maths for calls into the module.
patch(WR, [
    (
        '''    const anim = this.stepAnim;
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
    const tween = this.scene.tweens.add({''',
        '''    const step = beginStep(
      sprite,
      { x: fromX, y: fromY },
      { x: px, y: py },
      this.stepAnim,
    );
    const tween = this.scene.tweens.add({''',
        "slideTo uses beginStep",
    ),
    (
        '''      onUpdate: (tw: Phaser.Tweens.Tween) => {
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
      },''',
        '''      onUpdate: (tw: Phaser.Tweens.Tween) => step(tw.progress),
      onComplete: () => {
        // Land exactly on the cell centre with every transform undone —
        // a sprite left 1px high or 3% tall would accumulate a visible
        // drift over a long walk.
        clearStepAnim(sprite);
        sprite.setPosition(px, py);
        onTween?.(null);
      },''',
        "slideTo onUpdate delegates",
    ),
])

# Drop the now-unused private helpers.
src = io.open(WR, encoding="utf-8").read()
s = src.index("  /** Capture (once) and return a sprite's resting scale. */")
e = src.index("  /** True while the party sprite is still catching up to its cell.")
dead = src[s:e]
assert "stepBaseScale" in dead and "clearStepAnim" in dead, dead[:200]
src = src[:s] + src[e:]
src = src.replace(
    "    this.clearStepAnim(sprite);\n", "    clearStepAnim(sprite);\n"
)
io.open(WR, "w", encoding="utf-8").write(src)
print("  ok  removed WorldRenderer's local helpers")


# ── CombatScene ─────────────────────────────────────────────────────
patch(CS, [
    (
        'import { resolveProjectileEffect } from "@/vfx/effectRegistry";',
        'import { resolveProjectileEffect } from "@/vfx/effectRegistry";\n'
        'import {\n'
        '  beginStep,\n'
        '  clearStepAnim,\n'
        '  DEFAULT_STEP_ANIM,\n'
        '} from "@/vfx/stepAnim";',
        "CombatScene imports stepAnim",
    ),
    (
        '''const TILE = 32;''',
        '''const TILE = 32;
/** How long a combatant takes to cross one tile, in ms.
 *
 *  Deliberately shorter than the overworld's DEFAULT_MOVE_TWEEN_MS
 *  (140). A step you are waiting your turn on should feel decisive,
 *  where an exploration step should feel like walking. The two scenes
 *  share the SHAPE of the step (@/vfx/stepAnim) but not its tempo —
 *  don't unify these without watching both. */
const COMBAT_STEP_MS = 110;''',
        "COMBAT_STEP_MS constant",
    ),
    (
        '''    void from;
    return new Promise((resolve) => {
      const body = this.bodies.get(actor.id)!;
      const ring = this.selRings.get(actor.id)!;
      this.tweens.add({
        targets: [body, ring],
        x: this.tileX(to.col),
        y: this.tileY(to.row),
        duration: 110,
        onUpdate: () => this.syncMonsterBar(actor.id),
        onComplete: () => {
          this.syncMonsterBar(actor.id);
          resolve();
        },
      });
    });''',
        '''    void from;
    return new Promise((resolve) => {
      const body = this.bodies.get(actor.id)!;
      const ring = this.selRings.get(actor.id)!;
      const toX = this.tileX(to.col);
      const toY = this.tileY(to.row);
      // Unwind any residual step before reading the start position —
      // a combatant interrupted mid-hop would otherwise bake the 2px
      // lift into its resting position.
      clearStepAnim(body);
      // The step dresses the BODY only. The selection ring marks a
      // cell, not a character, so it rides the plain interpolation and
      // stays flat on the tile while the body hops over it. Bodies can
      // be Rectangles (monsters with no sprite art) — beginStep skips
      // the horizontal flip for anything that can't flip.
      const step = beginStep(
        body,
        { x: body.x, y: body.y },
        { x: toX, y: toY },
        DEFAULT_STEP_ANIM,
      );
      this.tweens.add({
        targets: [body, ring],
        x: toX,
        y: toY,
        duration: COMBAT_STEP_MS,
        // Linear: beginStep treats progress as the interpolant, and an
        // eased tween would drift the bob out of phase with the slide.
        ease: "Linear",
        onUpdate: (tw: Phaser.Tweens.Tween) => {
          step(tw.progress);
          // Bars follow the body, so they ride the hop too — which is
          // what you want; a health bar pinned flat while its owner
          // bobs reads as two separate objects.
          this.syncMonsterBar(actor.id);
        },
        onComplete: () => {
          clearStepAnim(body);
          body.setPosition(toX, toY);
          this.syncMonsterBar(actor.id);
          resolve();
        },
      });
    });''',
        "animateMove step animation",
    ),
])
