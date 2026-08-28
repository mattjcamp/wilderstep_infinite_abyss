#!/usr/bin/env python3
"""Restore slideSprite, which my helper-removal range over-reached and
deleted along with the now-shared stepBaseScale / clearStepAnim."""
import io, os

WR = os.path.expanduser(
    "~/mnt/wilderstep_infinite_abyss/web/src/sim/scene/WorldRenderer.ts"
)
src = io.open(WR, encoding="utf-8").read()

assert "slideSprite" not in src, "slideSprite already present"

old = '''    onTween?.(tween);
  }

  /** True while the party sprite is still catching up to its cell.'''

new = '''    onTween?.(tween);
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

  /** True while the party sprite is still catching up to its cell.'''

assert src.count(old) == 1
io.open(WR, "w", encoding="utf-8").write(src.replace(old, new))
print("restored slideSprite")
