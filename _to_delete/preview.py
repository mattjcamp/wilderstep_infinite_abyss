#!/usr/bin/env python3
"""Render the step animation to a GIF, using the real sprites, so the
numbers can be judged before running the game.

Mirrors WorldRenderer.slideTo exactly: linear x/y interpolation over
MOVE_MS, bob = -sin(p*pi)*BOB_PX, scaleY = 1 + arc*SQUASH,
scaleX = 1 - arc*SQUASH*0.5, flipX set once per step from direction.
Top strip is the animation; bottom strip is a plain slide, same speed,
for comparison.
"""
import math, os
from PIL import Image

SPR = os.path.expanduser("~/mnt/wilderstep_infinite_abyss/web/public/sprites")
OUT = os.path.expanduser("~/mnt/wilderstep_infinite_abyss/_to_delete")

TILE = 32
MOVE_MS = 140
BOB_PX = 2
SQUASH = 0.08
FPS = 60
ZOOM = 6

COLS, ROWS = 7, 2
CHAR = "person/barbarian_fighter.png"
GROUND = "map/grass1.png"

char = Image.open(os.path.join(SPR, CHAR)).convert("RGBA")
ground = Image.open(os.path.join(SPR, GROUND)).convert("RGBA")
if ground.size != (TILE, TILE):
    ground = ground.resize((TILE, TILE), Image.NEAREST)
if char.size != (TILE, TILE):
    char = char.resize((TILE, TILE), Image.NEAREST)

W, H = COLS * TILE, ROWS * TILE
bg = Image.new("RGBA", (W, H), (12, 12, 20, 255))
for r in range(ROWS):
    for c in range(COLS):
        bg.paste(ground, (c * TILE, r * TILE))


def draw_char(canvas, cx, cy, scale_x=1.0, scale_y=1.0, flip=False):
    """Place the sprite centred on (cx, cy) in canvas pixels."""
    im = char.transpose(Image.FLIP_LEFT_RIGHT) if flip else char
    w = max(1, int(round(TILE * scale_x)))
    h = max(1, int(round(TILE * scale_y)))
    if (w, h) != (TILE, TILE):
        im = im.resize((w, h), Image.NEAREST)
    canvas.alpha_composite(im, (int(round(cx - w / 2)), int(round(cy - h / 2))))


# Walk east across the row, then back west, so the flip is visible.
path = [(c, 0) for c in range(COLS)] + [(c, 0) for c in range(COLS - 2, -1, -1)]
steps = list(zip(path, path[1:]))

frames_per_step = max(2, round(MOVE_MS / 1000 * FPS))
frames = []
flip = False

for (c0, r0), (c1, r1) in steps:
    if c1 != c0:
        flip = c1 < c0
    for i in range(frames_per_step):
        p = (i + 1) / frames_per_step
        arc = math.sin(p * math.pi)

        fx0, fy0 = c0 * TILE + TILE / 2, r0 * TILE + TILE / 2
        fx1, fy1 = c1 * TILE + TILE / 2, r1 * TILE + TILE / 2
        x = fx0 + (fx1 - fx0) * p
        y = fy0 + (fy1 - fy0) * p

        canvas = bg.copy()
        # Top row — with the step animation.
        draw_char(
            canvas,
            x,
            y - arc * BOB_PX,
            scale_x=1 - arc * SQUASH * 0.5,
            scale_y=1 + arc * SQUASH,
            flip=flip,
        )
        # Bottom row — plain slide, no dressing.
        draw_char(canvas, x, y + TILE)

        frames.append(
            canvas.convert("RGB").resize((W * ZOOM, H * ZOOM), Image.NEAREST)
        )

os.makedirs(OUT, exist_ok=True)
dest = os.path.join(OUT, "step_anim_preview.gif")
frames[0].save(
    dest,
    save_all=True,
    append_images=frames[1:],
    duration=round(1000 / FPS),
    loop=0,
    optimize=False,
)
print("wrote %s (%d frames)" % (dest, len(frames)))
