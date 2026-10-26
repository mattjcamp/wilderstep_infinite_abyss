"""Grid-aligned 64x64 room tile set derived from the teal/gold reference.

Each tile is authored on a 32x32 "art pixel" grid and scaled 2x
(nearest) to 64x64, which matches the reference's chunky look.
Edges are designed so neighbouring pieces line up:
  * walls share the same band rows / inner trim, corners are mitred
  * floor planks tile seamlessly in both directions
  * multi-tile objects (tables, window) join on their shared edge
Objects (tables, crate, window, notice, lantern) have a transparent
background so they can sit on a floor or wall via background_sprite.
"""
import os, sys
from PIL import Image

T = (0, 180, 170, 255)      # teal
G = (255, 190, 55, 255)     # gold
C = (0, 0, 0, 0)            # clear
N = 32                      # art grid
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"


class Art:
    def __init__(self, bg=T):
        self.px = [[bg] * N for _ in range(N)]

    def rect(self, x0, y0, x1, y1, c):          # inclusive
        for y in range(max(0, y0), min(N - 1, y1) + 1):
            for x in range(max(0, x0), min(N - 1, x1) + 1):
                self.px[y][x] = c

    def get(self, x, y):
        return self.px[y][x]

    def copy(self):
        a = Art(); a.px = [r[:] for r in self.px]; return a

    def flip_h(self):
        a = Art(); a.px = [r[::-1] for r in self.px]; return a

    def flip_v(self):
        a = Art(); a.px = [r[:] for r in self.px[::-1]]; return a

    def transpose(self):
        a = Art(); a.px = [[self.px[x][y] for x in range(N)] for y in range(N)]; return a

    def image(self):
        im = Image.new("RGBA", (N, N))
        im.putdata([c for row in self.px for c in row])
        return im.resize((64, 64), Image.NEAREST)


# ── Walls ─────────────────────────────────────────────────────────
# Shared rows (top wall, counted from the outside edge):
#   0-1 clear margin, 2 thin rail, 4-8 heavy band, 10-13 light band,
#   16 inner rail, 17-31 floor-side margin is the floor tile itself,
#   so the wall tile ends with trim at 26-27 and teal below.
def wall_top():
    a = Art()
    a.rect(0, 2, 31, 2, G)                      # outer rail
    a.rect(0, 5, 31, 10, G)                     # heavy band
    for x in (3, 11, 19, 27):                   # notches under band
        a.rect(x, 9, x + 1, 10, T)
    for x in (7, 23):                           # notches on top
        a.rect(x, 5, x + 1, 5, T)
    a.rect(0, 13, 31, 17, G)                    # light band
    for x in (0, 15, 16, 31):                   # plank joints
        a.rect(x, 14, x, 16, T) if x not in (0, 31) else None
    a.rect(15, 14, 16, 16, T)
    for x in (5, 25):
        a.rect(x, 17, x + 1, 17, T)
    a.rect(0, 21, 31, 21, G)                    # inner rail
    a.rect(0, 26, 31, 27, G)                    # trim facing the room
    return a


def wall_left():
    a = Art()
    a.rect(2, 0, 2, 31, G)                      # outer rail
    # bead column: rounded beads 14 tall, joined by a short neck
    for y0 in (1, 17):
        a.rect(5, y0 + 1, 10, y0 + 12, G)
        a.rect(6, y0, 9, y0 + 13, G)
        a.rect(7, y0 + 4, 8, y0 + 9, T)        # slot
    for y in (0, 15, 16, 31):
        a.rect(7, y, 8, y, G)                   # necks between beads
    # light band, like the top wall's
    a.rect(13, 0, 17, 31, G)
    a.rect(14, 15, 16, 16, T)
    for y in (5, 25):
        a.rect(17, y, 17, y + 1, T)
    a.rect(21, 0, 21, 31, G)                    # inner rail
    a.rect(26, 0, 27, 31, G)                    # trim facing the room
    return a


def knob(a):
    """Square corner post with a dot, covering the mitre's outer end."""
    a.rect(0, 0, 18, 18, T)
    a.rect(2, 2, 16, 16, G)
    a.rect(2, 2, 2, 2, T); a.rect(16, 2, 16, 2, T)
    a.rect(2, 16, 2, 16, T); a.rect(16, 16, 16, 16, T)
    a.rect(5, 5, 13, 13, T)
    a.rect(8, 8, 10, 10, G)
    return a


def corner_tl():
    top, left = wall_top(), wall_left()
    a = Art()
    for y in range(N):
        for x in range(N):
            a.px[y][x] = left.get(x, y) if x < y else top.get(x, y)
    # trims and inner rail must stop at the mitre: clear the parts of
    # the top-wall pattern left of the left trim and vice versa.
    for y in range(N):
        for x in range(N):
            if x > 27 and y > 27:
                a.px[y][x] = T
    return knob(a)


# ── Floor ─────────────────────────────────────────────────────────
def floor(variant=0):
    """Two boards per tile (pitch 16), 2-px seams like the reference.
    End joints are staggered between the boards; the alt variant
    shifts them so a floor mixing both looks less repetitive."""
    a = Art()
    joints = [(9,), (25,)] if not variant else [(1,), (17,)]
    for i in range(2):
        y0 = i * 16
        a.rect(0, y0 + 14, 31, y0 + 15, G)      # seam under board
        a.rect(0, y0 + 6, 31, y0 + 6, G)        # thin grain line
        for jx in joints[i]:
            a.rect(jx, y0, jx + 1, y0 + 13, G)  # end joint
        mid = (joints[i][0] + 15) % 32
        a.rect(mid, y0 + 10, mid + 2, y0 + 10, G)  # nail dash
        a.rect((mid + 16) % 32, y0 + 2, (mid + 16) % 32 + 2, y0 + 2, G)
    return a


# ── Tables (transparent) ─────────────────────────────────────────
def _cross(a, cx, cy, arm=5, w=1, c=T):
    a.rect(cx - arm, cy - w + 1, cx + arm, cy + w, c)
    a.rect(cx - w + 1, cy - arm, cx + w, cy + arm, c)


def table_h(part):
    """part in left|mid|right|single; slab rows 7-24."""
    a = Art(C)
    x0 = 3 if part in ("left", "single") else 0
    x1 = 28 if part in ("right", "single") else 31
    a.rect(x0, 7, x1, 24, G)
    if part in ("left", "single"):
        a.rect(x0, 7, x0, 7, C); a.rect(x0, 24, x0, 24, C)
        a.rect(x0 + 2, 9, x0 + 3, 10, T); a.rect(x0 + 2, 21, x0 + 3, 22, T)
        a.rect(x0 + 2, 25, x0 + 4, 27, G)       # leg
    if part in ("right", "single"):
        a.rect(x1, 7, x1, 7, C); a.rect(x1, 24, x1, 24, C)
        a.rect(x1 - 3, 9, x1 - 2, 10, T); a.rect(x1 - 3, 21, x1 - 2, 22, T)
        a.rect(x1 - 4, 25, x1 - 2, 27, G)
    _cross(a, 15, 15)
    return a


def table_v(part):
    """Vertical table: transposed slab, legs under the bottom piece."""
    m = {"top": "left", "mid": "mid", "bottom": "right"}[part]
    h = table_h(m)
    h.rect(0, 25, 31, 31, C)                    # drop sideways legs
    a = h.transpose()
    if part == "bottom":
        a.rect(9, 29, 11, 30, G); a.rect(20, 29, 22, 30, G)
    return a


# ── Furniture / fixtures (transparent) ───────────────────────────
def crate():
    a = Art(C)
    a.rect(3, 3, 28, 28, G)
    a.rect(3, 3, 3, 3, C); a.rect(28, 3, 28, 3, C)
    a.rect(3, 28, 3, 28, C); a.rect(28, 28, 28, 28, C)
    a.rect(6, 6, 25, 25, T)
    a.rect(6, 6, 7, 7, G); a.rect(24, 6, 25, 7, G)
    a.rect(6, 24, 7, 25, G); a.rect(24, 24, 25, 25, G)
    _cross(a, 15, 15, arm=3, w=1, c=G)
    a.rect(5, 29, 7, 30, G); a.rect(24, 29, 26, 30, G)   # feet
    return a


def window(part):
    """part in left|right|single: frame with 2x2 panes per tile."""
    a = Art(C)
    x0 = 2 if part in ("left", "single") else 0
    x1 = 29 if part in ("right", "single") else 31
    a.rect(x0, 4, x1, 27, G)
    a.rect(x0 + (2 if x0 else 0), 6, x1 - (2 if x1 < 31 else 0), 25, T)
    # mullions
    a.rect(0 if x0 == 0 else x0, 15, x1, 16, G)
    for mx in (15, 16):
        a.rect(mx, 6, mx, 25, G)
    if x0 == 0:
        a.rect(0, 6, 0, 25, G)   # shared mullion with the left half
    # glints (short diagonals) in each pane
    for px0 in (x0 + 4, 20):
        for py0 in (8, 18):
            for k in range(3):
                a.rect(px0 + 4 - k, py0 + k + 1, px0 + 4 - k, py0 + k + 1, G)
    return a


def notice():
    a = Art(C)
    a.rect(7, 2, 24, 29, G)
    a.rect(9, 4, 22, 27, T)
    for y in (7, 11, 15, 19):
        a.rect(11, y, 20, y + 1, G)
    a.rect(16, 15, 17, 16, T); a.rect(15, 17, 16, 17, G)
    a.rect(11, 23, 20, 25, G)                   # stamp block
    return a


def lantern():
    a = Art(C)
    a.rect(15, 2, 16, 8, G)                     # hanger
    a.rect(14, 4, 17, 4, G)
    a.rect(13, 9, 18, 10, G)                    # cap
    a.rect(11, 12, 20, 21, G)                   # body
    a.rect(12, 11, 19, 22, G)
    a.rect(11, 12, 11, 12, C); a.rect(20, 12, 20, 12, C)
    a.rect(11, 21, 11, 21, C); a.rect(20, 21, 20, 21, C)
    a.rect(15, 14, 16, 18, T)                   # flame slot
    a.rect(14, 24, 17, 25, G)                   # base
    return a


TILES = {
    "wall_top": wall_top(),
    "wall_bottom": wall_top().flip_v(),
    "wall_left": wall_left(),
    "wall_right": wall_left().flip_h(),
    "wall_corner_tl": corner_tl(),
    "wall_corner_tr": corner_tl().flip_h(),
    "wall_corner_bl": corner_tl().flip_v(),
    "wall_corner_br": corner_tl().flip_h().flip_v(),
    "floor_planks": floor(0),
    "floor_planks_alt": floor(1),
    "table_h_left": table_h("left"),
    "table_h_mid": table_h("mid"),
    "table_h_right": table_h("right"),
    "table_v_top": table_v("top"),
    "table_v_mid": table_v("mid"),
    "table_v_bottom": table_v("bottom"),
    "table_single": table_h("single"),
    "crate": crate(),
    "window_left": window("left"),
    "window_right": window("right"),
    "window_single": window("single"),
    "notice_board": notice(),
    "lantern": lantern(),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, art in TILES.items():
        art.image().save(os.path.join(OUT, f"{name}.png"))
    print(len(TILES), "tiles ->", OUT)
