"""North-south fences and walls (+ corners) for the town set.

Usage: python3 make_vertical.py OUT_DIR

Drawn in the town's SOURCE colours (gold = main, cream = light,
transparent gaps) on a 32x32 grid scaled 2x, so recolor_town.py turns
them into any scheme like the rest of the set (enclosed gaps become the
piece's dark colour). Geometry matches the existing horizontal pieces:
  fence: posts rows 17-29, rails rows 21-22 and 26-27 (grid units)
  wall:  cap from row 8 (pillars) / 14 (wall), face down to row 29
A vertical run is a strip down the middle of the tile; its bottom end
and corners show a front face so they meet horizontal runs.
"""
import os, sys
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "vert"
N = 32
G = (250, 200, 64, 255)     # main
C = (255, 244, 214, 255)    # light
X = (0, 0, 0, 0)


class A:
    def __init__(self):
        self.p = [[X] * N for _ in range(N)]

    def r(self, x0, y0, x1, y1, c):
        for y in range(max(0, y0), min(N - 1, y1) + 1):
            for x in range(max(0, x0), min(N - 1, x1) + 1):
                self.p[y][x] = c
        return self

    def flip(self):
        a = A(); a.p = [row[::-1] for row in self.p]; return a

    def img(self):
        im = Image.new("RGBA", (N, N))
        im.putdata([c for row in self.p for c in row])
        return im.resize((64, 64), Image.NEAREST)


# ── Wooden rail fence ──────────────────────────────────────────────
RL, RR = 13, 18            # vertical rails (x)
PX0, PX1 = 14, 17          # end/corner post (x), same height as horizontal posts


def v_rails(a, y0, y1):
    a.r(RL, y0, RL, y1, G).r(RR, y0, RR, y1, G)
    a.r(RL, y0, RL, y1, G)
    return a


def small_post(a, y0):
    a.r(12, y0, 19, y0 + 1, C).r(12, y0 + 2, 19, y0 + 7, G)
    a.r(12, y0 + 3, 12, y0 + 6, C)
    return a


def end_post(a):
    a.r(PX0, 17, PX1, 18, C).r(PX0, 19, PX1, 29, G).r(PX0, 19, PX0, 28, C)
    return a


def h_rails(a, x0, x1):
    return a.r(x0, 21, x1, 22, G).r(x0, 26, x1, 27, G)


def fence_v():
    a = v_rails(A(), 0, 31)
    return small_post(a, 12)


def fence_v_top():
    a = v_rails(A(), 18, 31)
    return small_post(a, 12)


def fence_v_bottom():
    a = v_rails(A(), 0, 18)
    return end_post(a)


def fence_corner_tl():      # runs right and down
    a = h_rails(A(), PX1 + 1, 31)
    v_rails(a, 28, 31)
    return end_post(a)


def fence_corner_bl():      # runs up and right
    a = h_rails(A(), PX1 + 1, 31)
    v_rails(a, 0, 18)
    return end_post(a)


# ── Stone wall ─────────────────────────────────────────────────────
SX0, SX1 = 11, 20          # strip / pillar columns


def strip(a, y0, y1):
    """Top of a north-south wall: staggered blocks with mortar gaps."""
    a.r(SX0, y0, SX1, y1, G)
    a.r(SX0, y0, SX0, y1, C)                         # lit edge
    for y in range(y0, y1 + 1):
        if (y + 1) % 5 == 0:
            a.r(SX0 + 1, y, SX1 - 1, y, X)           # course of mortar
        k = (y // 5) % 2
        if y % 5 in (1, 2, 3):
            a.r(SX0 + (4 if k else 6), y, SX0 + (4 if k else 6), y, X)  # vertical joint
    return a


def pillar(a, y0=8):
    a.r(SX0 + 1, y0, SX1 - 1, y0, G).r(SX0, y0 + 1, SX1, 29, G)
    a.r(SX0, y0 + 1, SX1, y0 + 5, C)                 # cap catches the light
    a.r(SX0, y0 + 6, SX1, y0 + 6, X)
    for y in (y0 + 12, y0 + 17):
        a.r(SX0 + 1, y, SX1 - 1, y, X)
    a.r(SX0 + 5, y0 + 13, SX0 + 5, y0 + 16, X)
    return a


def wall_run(a, x0, x1):
    """Front-facing wall body (as on the horizontal pieces)."""
    a.r(x0, 14, x1, 29, G)
    a.r(x0, 14, x1, 16, C)                           # cap
    a.r(x0, 17, x1, 17, X)
    for y in (21, 25):
        a.r(x0, y, x1, y, X)
    for x in range(x0, x1 + 1):
        if (x - x0) % 6 == 3:
            a.r(x, 18, x, 20, X)
        if (x - x0) % 6 == 0:
            a.r(x, 22, x, 24, X)
        if (x - x0) % 6 == 3:
            a.r(x, 26, x, 28, X)
    return a


def wall_v():
    return strip(A(), 0, 31)


def wall_v_top():
    a = strip(A(), 9, 31)
    a.r(SX0, 8, SX1, 8, X).r(SX0 + 1, 8, SX1 - 1, 8, G)
    return a


def wall_v_bottom():
    a = strip(A(), 0, 8)
    return pillar(a, 8)


def wall_corner_tl():
    a = wall_run(A(), SX1 + 1, 31)
    a = pillar(a, 8)
    strip(a, 30, 31)
    return a


def wall_corner_bl():
    a = strip(A(), 0, 8)
    a = wall_run(a, SX1 + 1, 31)
    return pillar(a, 8)


TILES = {
    "fence_rail_v": fence_v(),
    "fence_rail_v_top": fence_v_top(),
    "fence_rail_v_bottom": fence_v_bottom(),
    "fence_rail_corner_tl": fence_corner_tl(),
    "fence_rail_corner_tr": fence_corner_tl().flip(),
    "fence_rail_corner_bl": fence_corner_bl(),
    "fence_rail_corner_br": fence_corner_bl().flip(),
    "wall_v": wall_v(),
    "wall_v_top": wall_v_top(),
    "wall_v_bottom": wall_v_bottom(),
    "wall_corner_tl": wall_corner_tl(),
    "wall_corner_tr": wall_corner_tl().flip(),
    "wall_corner_bl": wall_corner_bl(),
    "wall_corner_br": wall_corner_bl().flip(),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for n, a in TILES.items():
        a.img().save(os.path.join(OUT, n + ".png"))
    print(len(TILES), "tiles ->", OUT)
