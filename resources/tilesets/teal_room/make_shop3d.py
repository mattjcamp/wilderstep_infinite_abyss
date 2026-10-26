"""Shop tile set in the dungeon's 3/4 ("sort of 3D") format.

Same construction as the dungeon set so the two read as one game:
  * walls: a light CAP on top, a darker FRONT FACE below it, a
    transparent shadow gap under the face; side walls are a vertical
    cap strip; corners join cap + strip the same way the dungeon's do
  * props show a top surface plus a front face, outlined in dark
Distinct from the stone dungeon: teal + gold WOOD (panelled walls,
plank floors, timber furniture) with dark #080714 seams/outlines.

Authored on a 32x32 grid, scaled 2x to 64x64 (the dungeon art's
pixel size). Geometry matches the dungeon walls: cap rows 0-7,
gap row 8, face rows 9-29, clear 30-31; side strip cols 1-7.
"""
import os, sys
from PIL import Image

T = (0, 180, 170, 255)      # teal  (mid)
G = (255, 190, 55, 255)     # gold  (light)
D = (8, 7, 20, 255)         # dark  (outline / seams)
C = (0, 0, 0, 0)            # clear
N = 32
OUT = sys.argv[1] if len(sys.argv) > 1 else "out3d"


class Art:
    def __init__(self, bg=C):
        self.px = [[bg] * N for _ in range(N)]

    def rect(self, x0, y0, x1, y1, c):          # inclusive, clipped
        for y in range(max(0, y0), min(N - 1, y1) + 1):
            for x in range(max(0, x0), min(N - 1, x1) + 1):
                self.px[y][x] = c

    def dot(self, x, y, c):
        self.rect(x, y, x, y, c)

    def copy(self):
        a = Art(); a.px = [r[:] for r in self.px]; return a

    def flip_h(self):
        a = Art(); a.px = [r[::-1] for r in self.px]; return a

    def paste(self, other, mask=lambda x, y: True):
        for y in range(N):
            for x in range(N):
                if mask(x, y) and other.px[y][x] != C:
                    self.px[y][x] = other.px[y][x]

    def image(self):
        im = Image.new("RGBA", (N, N))
        im.putdata([c for row in self.px for c in row])
        return im.resize((64, 64), Image.NEAREST)


CAP0, CAP1, GAP, FACE0, FACE1 = 0, 7, 8, 9, 29


# ── Wall parts ────────────────────────────────────────────────────
def cap(a, x0=0, x1=31):
    """Gold top beam (rows 0-4) with grain, teal front edge (5-7)."""
    a.rect(x0, 0, x1, 4, G)
    for x in range(x0, x1 + 1):
        if x % 16 in (5, 6, 7) : a.dot(x, 2, T)       # grain dashes
        if x % 16 in (12, 13): a.dot(x, 1, T)
        if x % 16 == 15: a.rect(x, 0, x, 4, D)        # beam joint
    a.rect(x0, 5, x1, 7, T)
    a.rect(x0, 5, x1, 5, D)                           # crisp under-edge
    for x in range(x0, x1 + 1):
        if x % 8 == 3: a.dot(x, 6, G)                 # peg heads


def panel_face(a, x0=0, x1=31):
    """Wood-panelled front face, rows 9-29: vertical boards above a
    gold chair rail, a teal wainscot below, gold skirting at the foot."""
    a.rect(x0, FACE0, x1, FACE1, T)
    for x in range(x0, x1 + 1):
        if x % 8 == 0:
            a.rect(x, FACE0, x, 17, D)                # board seam
        elif x % 8 == 1:
            a.rect(x, FACE0, x, 10, G)                # light catching the board top
    for x in range(x0, x1 + 1):
        if x % 8 == 4:
            a.dot(x, 11, D); a.dot(x, 16, D)          # nails
    a.rect(x0, 18, x1, 18, G)                         # chair rail
    a.rect(x0, 19, x1, 19, T)
    a.rect(x0, 20, x1, 20, D)
    for x in range(x0, x1 + 1):                       # wainscot panels
        if x % 16 == 0:
            a.rect(x, 21, x, 26, D)
        if x % 16 in (3, 12):
            a.rect(x, 22, x, 25, D)
    for x in range(x0, x1 + 1):
        if 3 <= x % 16 <= 12:
            a.dot(x, 22, D); a.dot(x, 25, D)
    a.rect(x0, 27, x1, 29, T)                         # skirting
    a.rect(x0, 27, x1, 27, D)
    a.rect(x0, 28, x1, 28, G)


def strip(a, y0=0, y1=31):
    """Side-wall cap strip: gold beam (cols 1-4), teal edge (5-7)."""
    a.rect(1, y0, 4, y1, G)
    a.rect(5, y0, 7, y1, T)
    a.rect(5, y0, 5, y1, D)
    for y in range(y0, y1 + 1):
        if y % 16 in (5, 6, 7): a.dot(2, y, T)
        if y % 16 == 15: a.rect(1, y, 4, y, D)
        if y % 8 == 3: a.dot(6, y, G)


def wall_top():
    a = Art(); cap(a); panel_face(a); return a


def wall_side():
    a = Art(); strip(a); return a


def corner_tl():
    a = Art()
    cap(a)
    panel_face(a, 8, 31)
    a.rect(8, FACE0, 8, FACE1, D)                    # inside corner shadow
    strip(a, 0, 31)
    a.rect(1, 0, 7, 4, G)                             # cap + strip meet
    a.rect(5, 5, 7, 7, T)
    return a


def corner_bl():
    """Bottom wall whose left end meets the side strip from above."""
    a = wall_top()
    a.rect(0, 0, 0, 31, C)
    strip(a, 0, 7)
    a.rect(1, 0, 7, 4, G)
    a.rect(1, 5, 7, 7, T); a.rect(1, 5, 7, 5, D)
    a.rect(1, FACE0, 7, FACE1, T)                     # strip's end face
    a.rect(1, FACE0, 1, 10, G)
    a.rect(7, FACE0, 7, FACE1, D)
    a.rect(1, 18, 7, 18, G); a.rect(1, 20, 7, 20, D)
    a.rect(1, 27, 7, 27, D); a.rect(1, 28, 7, 28, G)
    return a


def wall_with(feature):
    a = wall_top(); feature(a); return a


def _window(a, x0, x1, left_edge=True, right_edge=True):
    """Window set into the panel face, rows 10-24."""
    a.rect(x0, 10, x1, 24, G)                         # frame
    a.rect(x0 + (2 if left_edge else 0), 12, x1 - (2 if right_edge else 0), 22, D)
    gl = [x for x in range(x0 + 2, x1 - 1)]
    # panes: teal glass with a dark mullion cross
    a.rect(x0 + (2 if left_edge else 0), 12, x1 - (2 if right_edge else 0), 22, T)
    a.rect(x0, 17, x1, 17, D)
    for x in range(x0, x1 + 1):
        if (x - x0) % 8 == 7 or (not left_edge and x == x0):
            a.rect(x, 12, x, 22, D)
    for x in gl[::8]:                                 # glints
        a.dot(x + 1, 14, G); a.dot(x + 2, 13, G); a.dot(x + 1, 19, G)
    a.rect(x0 - (1 if left_edge else 0), 24, x1 + (1 if right_edge else 0), 25, G)  # sill
    a.rect(x0 - (1 if left_edge else 0), 26, x1 + (1 if right_edge else 0), 26, D)


def window_single(a): _window(a, 8, 23)
def window_left(a): _window(a, 8, 31, right_edge=False)
def window_right(a): _window(a, 0, 23, left_edge=False)


def notice(a):
    a.rect(8, 10, 23, 25, D)                          # board shadow
    a.rect(8, 10, 23, 24, G)                          # frame
    a.rect(10, 12, 21, 22, T)                         # cork
    a.rect(11, 13, 16, 20, G); a.rect(12, 14, 15, 14, D)   # papers
    a.rect(12, 16, 15, 16, D); a.rect(12, 18, 14, 18, D)
    a.rect(17, 14, 20, 21, G); a.rect(18, 15, 19, 15, D)
    a.rect(18, 17, 19, 17, D); a.rect(18, 19, 19, 19, D)
    a.dot(13, 13, D); a.dot(18, 14, D)                # pins


# ── Floor (top-down, like the dungeon floors) ─────────────────────
def floor(variant=0):
    a = Art(T)
    joints = (9, 25) if not variant else (1, 17)
    for i in range(4):
        y0 = i * 8
        a.rect(0, y0 + 7, 31, y0 + 7, D)              # board seam
        jx = (joints[i % 2] + i * 4) % 32
        a.rect(jx, y0, jx, y0 + 6, D)                 # end joint
        a.dot((jx + 1) % 32, y0 + 1, G)
        a.dot((jx + 12) % 32, y0 + 3, D); a.dot((jx + 13) % 32, y0 + 3, D)  # grain
        a.dot((jx - 2) % 32, y0 + 5, D)
        a.dot((jx + 2) % 32, y0 + 3, G); a.dot((jx - 3) % 32, y0 + 3, G)    # nails
    return a


# ── Furniture (3/4: top surface + front face) ────────────────────
def table(part):
    """Horizontal table. Top rows 8-17, front face 18-21, legs 22-28."""
    a = Art()
    x0 = 2 if part in ("left", "single") else 0
    x1 = 29 if part in ("right", "single") else 31
    a.rect(x0, 7, x1, 22, D)                          # outline
    a.rect(x0 + (1 if x0 else 0), 8, x1 - (1 if x1 < 31 else 0), 17, G)
    for y in (10, 13, 16):                            # plank seams on top
        a.rect(x0 + 1, y, x1 - 1, y, T) if y != 16 else None
    for x in range(x0, x1 + 1):
        if x % 10 == 4: a.dot(x, 11, D); a.dot(x + 1, 14, D)
    a.rect(x0 + (1 if x0 else 0), 18, x1 - (1 if x1 < 31 else 0), 21, T)   # apron
    a.rect(x0 + (1 if x0 else 0), 18, x1 - (1 if x1 < 31 else 0), 18, G)
    if part in ("left", "single"):
        a.rect(x0 + 1, 22, x0 + 3, 28, D); a.rect(x0 + 2, 22, x0 + 2, 27, T)
    if part in ("right", "single"):
        a.rect(x1 - 3, 22, x1 - 1, 28, D); a.rect(x1 - 2, 22, x1 - 2, 27, T)
    return a


def table_v(part):
    """Vertical (long, going down) table: top surface runs the height;
    only the bottom piece shows the front apron and legs."""
    a = Art()
    y0 = 6 if part == "top" else 0
    y1 = 31 if part != "bottom" else 17
    a.rect(6, y0, 25, y1 + (4 if part == "bottom" else 0), D)
    a.rect(7, y0 + (1 if part == "top" else 0), 24, y1, G)
    for x in (12, 18):
        a.rect(x, y0 + 1, x, y1 - 1, T)               # plank seams
    for y in range(y0, y1 + 1):
        if y % 10 == 4: a.dot(9, y, D); a.dot(21, y + 1, D)
    if part == "bottom":
        a.rect(7, 18, 24, 21, T); a.rect(7, 18, 24, 18, G)
        a.rect(7, 22, 9, 28, D); a.rect(8, 22, 8, 27, T)
        a.rect(22, 22, 24, 28, D); a.rect(23, 22, 23, 27, T)
    return a


def crate():
    a = Art()
    a.rect(5, 5, 26, 28, D)                           # outline
    a.rect(6, 6, 25, 11, G)                           # lid (top)
    a.rect(6, 8, 25, 8, T); a.rect(6, 10, 25, 10, T)
    a.rect(6, 12, 25, 12, D)
    a.rect(6, 13, 25, 27, T)                          # front face
    a.rect(6, 13, 7, 27, G); a.rect(24, 13, 25, 27, G)   # side posts
    a.rect(6, 13, 25, 14, G); a.rect(6, 26, 25, 27, G)   # rails
    for k in range(12):                               # X brace
        a.rect(9 + k + (k // 6), 15 + k, 10 + k + (k // 6), 15 + k, G)
        a.rect(22 - k - (k // 6), 15 + k, 23 - k - (k // 6), 15 + k, G)
    a.dot(9, 16, D); a.dot(22, 16, D); a.dot(9, 24, D); a.dot(22, 24, D)
    return a


def lantern():
    """Wall lantern on a bracket (transparent; sits on a wall)."""
    a = Art()
    a.rect(13, 4, 20, 5, D); a.rect(14, 4, 19, 4, G)  # bracket arm
    a.rect(15, 6, 16, 8, D)                           # hook
    a.rect(12, 9, 19, 11, D); a.rect(13, 9, 18, 10, G)      # roof
    a.rect(11, 12, 20, 22, D)                         # body outline
    a.rect(12, 12, 19, 21, G)                         # glow
    a.rect(12, 12, 12, 21, T); a.rect(19, 12, 19, 21, T)    # frame
    a.rect(15, 12, 16, 21, T)
    a.rect(13, 15, 14, 18, (255, 230, 150, 255)) if False else None
    a.rect(13, 23, 18, 24, D); a.rect(14, 23, 17, 23, G)    # base
    return a


TILES = {
    "wall_top": wall_top(),
    "wall_bottom": wall_top(),
    "wall_left": wall_side(),
    "wall_right": wall_side().flip_h(),
    "wall_corner_tl": corner_tl(),
    "wall_corner_tr": corner_tl().flip_h(),
    "wall_corner_bl": corner_bl(),
    "wall_corner_br": corner_bl().flip_h(),
    "floor_planks": floor(0),
    "floor_planks_alt": floor(1),
    "table_h_left": table("left"),
    "table_h_mid": table("mid"),
    "table_h_right": table("right"),
    "table_v_top": table_v("top"),
    "table_v_mid": table_v("mid"),
    "table_v_bottom": table_v("bottom"),
    "table_single": table("single"),
    "crate": crate(),
    "window_left": wall_with(window_left),
    "window_right": wall_with(window_right),
    "window_single": wall_with(window_single),
    "notice_board": wall_with(notice),
    "lantern": lantern(),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, art in TILES.items():
        art.image().save(os.path.join(OUT, f"{name}.png"))
    print(len(TILES), "tiles ->", OUT)
