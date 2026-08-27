#!/usr/bin/env python3
"""Preview the step animation across all three mover types, using the
real sprites and the exact constants from DEFAULT_STEP_ANIM.

Row 1  party      (slideTo via setPartyAt)
Row 2  monster    (slideTo via diffSprites, rendered at 95% of a tile)
Row 3  NPC        (slideTo via slideSprite)
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
COLS = 7

# (sprite, label scale) — roamers render at 0.95 of a tile, party at 1.
MOVERS = [
    ("person/barbarian_fighter.png", 1.00),
    ("monster/bat_grey.png", 0.95),
    ("person/cleric1.png", 1.00),
]
GROUND = "map/grass1.png"


def load(rel, size=TILE):
    im = Image.open(os.path.join(SPR, rel)).convert("RGBA")
    return im if im.size == (size, size) else im.resize((size, size), Image.NEAREST)


ground = load(GROUND)
sprites = [(load(p), s) for p, s in MOVERS]

ROWS = len(MOVERS)
W, H = COLS * TILE, ROWS * TILE
bg = Image.new("RGBA", (W, H), (12, 12, 20, 255))
for r in range(ROWS):
    for c in range(COLS):
        bg.paste(ground, (c * TILE, r * TILE))


def draw(canvas, im, cx, cy, sx, sy, flip):
    src = im.transpose(Image.FLIP_LEFT_RIGHT) if flip else im
    w = max(1, int(round(TILE * sx)))
    h = max(1, int(round(TILE * sy)))
    if (w, h) != src.size:
        src = src.resize((w, h), Image.NEAREST)
    canvas.alpha_composite(src, (int(round(cx - w / 2)), int(round(cy - h / 2))))


# Each row walks its own path so the three are visibly out of phase —
# which is what the independent per-sprite step state buys you.
paths = [
    [(c, 0) for c in range(COLS)] + [(c, 0) for c in range(COLS - 2, -1, -1)],
    [(c, 1) for c in range(COLS - 1, -1, -1)] + [(c, 1) for c in range(1, COLS)],
    [(c, 2) for c in range(COLS)] + [(c, 2) for c in range(COLS - 2, -1, -1)],
]

fps_step = max(2, round(MOVE_MS / 1000 * FPS))
n_steps = min(len(p) - 1 for p in paths)
flips = [False] * ROWS
frames = []

for s in range(n_steps):
    for row in range(ROWS):
        c0 = paths[row][s][0]
        c1 = paths[row][s + 1][0]
        if c1 != c0:
            flips[row] = c1 < c0
    for i in range(fps_step):
        p = (i + 1) / fps_step
        arc = math.sin(p * math.pi)
        canvas = bg.copy()
        for row in range(ROWS):
            (c0, r0) = paths[row][s]
            (c1, r1) = paths[row][s + 1]
            x0, y0 = c0 * TILE + TILE / 2, r0 * TILE + TILE / 2
            x1, y1 = c1 * TILE + TILE / 2, r1 * TILE + TILE / 2
            im, base = sprites[row]
            draw(
                canvas,
                im,
                x0 + (x1 - x0) * p,
                y0 + (y1 - y0) * p - arc * BOB_PX,
                base * (1 - arc * SQUASH * 0.5),
                base * (1 + arc * SQUASH),
                flips[row],
            )
        frames.append(
            canvas.convert("RGB").resize((W * ZOOM, H * ZOOM), Image.NEAREST)
        )

os.makedirs(OUT, exist_ok=True)
dest = os.path.join(OUT, "step_anim_all_movers.gif")
frames[0].save(
    dest,
    save_all=True,
    append_images=frames[1:],
    duration=round(1000 / FPS),
    loop=0,
    optimize=False,
)
print("wrote %s (%d frames)" % (dest, len(frames)))
