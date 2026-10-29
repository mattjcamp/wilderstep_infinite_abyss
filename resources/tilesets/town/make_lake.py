"""Lake / shore pieces for building larger bodies of water that join the
river set (make_river.py). Same look as the river: the shared water
pattern (map/water.png) on the dark water base, a solid blue bank line
with a lit top bank, and transparent land so the tile's Grass
background shows through.

Usage: python3 make_lake.py WATER_PNG OUT_DIR   (WATER_PNG = sprites/map/water.png)

The shoreline sits 16 px in from the tile edge, the same line as the
river's banks (the river is the 32 px band 16..47), so a river arm
lines up exactly with a lake inlet. The open-water centre of a lake is
the existing plain Water tile (map/water.png).

Pieces (the name says where the LAND is):
  lake_edge_{top,bottom,left,right}     straight shore, land on that side
  lake_corner_{tl,tr,bl,br}             outer corner, land on two sides (rounded like a river bend)
  lake_inner_{tl,tr,bl,br}              inner corner, land only in that corner
  lake_inlet_{top,bottom,left,right}    straight shore with a river arm entering from that side
"""
import os, sys
from PIL import Image

WATER = Image.open(sys.argv[1]).convert("RGBA")
OUT = sys.argv[2]
BASE = (12, 12, 20, 255)          # the game's backdrop colour (#0c0c14)
BANK = (0, 119, 255, 255)         # the water's blue
FOAM = (110, 176, 255, 255)       # lit top bank
CLEAR = (0, 0, 0, 0)
B0, B1, R = 16, 47, 7             # same band + corner radius as the river


def _corner_ok(x, y, cx0, cy0, sx, sy):
    """Round the convex water corner at (cx0, cy0); sx/sy = +1 when the
    water extends right/down from that corner, -1 when left/up."""
    cx, cy = cx0 + sx * R, cy0 + sy * R
    dx, dy = (cx - x) * sx, (cy - y) * sy
    return not (dx > 0 and dy > 0 and dx * dx + dy * dy > R * R)


def _region(name):
    band_v = lambda x, y: B0 <= x <= B1
    band_h = lambda x, y: B0 <= y <= B1
    edge = {
        "top":    lambda x, y: y >= B0,
        "bottom": lambda x, y: y <= B1,
        "left":   lambda x, y: x >= B0,
        "right":  lambda x, y: x <= B1,
    }
    kind, side = name.split("_", 1)
    if kind == "edge":
        return edge[side]
    if kind == "inlet":
        arm = band_v if side in ("top", "bottom") else band_h
        return lambda x, y: edge[side](x, y) or arm(x, y)
    v = "top" if side[0] == "t" else "bottom"
    h = "left" if side[1] == "l" else "right"
    if kind == "inner":
        return lambda x, y: edge[v](x, y) or edge[h](x, y)
    # outer corner
    cx0 = B0 if h == "left" else B1
    cy0 = B0 if v == "top" else B1
    sx = 1 if h == "left" else -1
    sy = 1 if v == "top" else -1
    return lambda x, y: edge[v](x, y) and edge[h](x, y) and _corner_ok(x, y, cx0, cy0, sx, sy)


PIECES = [f"{k}_{s}" for k, sides in (
    ("edge", ("top", "bottom", "left", "right")),
    ("corner", ("tl", "tr", "bl", "br")),
    ("inner", ("tl", "tr", "bl", "br")),
    ("inlet", ("top", "bottom", "left", "right")),
) for s in sides]


def piece(name):
    reg = _region(name)

    def inside(x, y):
        x, y = min(max(x, 0), 63), min(max(y, 0), 63)   # runs carry on past the edge
        return reg(x, y)

    im = Image.new("RGBA", (64, 64), CLEAR)
    for y in range(64):
        for x in range(64):
            if not inside(x, y):
                continue
            near = lambda d: any(not inside(x + dx, y + dy)
                                 for dx in range(-d, d + 1) for dy in range(-d, d + 1))
            if near(1):
                c = FOAM if not inside(x, y - 1) or not inside(x, y - 2) else BANK
            elif near(2):
                c = BANK
            else:
                w = WATER.getpixel((x, y))
                c = w if w[3] else BASE
            im.putpixel((x, y), c)
    return im


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for n in PIECES:
        piece(n).save(os.path.join(OUT, f"lake_{n}.png"))
    print(len(PIECES), "pieces ->", OUT)
