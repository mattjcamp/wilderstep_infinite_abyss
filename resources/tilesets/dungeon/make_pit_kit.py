"""Pit kit with rough, crumbling rims (edges, corners, centre).

Usage: python3 make_pit_kit.py SPRITE_DIR

Colours are read from the folder's own pit.png (dark / mid / light), so
the same script serves the teal/gold originals and the recoloured set.

Each piece has rims on some sides. A rim's edge wanders in and out
(a smooth wobble that repeats every 64 px, so neighbouring pieces meet
exactly) and crumbles: loose chips and stones scatter on the ground
side, and the edge itself is ragged.
  far rim (top)      the pit's inner wall drops away below the edge:
                     a band of rock streaked with shadow
  side rims          a narrower band of the same wall
  near rim (bottom)  a lit lip with a scalloped, broken edge
The ground outside the rims is floor (floor_cobble, tile-aligned so it
joins the neighbouring floor tiles); the hole inside is transparent, so
it shows the cell's background (dark, water, …). pit_centre stays a
solid dark tile for the middle of big pits.
"""
import math, os, random, sys
from collections import Counter
from PIL import Image

D = sys.argv[1]
pit = Image.open(os.path.join(D, "pit.png")).convert("RGBA")
cols = [c for c, _ in Counter(pit.getpixel((x, y))[:3] for y in range(64) for x in range(64)).most_common(3)]
cols.sort(key=sum)
DARK, MID, LIGHT = [c + (255,) for c in cols]
CLEAR = (0, 0, 0, 0)
# The ground around the pit: the floor the pits are usually cut into,
# tile-aligned so it runs on seamlessly into neighbouring floor tiles.
FLOOR = Image.open(os.path.join(D, "floor_cobble.png")).convert("RGBA")

DEPTH = {"top": 12, "bottom": 9, "left": 9, "right": 9}   # rim depth from the tile edge
WALL = {"top": 15, "bottom": 0, "left": 5, "right": 5}      # inner wall band below the edge


def wobble(t, seed, amp=3.2):
    """Smooth periodic (64 px) offset for a rim at position t."""
    r = random.Random(seed)
    v = 0.0
    for k in (1, 2, 3, 5, 7):
        v += math.sin(2 * math.pi * k * t / 64 + r.uniform(0, 6.3)) / k
    return amp * v


def hash01(x, y, salt):
    h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)
    return ((h * 2654435761) & 0xFFFFFFFF) / 0xFFFFFFFF


def rim_dist(x, y, sides):
    """Signed distance into the hole (positive = inside the pit) for
    the given rimmed sides; open sides run off the tile edge."""
    d = []
    if "top" in sides:
        d.append(("top", y - (DEPTH["top"] + wobble(x, 11))))
    if "bottom" in sides:
        d.append(("bottom", (63 - y) - (DEPTH["bottom"] + wobble(x, 23))))
    if "left" in sides:
        d.append(("left", x - (DEPTH["left"] + wobble(y, 37))))
    if "right" in sides:
        d.append(("right", (63 - x) - (DEPTH["right"] + wobble(y, 41))))
    if not d:
        return None, 99.0
    # Round the corner where two rims meet so it reads as one ragged lip.
    if len(d) >= 2:
        ds = sorted(d, key=lambda s: s[1])
        a, b = ds[0][1], ds[1][1]
        R = 7.0
        if a < R and b < R:
            soft = R - math.hypot(R - a, R - b)
            return ds[0][0], soft
    return min(d, key=lambda s: s[1])


def piece(sides):
    im = Image.new("RGBA", (64, 64), CLEAR)
    px = im.load()
    # Edges and corners leave the hole see-through; the centre is solid.
    HOLE = CLEAR if sides else DARK
    for y in range(64):
        for x in range(64):
            side, dist = rim_dist(x, y, sides)
            if dist >= 99:
                px[x, y] = HOLE
                continue
            n = hash01(x, y, 5)
            # Ragged edge: nibble the boundary in 2 px lumps.
            dist += (hash01(x // 2, y // 2, 13) - 0.5) * 3.0
            if dist < 0:
                # Ground side: floor, with loose stones (2 px lumps)
                # thinning out away from the edge and a broken fringe.
                px[x, y] = FLOOR.getpixel((x, y))
                stone = hash01(x // 2, y // 2, 17)
                if dist > -1.3:
                    px[x, y] = MID if n > 0.25 else LIGHT
                elif dist > -6 and stone > 0.78 + (-dist) * 0.03:
                    px[x, y] = LIGHT if (x + y) % 2 == 0 and n > 0.4 else MID
                continue
            if side == "bottom":
                # Near lip: lit, scalloped stones with a dark undercut.
                bump = 2.0 + 2.2 * abs(math.sin(math.pi * (x + 3) / 7.0))
                if dist < bump - 0.8:
                    px[x, y] = LIGHT if n > 0.12 else MID
                elif dist < bump + 0.6:
                    px[x, y] = MID if n > 0.4 else HOLE
                else:
                    px[x, y] = HOLE
                continue
            wall = WALL[side]
            if dist >= wall:
                px[x, y] = HOLE
                continue
            # Inner wall dropping into the dark: rock with long shadow
            # streaks hanging down from the edge (like the one-tile pit).
            along = x if side == "top" else y
            col = along // 3
            start = 1.5 + hash01(col, 0, 19 + len(side)) * (wall * 0.6)
            ln = hash01(col, 1, 23 + len(side))
            f = dist / wall
            if dist < 1.6:
                px[x, y] = LIGHT if n > 0.3 else MID
            elif dist > start and ln > 0.35:
                px[x, y] = HOLE
            elif f > 0.75 and n < (f - 0.6) * 2.5:
                px[x, y] = HOLE
            else:
                px[x, y] = MID if n > 0.08 else LIGHT
    return im


PIECES = {
    "pit_top": ("top",), "pit_bottom": ("bottom",),
    "pit_left": ("left",), "pit_right": ("right",),
    "pit_corner_tl": ("top", "left"), "pit_corner_tr": ("top", "right"),
    "pit_corner_bl": ("bottom", "left"), "pit_corner_br": ("bottom", "right"),
    "pit_centre": (),
}
for n, sides in PIECES.items():
    im = piece(sides)
    im.save(os.path.join(D, n + ".png"))
print(len(PIECES), "pit pieces ->", D)
