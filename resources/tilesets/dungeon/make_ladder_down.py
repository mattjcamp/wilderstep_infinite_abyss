"""Dungeon ladders: a ladder in a dark, crumbling hole.

  ladder_down.png  the ladder drops away into the dark
  ladder_up.png    the same picture upside down: the lit end is at the
                   bottom of the tile and the ladder climbs into the dark

Usage: python3 make_ladder_down.py DUNGEON_SPRITE_DIR

Drawn on top of floor_cobble (so the floor around the hole matches the
floor tiles beside it). The hole has the pit pieces' ragged rim and the
far wall of the shaft under its top edge; the chunky, outlined wooden ladder is
lit at the top and only fades into black near the bottom. Writes both
into the same folder (the recolour script doesn't touch it — it isn't
in teal_gold/).
"""
import math, os, sys
from PIL import Image

D = OUT = sys.argv[1]
FLOOR = Image.open(os.path.join(D, "floor_cobble.png")).convert("RGBA")
DARK, MID, LIGHT = (10, 10, 16, 255), (78, 84, 102, 255), (176, 182, 196, 255)
WOOD_D, WOOD, WOOD_L = (92, 52, 22, 255), (164, 100, 46, 255), (232, 170, 92, 255)
GLOW = (255, 226, 150)


def h01(x, y, s):
    v = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    return ((v * 2654435761) & 0xFFFFFFFF) / 0xFFFFFFFF


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def ladder(px, x0, x1, y0, y1, shade):
    """A chunky wooden ladder: 4 px rails at x0 / x1 and 3 px rungs every
    9 px, with a dark outline so it stands out from the grey stone.
    shade(y) -> 0 (fully lit) .. 1 (lost in the dark); None = skip."""
    W = 4
    wood = {}
    for y in range(y0, y1 + 1):
        s = shade(y)
        if s is None:
            continue
        lit, base, dk = mix(WOOD_L, DARK, s), mix(WOOD, DARK, s), mix(WOOD_D, DARK, min(1, s + .15))
        for xr in (x0, x1):
            wood[(xr, y)] = lit
            wood[(xr + 1, y)] = lit
            wood[(xr + 2, y)] = base
            wood[(xr + 3, y)] = dk
        k = (y - y0) % 9
        if k in (3, 4, 5):
            for x in range(x0 + W, x1):
                wood[(x, y)] = lit if k == 3 else (base if k == 4 else dk)
    for (x, y), c in wood.items():
        px[x, y] = c
    # dark outline round the whole ladder
    for (x, y) in list(wood):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if q not in wood and 0 <= q[0] < 64 and 0 <= q[1] < 64:
                px[q] = DARK


def ladder_down():
    """The hole + ladder on a clear layer (so ladder_up can flip it)."""
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = im.load()
    X0, X1, Y0, Y1 = 9, 54, 6, 59
    # the hole, with a ragged edge
    for y in range(64):
        for x in range(64):
            wob = (h01(x // 2, y // 2, 3) - .5) * 3
            d = min(x - X0, X1 - x, y - Y0, Y1 - y) + wob
            if d > 0:
                px[x, y] = DARK
            elif d > -1.5:
                px[x, y] = MID if h01(x, y, 7) > .3 else LIGHT
            elif d > -4 and h01(x // 2, y // 2, 9) > .8:
                px[x, y] = LIGHT if (x + y) % 2 else MID
    # the far wall of the shaft just below the top rim
    for x in range(X0 + 2, X1 - 1):
        drop = 3 + int(h01(x // 3, 0, 5) * 7)
        for y in range(Y0 + 2, Y0 + 2 + drop):
            px[x, y] = MID if h01(x, y, 2) > .15 else LIGHT
    # the ladder fading into the dark as it goes down
    ladder(px, 17, 43, Y0 + 1, Y1 - 3,
           lambda y: None if y > Y1 - 4 else max(0.0, (y - (Y0 + 22)) / 34) ** 1.4)
    return im


def on_floor(layer):
    im = FLOOR.copy()
    im.alpha_composite(layer)
    return im


hole = ladder_down()
on_floor(hole).save(os.path.join(OUT, "ladder_down.png"))
# Ladder up: the same hole and ladder turned upside down, so the lit top
# of the ladder is at the bottom of the tile and it climbs away into the
# dark. Only the hole is flipped; the floor stays the right way up so it
# still joins the neighbouring floor tiles.
on_floor(hole.transpose(Image.FLIP_TOP_BOTTOM)).save(os.path.join(OUT, "ladder_up.png"))
