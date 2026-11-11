"""Generate the Manor tileset — a town-interior counterpart of the Dungeon tileset.

Usage: python3 make_manor.py OUT_DIR

Every wall piece follows the Dungeon tileset's geometry exactly (cap rows 0-6,
face rows 7-59, side strips at x 2-16 / 46-61 / 25-40, strip end-caps at rows
40-41) so the dungeon autotiler's piece choices line up. Floors are opaque
64x64 seamless tiles; walls keep the dungeon's transparent surroundings.
Output layout mirrors sprites/dungeon/:
  floors/  walls/room_walls/  walls/junctions/  doors_and_stairs/  rugs/  features/
"""
import os, sys, math, random
import numpy as np
from PIL import Image

N = 64
# ---------------------------------------------------------------- palette
K   = (16, 10, 12)                       # outline / deepest shadow
WD  = [(46, 24, 16), (78, 44, 26), (114, 68, 38), (156, 100, 56), (198, 142, 82), (228, 182, 116)]
PL  = [(140, 120, 98), (184, 166, 136), (214, 200, 170), (236, 226, 202)]   # plaster / cream
WP  = [(58, 20, 28), (92, 30, 38), (122, 44, 48), (156, 66, 62)]           # burgundy wallpaper
GD  = [(122, 82, 26), (184, 136, 48), (230, 186, 74), (252, 228, 140)]     # gilt / brass
MB  = [(52, 50, 58), (98, 96, 104), (156, 154, 158), (204, 202, 198), (236, 234, 228)]  # marble
NV  = [(22, 28, 54), (36, 48, 88), (58, 76, 128)]                          # navy
GR  = [(28, 52, 34), (48, 88, 52), (84, 132, 72), (130, 172, 96)]          # foliage
GL  = [(30, 40, 66), (56, 78, 112), (104, 136, 172), (170, 196, 220)]      # glass
TC  = [(104, 46, 30), (150, 72, 44), (188, 104, 64), (214, 140, 92)]       # terracotta


class Tile:
    def __init__(self, fill=None):
        self.a = np.zeros((N, N, 4), np.uint8)
        if fill is not None:
            self.rect(0, 0, N - 1, N - 1, fill)

    def px(self, x, y, c):
        if 0 <= x < N and 0 <= y < N:
            if c is None:
                self.a[y, x] = 0
            else:
                self.a[y, x, :3] = c; self.a[y, x, 3] = 255

    def rect(self, x0, y0, x1, y1, c):
        for y in range(max(0, y0), min(N - 1, y1) + 1):
            for x in range(max(0, x0), min(N - 1, x1) + 1):
                self.px(x, y, c)

    def hline(self, x0, x1, y, c): self.rect(x0, y, x1, y, c)
    def vline(self, x, y0, y1, c): self.rect(x, y0, x, y1, c)

    def box(self, x0, y0, x1, y1, edge, fill=None):
        if fill is not None: self.rect(x0, y0, x1, y1, fill)
        self.hline(x0, x1, y0, edge); self.hline(x0, x1, y1, edge)
        self.vline(x0, y0, y1, edge); self.vline(x1, y0, y1, edge)

    def shadow(self, cx, cy, rx, ry, alpha=110):
        """Soft translucent floor shadow (like the dungeon pillar / throne)."""
        for y in range(N):
            for x in range(N):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.a[y, x, :3] = K; self.a[y, x, 3] = alpha

    def get(self, x, y):
        return tuple(self.a[y, x, :3]) if self.a[y, x, 3] else None

    def over(self, other):
        m = other.a[..., 3] > 0
        self.a[m] = other.a[m]; return self

    def flip_h(self):
        t = Tile(); t.a = self.a[:, ::-1].copy(); return t

    def save(self, path, shadow=False):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.fromarray(self.a, "RGBA").save(path)


# ================================================================ WALL PARTS
CAP_Y1 = 6
FACE_Y0, FACE_Y1 = 7, 59


def face_px(x, y):
    """Colour of the south-facing wall at tile coords (x, y), rows 7..59.
    Crown moulding, damask wallpaper, chair rail, raised-panel wainscot, skirting."""
    if y == 7:  return K
    if y == 8:  return WD[4]
    if y == 9:  return WD[3]
    if y == 10: return WD[1]
    if y == 11: return WP[0]
    if 12 <= y <= 36:                                   # damask wallpaper
        u, v = x % 16, (y - 12) % 12
        if u in (0, 15) and True:                       # faint stripe
            return WP[0] if u == 0 else WP[1]
        # diamond motif centred at (8, 6)
        d = abs(u - 7.5) + abs(v - 5.5)
        if d <= 1.0: return GD[0]
        if 2.5 <= d <= 3.5: return WP[3] if v < 6 else WP[2]
        return WP[1] if (u + v) % 7 else WP[2]
    if y == 37: return WD[0]
    if y == 38: return WD[5]
    if y == 39: return WD[3]
    if y == 40: return WD[2]
    if y == 41: return WD[0]
    if 42 <= y <= 55:                                   # wainscot panels, 16 px wide
        u = x % 16
        if u in (0, 1) or y in (42, 43, 54, 55):        # stiles & rails
            if u == 0: return WD[1]
            return WD[2] if y not in (54, 55) else WD[1]
        if u == 2 or y == 44: return WD[0]              # recess shadow (top/left)
        if u == 15 or y == 53: return WD[3]             # recess lip (bottom/right)
        if u == 3 or y == 45: return WD[4]              # raised field highlight
        if u == 14 or y == 52: return WD[1]
        return WD[3] if (y + u // 3) % 5 else WD[2]
    if y == 56: return K
    if y == 57: return WD[3]
    if y == 58: return WD[2]
    if y == 59: return WD[1]
    return None


def cap_px(x, y):
    """Wall top seen from above: cream plaster with a moulded edge."""
    if y == 0: return PL[2]
    if y == CAP_Y1: return PL[0]
    if y == CAP_Y1 - 1: return PL[1]
    if x % 32 == 31: return PL[1]                       # faint joint
    return PL[3] if y in (1, 2) and x % 32 < 30 else PL[2]


def face(t, x0, x1, y0=FACE_Y0, y1=FACE_Y1, cap=True, src_y0=None):
    """Paint a wall face over columns x0..x1. src_y0 lets an end-face reuse the lower rows."""
    off = 0 if src_y0 is None else src_y0 - y0
    for x in range(x0, x1 + 1):
        if cap:
            for y in range(0, CAP_Y1 + 1):
                t.px(x, y, cap_px(x, y))
        for y in range(y0, y1 + 1):
            t.px(x, y, face_px(x, y + off))


def strip(t, side, y0=0, y1=63, side_from=None):
    """Vertical wall seen from above. side: 'L' (light 2-10, inner face 11-16),
    'R' (inner face 46-52, light 53-61), 'C' (light 25-33, face 34-40)."""
    lx0, lx1, fx0, fx1 = {"L": (2, 10, 11, 16), "R": (53, 61, 46, 52), "C": (25, 33, 34, 40)}[side]
    sf = y0 if side_from is None else side_from
    for y in range(y0, y1 + 1):
        for x in range(lx0, lx1 + 1):
            c = PL[2]
            if x == lx0: c = PL[1] if side != "R" else PL[3]
            if x == lx1: c = PL[3] if side != "R" else PL[1]
            if y % 32 == 20: c = PL[1]                  # faint joint
            t.px(x, y, c)
        if y >= sf:
            for x in range(fx0, fx1 + 1):
                # inner face of the wall: shaded wallpaper with a wood edge next to the top
                near = (x == fx0) if side != "R" else (x == fx1)
                far = (x == fx1) if side != "R" else (x == fx0)
                if near: c = K
                elif far: c = WD[1]
                else:
                    c = WP[0] if (y // 3 + x) % 4 else WP[1]
                t.px(x, y, c)


def end_cap(t, x0, x1, y):
    """Bottom end of a vertical wall: 2 rows of cap edge, then a short face below."""
    t.hline(x0, x1, y, PL[2]); t.hline(x0, x1, y + 1, PL[0])


# ---------------------------------------------------------------- wall pieces
def wall_top():
    t = Tile(); face(t, 0, 63); return t


def wall_solid():
    """Inside of a thick wall / the void between rooms: flat near-black."""
    return Tile(K)


def wall_left():
    t = Tile(); strip(t, "L"); return t


def wall_right():
    t = Tile(); strip(t, "R"); return t


def corner_tl():
    t = Tile(); face(t, 2, 63); strip(t, "L", side_from=7)
    return t


def corner_tr():
    t = Tile(); face(t, 0, 61); strip(t, "R", side_from=7)
    return t


def corner_bl():
    t = Tile(); face(t, 2, 63); return t


def corner_br():
    t = Tile(); face(t, 0, 61); return t


def divider():
    t = Tile(); strip(t, "C"); return t


def divider_top():
    t = Tile(); strip(t, "C", side_from=7)
    for x in range(25, 41):
        for y in range(0, CAP_Y1 + 1):
            t.px(x, y, cap_px(x, y))
    return t


def divider_end():
    t = Tile(); strip(t, "C", 0, 39)
    end_cap(t, 25, 40, 40)
    face(t, 25, 40, 42, 63, cap=False, src_y0=38)
    t.hline(25, 40, 63, K)
    return t


def t_down():
    t = Tile(); face(t, 0, 63); strip(t, "C", side_from=7); return t


def t_up():
    t = Tile(); face(t, 0, 63); strip(t, "C", 0, 39)
    end_cap(t, 25, 40, 40)
    face(t, 25, 40, 42, 59, cap=False, src_y0=38)
    return t


def cross():
    t = Tile(); face(t, 0, 63); strip(t, "C"); return t


# ---------------------------------------------------------------- face decorations
def wall_window():
    t = wall_top()
    x0, x1, y0, y1 = 22, 41, 13, 47
    # curtains + valance
    for y in range(11, 52):
        for x in list(range(16, 23)) + list(range(41, 48)):
            k = (x - 16) if x < 23 else (47 - x)
            c = [RG := None][0]
            c = WP[2] if k % 3 else WP[3]
            if k == 0: c = WP[0]
            if y > 46 and ((x < 23 and x > 16 + (y - 46)) or (x > 40 and x < 47 - (y - 46))):
                c = None
            if c: t.px(x, y, c)
    # window frame & glass
    t.box(x0, y0, x1, y1, K, WD[2])
    t.box(x0 + 1, y0 + 1, x1 - 1, y1 - 1, WD[3])
    for y in range(y0 + 2, y1 - 1):
        for x in range(x0 + 2, x1 - 1):
            g = GL[1] if (x + y) % 9 else GL[2]
            if y < y0 + 6: g = GL[0]
            t.px(x, y, g)
    # moonlight glints + muntins
    for i in range(4): t.px(x0 + 4 + i, y0 + 10 + i, GL[3])
    t.vline((x0 + x1) // 2, y0 + 2, y1 - 2, WD[1])
    t.hline(x0 + 2, x1 - 2, (y0 + y1) // 2, WD[1])
    # valance with gold trim
    t.rect(15, 9, 48, 12, WP[2]); t.hline(15, 48, 13, GD[2]); t.hline(15, 48, 9, WP[0])
    for x in range(16, 48, 4): t.px(x, 14, GD[1])
    # sill
    t.rect(x0 - 2, y1 + 1, x1 + 2, y1 + 2, PL[2]); t.hline(x0 - 2, x1 + 2, y1 + 3, PL[0])
    return t


def wall_tapestry():
    t = wall_top()
    x0, x1 = 21, 42
    t.rect(x0 - 3, 10, x1 + 3, 11, GD[1]); t.px(x0 - 4, 10, GD[2]); t.px(x1 + 4, 10, GD[2])
    t.hline(x0 - 3, x1 + 3, 12, GD[0])
    for y in range(13, 56):
        # pointed (swallow-tail) bottom
        mid = (x0 + x1) / 2
        for x in range(x0, x1 + 1):
            depth = 48 + abs(x - mid) * 0.45
            if y > depth: continue
            edge = x in (x0, x1) or y > depth - 1
            c = K if edge else NV[1]
            if not edge and (x in (x0 + 2, x1 - 2) or y == 15): c = GD[1]
            if not edge and x in (x0 + 1, x1 - 1): c = NV[0]
            t.px(x, y, c)
    # heraldic key emblem
    cx = (x0 + x1) // 2
    for (dx, dy) in [(-2, 0), (-1, 0), (0, 0), (1, 0), (2, 0), (-3, 1), (3, 1), (-3, 2), (3, 2), (-3, 3), (3, 3),
                     (-2, 4), (-1, 4), (0, 4), (1, 4), (2, 4)]:
        t.px(cx + dx, 21 + dy, GD[2])
    t.rect(cx, 26, cx, 41, GD[2]); t.px(cx + 1, 26, GD[1])
    t.rect(cx + 1, 37, cx + 3, 37, GD[2]); t.rect(cx + 1, 40, cx + 3, 40, GD[2]); t.px(cx + 3, 38, GD[1])
    for x in range(x0 + 3, x1 - 2, 3): t.px(x, 45, GD[0])
    return t


def arch_mask(cx, x0, x1, ytop, yspring):
    """Opening: rectangle below yspring, semicircle above to ytop."""
    r = (x1 - x0 + 1) / 2

    def inside(x, y):
        if y >= yspring: return x0 <= x <= x1
        dy = yspring - y
        return (x + 0.5 - (x0 + r)) ** 2 + dy ** 2 <= r * r and y >= ytop
    return inside


def wall_archway(gate=False):
    t = wall_top()
    x0, x1, ytop, ysp = 20, 43, 13, 25
    inside = arch_mask(None, x0, x1, ytop, ysp)
    outer = arch_mask(None, x0 - 4, x1 + 4, ytop - 4, ysp)
    for y in range(7, 64):
        for x in range(0, 64):
            if inside(x, y):
                t.px(x, y, None)                         # open passage (dark)
            elif outer(x, y) and y <= 59:
                ring = (x - (x0 - 4)) if x < 32 else ((x1 + 4) - x)
                c = PL[2] if ring > 1 else PL[1]
                if ring == 0: c = K
                if y >= ysp and ring == 3: c = PL[0]
                # voussoir joints on the curve
                if y < ysp and (x * 3 + y * 5) % 11 == 0: c = PL[1]
                t.px(x, y, c)
    # keystone in gilt
    t.rect(30, ytop - 4, 33, ytop, GD[1]); t.hline(30, 33, ytop - 4, GD[2]); t.vline(33, ytop - 3, ytop, GD[0])
    if gate:
        for x in range(x0 + 1, x1, 4):
            for y in range(ytop, 60):
                if inside(x, y): t.px(x, y, MB[0])
                if inside(x + 1, y) and inside(x, y): t.px(x + 1, y, K)
            # spear finials
            yt = next(y for y in range(ytop, 60) if inside(x, y))
            t.px(x, yt, GD[2])
        for y in (34, 46, 57):
            for x in range(x0, x1 + 1):
                if inside(x, y): t.px(x, y, MB[1] if y != 57 else MB[0])
                if inside(x, y + 1): t.px(x, y + 1, K)
        # scrollwork between rails
        for x in range(x0 + 3, x1 - 1, 4):
            t.px(x, 40, GD[1]); t.px(x - 1, 39, GD[1]); t.px(x + 1, 41, GD[1])
    return t


def door():
    t = wall_top()
    x0, x1, y0 = 19, 44, 14
    # pediment & frame
    t.rect(x0 - 4, y0 - 4, x1 + 4, y0 - 2, WD[3]); t.hline(x0 - 4, x1 + 4, y0 - 5, K)
    t.hline(x0 - 4, x1 + 4, y0 - 4, WD[5]); t.hline(x0 - 4, x1 + 4, y0 - 1, K)
    for x in range(x0 + 4, x1 - 3, 3): t.px(x, y0 - 3, GD[1])
    t.rect(x0 - 3, y0, x0 - 1, 63, WD[3]); t.vline(x0 - 3, y0, 63, WD[4]); t.vline(x0 - 1, y0, 63, WD[1])
    t.rect(x1 + 1, y0, x1 + 3, 63, WD[2]); t.vline(x1 + 3, y0, 63, WD[1]); t.vline(x1 + 1, y0, 63, WD[0])
    t.vline(x0 - 4, y0 - 4, 63, K); t.vline(x1 + 4, y0 - 4, 63, K)
    # double leaves with raised panels
    t.rect(x0, y0, x1, 63, WD[2])
    mid = (x0 + x1) // 2
    t.vline(mid, y0, 63, K); t.vline(mid + 1, y0, 63, WD[1])
    for (a, b) in ((x0 + 2, mid - 2), (mid + 3, x1 - 2)):
        for (p0, p1) in ((y0 + 3, y0 + 21), (y0 + 25, 59)):
            t.rect(a, p0, b, p1, WD[3])
            t.hline(a, b, p0, WD[1]); t.vline(a, p0, p1, WD[1])
            t.hline(a, b, p1, WD[4]); t.vline(b, p0, p1, WD[4])
            t.rect(a + 2, p0 + 2, b - 2, p1 - 2, WD[2])
            t.vline(a + 2, p0 + 2, p1 - 2, WD[4])
    # brass handles
    for hx in (mid - 3, mid + 4):
        t.rect(hx, 38, hx, 42, GD[2]); t.px(hx, 43, GD[0]); t.px(hx, 37, GD[1])
    t.hline(x0, x1, 63, K)
    return t


# ================================================================ FLOORS
def floor_planks():
    t = Tile()
    rng = random.Random(3)
    for b in range(8):
        x0 = b * 8
        joint = (b * 23) % 64
        shade = [2, 3, 3, 2, 3, 2, 3, 3][b]
        for y in range(64):
            for x in range(x0, x0 + 8):
                c = WD[shade]
                if x == x0: c = WD[0]
                elif x == x0 + 1: c = WD[shade + 1]
                elif (y * 3 + x * 7 + b) % 17 == 0: c = WD[shade - 1]
                if y == joint: c = WD[0]
                if y == (joint + 1) % 64 and x > x0: c = WD[shade + 1]
                t.px(x, y, c)
        t.px(x0 + 3, (joint + 2) % 64, K); t.px(x0 + 3, (joint - 2) % 64, K)  # pegs
    return t


def floor_parquet():
    t = Tile()
    for by in range(4):
        for bx in range(4):
            horiz = (bx + by) % 2 == 0
            for v in range(16):
                for u in range(16):
                    x, y = bx * 16 + u, by * 16 + v
                    s = (v if horiz else u)          # strip coordinate across the grain
                    k = s // 4                        # 4 slats per block
                    c = WD[[3, 2, 3, 4][k]]
                    if s % 4 == 0: c = WD[1]
                    if (u == 0) or (v == 0): c = K if (u == 0 and v == 0) else WD[0]
                    t.px(x, y, c)
    return t


def floor_herringbone():
    t = Tile()
    for y in range(64):
        for x in range(64):
            # 45-degree herringbone made of 4x12 boards
            col = x // 8
            if col % 2 == 0:
                s = (y + x) % 16
                lane = (x % 8)
            else:
                s = (y - x) % 16
                lane = 7 - (x % 8)
            c = WD[3] if ((x // 8 + (y + (x % 8 if col % 2 == 0 else -(x % 8))) // 8) % 2) else WD[2]
            if s == 0: c = WD[0]
            if lane == 0: c = WD[1]
            if lane == 1 and s != 0: c = WD[4]
            t.px(x, y, c)
    return t


def floor_checker():
    t = Tile()
    for y in range(64):
        for x in range(64):
            white = ((x // 16) + (y // 16)) % 2 == 0
            u, v = x % 16, y % 16
            c = MB[4] if white else MB[0]
            vein = (u * 2 + v + (x // 16) * 5) % 13 == 0 and 2 < u < 14
            if vein: c = MB[3] if white else MB[1]
            if u == 0 or v == 0: c = MB[2] if white else K
            if white and (u == 15 or v == 15): c = MB[3]
            t.px(x, y, c)
    return t


def floor_marble():
    t = Tile()
    for y in range(64):
        for x in range(64):
            u, v = x % 32, y % 32
            c = MB[3]
            w = math.sin((x + y * 0.6) / 5.5) + math.sin((x * 0.4 - y) / 9.0)
            if abs(w - 0.6) < 0.08: c = MB[2]
            if abs(w + 0.9) < 0.05: c = MB[1]
            if (x * 7 + y * 13) % 29 == 0: c = MB[4]
            if u == 0 or v == 0: c = MB[1]
            if u == 1 or v == 1: c = MB[4]
            t.px(x, y, c)
    return t


def floor_carpet():
    t = Tile()
    for y in range(64):
        for x in range(64):
            u, v = x % 16, y % 16
            d = abs(u - 7.5) + abs(v - 7.5)
            c = WP[2]
            if (x + y) % 2 == 0 and d > 7: c = WP[1]
            if 6.5 <= d <= 7.5: c = GD[1]
            if d <= 1.5: c = GD[2]
            if 3 <= d <= 3.5: c = NV[1]
            t.px(x, y, c)
    return t


def floor_tiles():
    t = Tile()
    for y in range(64):
        for x in range(64):
            u, v = x % 16, y % 16
            tile_shade = [2, 1, 2, 3][((x // 16) * 3 + (y // 16)) % 4]
            c = TC[tile_shade]
            if u == 0 or v == 0: c = PL[1]
            elif u == 1 or v == 1: c = TC[min(3, tile_shade + 1)]
            elif u == 15 or v == 15: c = TC[0]
            # small cream diamond inset at tile corners
            if (u in (0, 1) or u == 15) and (v in (0, 1) or v == 15): c = PL[3]
            t.px(x, y, c)
    return t


# ================================================================ DOORS & STAIRS
def stairs(up=False):
    t = Tile(K)
    # balustrade sides
    for side in (0, 1):
        xa, xb = (0, 9) if side == 0 else (54, 63)
        t.rect(xa, 0, xb, 63, WD[2])
        t.vline(xa if side == 0 else xb, 0, 63, K)
        t.vline(xb if side == 0 else xa, 0, 63, WD[0])
        t.vline(xa + 2 if side == 0 else xb - 2, 0, 63, WD[4])
        for y in range(3, 64, 10):
            t.rect(xa + 3, y, xb - 3, y + 2, GD[1] if side == 0 else GD[0])
    n = 6
    for i in range(n):
        y0 = 2 + i * 10
        lvl = i if up else (n - 1 - i)                 # light at the top for up, at the near end for down
        bright = 4 - min(4, (n - 1 - lvl) * 4 // (n - 1))
        tread = [WD[1], WD[2], WD[3], WD[4], WD[5]][bright]
        rise = [K, WD[0], WD[1], WD[2], WD[3]][bright]
        t.rect(10, y0, 53, y0 + 6, tread)
        t.hline(10, 53, y0, [WD[2], WD[3], WD[4], WD[5], WD[5]][bright])
        t.rect(10, y0 + 7, 53, y0 + 9, rise)
        # red runner with brass rod
        carpet = [WP[0], WP[1], WP[2], WP[3], WP[3]][bright]
        t.rect(20, y0, 43, y0 + 9, carpet)
        t.hline(20, 43, y0 + 7, [K, WP[0], WP[0], WP[1], WP[1]][bright])
        t.vline(21, y0, y0 + 9, GD[0]); t.vline(42, y0, y0 + 9, GD[0])
        t.hline(18, 45, y0 + 6, GD[min(3, bright)])
    if not up:
        t.rect(10, 60, 53, 63, K)
    else:
        t.rect(10, 0, 53, 1, PL[3])
    return t


def ladder(up=False):
    t = floor_planks()
    x0, x1, y0, y1 = 12, 51, 6, 57
    if up:
        # ceiling hatch above: lit opening framed in plaster
        t.rect(x0, y0, x1, y1, WD[1])
        t.box(x0 - 2, y0 - 2, x1 + 2, y1 + 2, K)
        t.rect(x0, y0, x1, y0 + 14, PL[3]); t.rect(x0, y0 + 15, x1, y0 + 18, PL[1])
        t.rect(x0, y0 + 19, x1, y1, WD[0])
    else:
        t.rect(x0, y0, x1, y1, K)
        t.box(x0 - 2, y0 - 2, x1 + 2, y1 + 2, WD[0])
        t.box(x0 - 1, y0 - 1, x1 + 1, y1 + 1, WD[4])
        # hinged trapdoor lid laid open on the left
        t.rect(0, y0 + 4, x0 - 3, y1 - 4, WD[3]); t.vline(x0 - 3, y0 + 4, y1 - 4, WD[0])
        for y in (y0 + 10, y1 - 10): t.hline(1, x0 - 4, y, MB[1])
    # ladder rails + rungs
    for rx in (20, 42):
        t.rect(rx, y0, rx + 2, y1, WD[3]); t.vline(rx, y0, y1, WD[4]); t.vline(rx + 2, y0, y1, WD[1])
    for i, y in enumerate(range(y0 + 4, y1 - 1, 8)):
        shade = WD[4] if (up and i < 2) else WD[3]
        t.rect(23, y, 41, y + 1, shade); t.hline(23, 41, y + 2, K if not up else WD[0])
    if not up:
        for y in range(y1 - 14, y1 + 1):                # fade into the dark below
            for x in range(20, 45):
                if (x + y) % 2 == 0 and y > y1 - 8 and t.get(x, y) != K: t.px(x, y, WD[0])
    return t


# ================================================================ RUGS (9-slice)
M = 6          # floor margin around the rug's outer edge


def rug_px(x, y, l, r, tp, b):
    """Rug colour at tile coords, given which sides are the rug's outer edge.
    Returns None outside the rug."""
    dl = x - M if l else 99
    dr = (63 - M) - x if r else 99
    dt = y - M if tp else 99
    db = (63 - M) - y if b else 99
    d = min(dl, dr, dt, db)
    if d < 0: return None
    if d == 0: return K
    if d in (1, 2): return GD[1] if d == 1 else GD[0]
    if 3 <= d <= 7:
        along = y if d in (dl, dr) else x
        if d == 5 and along % 4 == 0: return GD[2]
        return NV[1] if d in (4, 5, 6) else NV[0]
    if d == 8: return GD[1]
    # field: deep red with a lattice of small medallions (repeats every 16 px)
    u, v = x % 16, y % 16
    dd = abs(u - 7.5) + abs(v - 7.5)
    if dd <= 1.5: return GD[2]
    if 4.5 <= dd <= 5.5: return NV[2] if (u + v) % 2 else NV[1]
    if dd >= 7.5: return WP[1]
    return WP[2]


def rug(l, r, tp, b, single=False):
    t = Tile()
    for y in range(64):
        for x in range(64):
            c = rug_px(x, y, l, r, tp, b)
            if c is not None: t.px(x, y, c)
    if single or (l and r) or (tp and b):
        pass
    # fringe on the rug's top and bottom outer edges
    for x in range(64):
        if tp and rug_px(x, M, l, r, tp, b) is not None and x % 2 == 0:
            for y in range(M - 3, M): t.px(x, y, PL[3] if y > M - 3 else PL[1])
        if b and rug_px(x, 63 - M, l, r, tp, b) is not None and x % 2 == 0:
            for y in range(64 - M, 67 - M): t.px(x, y, PL[3] if y < 66 - M else PL[1])
    return t


# ================================================================ FEATURES
def column():
    t = Tile()
    # soft floor shadow
    t.shadow(32, 60, 19, 3.5)
    x0, x1 = 20, 43
    # base (plinth + torus)
    t.rect(16, 52, 47, 59, MB[3]); t.hline(16, 47, 52, MB[4]); t.hline(16, 47, 59, MB[1]); t.vline(47, 52, 59, MB[2])
    t.box(16, 52, 47, 59, K)
    t.rect(18, 47, 45, 51, MB[3]); t.hline(18, 45, 47, MB[4]); t.hline(18, 45, 51, MB[1]); t.box(18, 47, 45, 51, K)
    # fluted shaft
    for y in range(12, 47):
        for x in range(x0, x1 + 1):
            u = (x - x0) % 4
            c = [MB[2], MB[4], MB[3], MB[2]][u]
            if x > x1 - 5: c = MB[1] if u in (0, 3) else MB[2]
            if x < x0 + 3: c = MB[3] if u else MB[2]
            t.px(x, y, c)
        t.px(x0 - 1, y, K); t.px(x1 + 1, y, K)
    # gilt necking + capital (abacus)
    t.rect(x0, 10, x1, 11, GD[1]); t.hline(x0, x1, 11, GD[0])
    t.rect(17, 4, 46, 9, MB[3]); t.hline(17, 46, 4, MB[4]); t.hline(17, 46, 9, MB[1])
    for (vx) in (18, 45):                               # volutes
        t.rect(vx - 1, 5, vx + 1, 8, GD[1]); t.px(vx, 6, GD[3]); t.px(vx, 7, GD[0])
    t.box(16, 3, 47, 10, K)
    t.hline(16, 47, 0, K); t.rect(17, 1, 46, 2, MB[2])
    return t


def potted_plant():
    t = Tile()
    t.shadow(32, 57.5, 14, 3.5)
    # urn
    for y in range(38, 58):
        w = 10 if y < 42 else int(11 - (y - 42) * 0.35)
        for x in range(32 - w, 32 + w):
            c = TC[2] if x < 30 else TC[1]
            if x < 32 - w + 2: c = TC[3]
            if x > 32 + w - 3: c = TC[0]
            t.px(x, y, c)
        t.px(32 - w - 1, y, K); t.px(32 + w, y, K)
    t.rect(20, 37, 43, 40, TC[3]); t.hline(20, 43, 37, PL[3]); t.hline(20, 43, 41, TC[0]); t.box(20, 36, 43, 41, K)
    t.hline(23, 41, 47, GD[1]); t.hline(24, 40, 48, GD[0])
    t.hline(25, 39, 57, K)
    # fern fronds
    rng = random.Random(11)
    fronds = [(-1.9, 20), (-1.3, 25), (-0.8, 27), (-0.3, 28), (0.25, 28), (0.75, 27), (1.25, 25), (1.85, 20), (-2.5, 13), (2.5, 13)]
    for ang, L in fronds:
        for i in range(L):
            fx = 32 + math.sin(ang) * i * 0.95
            fy = 36 - math.cos(ang) * i * 0.85 + (i * i) * 0.012 * abs(ang) * 2
            px, py = int(round(fx)), int(round(fy))
            t.px(px, py, GR[1]); t.px(px, py + 1, GR[0])
            if i % 3 == 1 and i > 2:                    # leaflets
                for s in (-1, 1):
                    lx = px + int(round(math.cos(ang) * 2 * s)); ly = py + int(round(math.sin(ang) * 2 * s))
                    t.px(lx, ly, GR[2]); t.px(lx + (1 if s > 0 else -1), ly, GR[3] if i < L - 4 else GR[2])
    return t


def grand_chair():
    t = Tile()
    t.shadow(32, 59.5, 23, 3.6)
    # tall carved back
    t.rect(16, 4, 47, 40, WD[2]); t.box(16, 4, 47, 40, K)
    t.rect(17, 5, 46, 6, WD[4]); t.vline(17, 5, 39, WD[3]); t.vline(46, 5, 39, WD[1])
    # crest: gilt arch + finials
    for x in range(20, 44):
        y = int(4 - 3 * math.sin(math.pi * (x - 20) / 23))
        t.rect(x, y, x, 4, GD[1]); t.px(x, y, GD[2])
    t.px(31, 0, GD[3]); t.px(32, 0, GD[3]); t.rect(31, 1, 32, 1, GD[1])
    for fx in (16, 46):
        t.rect(fx - 1, 1, fx + 1, 4, GD[1]); t.px(fx, 0, GD[3]); t.px(fx + 1, 3, GD[0])
    # tufted velvet back panel
    t.rect(21, 9, 42, 36, WP[2]); t.box(20, 8, 43, 37, GD[1])
    for y in range(12, 36, 6):
        for x in range(24 + (y // 6 % 2) * 3, 41, 6):
            t.px(x, y, WP[0]); t.px(x, y - 1, WP[3])
    t.vline(21, 9, 36, WP[3]); t.vline(42, 9, 36, WP[1])
    # arms
    for ax, s in ((10, 1), (47, -1)):
        t.rect(ax, 30, ax + 6, 46, WD[2]); t.box(ax, 30, ax + 6, 46, K)
        t.rect(ax, 29, ax + 6, 31, WD[4]); t.hline(ax, ax + 6, 29, K)
        t.rect(ax + 2, 32, ax + 4, 34, GD[2])
    # seat cushion
    t.rect(16, 38, 47, 46, WP[2]); t.hline(16, 47, 38, WP[3]); t.hline(16, 47, 46, WP[0]); t.box(15, 37, 48, 47, K)
    t.hline(17, 46, 42, GD[0])
    # apron + legs
    t.rect(14, 48, 49, 52, WD[2]); t.hline(14, 49, 48, WD[4]); t.box(13, 47, 50, 53, K)
    for x in range(18, 47, 6): t.px(x, 50, GD[1])
    for lx in (14, 46):
        t.rect(lx, 54, lx + 3, 59, WD[1]); t.box(lx, 54, lx + 3, 60, K); t.px(lx + 1, 55, WD[3])
    return t


# ================================================================ BUILD
TILES = {
    "floors/floor_planks.png": floor_planks,
    "floors/floor_parquet.png": floor_parquet,
    "floors/floor_herringbone.png": floor_herringbone,
    "floors/floor_checker.png": floor_checker,
    "floors/floor_marble.png": floor_marble,
    "floors/floor_carpet.png": floor_carpet,
    "floors/floor_tiles.png": floor_tiles,
    "walls/room_walls/wall_top.png": wall_top,
    "walls/room_walls/wall_left.png": wall_left,
    "walls/room_walls/wall_solid.png": wall_solid,
    "walls/room_walls/wall_right.png": wall_right,
    "walls/room_walls/wall_window.png": wall_window,
    "walls/room_walls/wall_tapestry.png": wall_tapestry,
    "doors_and_stairs/wall_archway.png": wall_archway,
    "doors_and_stairs/wall_gate.png": lambda: wall_archway(gate=True),
    "walls/junctions/wall_corner_tl.png": corner_tl,
    "walls/junctions/wall_corner_tr.png": corner_tr,
    "walls/junctions/wall_corner_bl.png": corner_bl,
    "walls/junctions/wall_corner_br.png": corner_br,
    "walls/junctions/wall_divider.png": divider,
    "walls/junctions/wall_divider_top.png": divider_top,
    "walls/junctions/wall_divider_end.png": divider_end,
    "walls/junctions/wall_t_down.png": t_down,
    "walls/junctions/wall_t_up.png": t_up,
    "walls/junctions/wall_cross.png": cross,
    "doors_and_stairs/door.png": door,
    "doors_and_stairs/stairs.png": lambda: stairs(False),
    "doors_and_stairs/stairs_up.png": lambda: stairs(True),
    "doors_and_stairs/ladder_down.png": lambda: ladder(False),
    "doors_and_stairs/ladder_up.png": lambda: ladder(True),
    "rugs/rug.png": lambda: rug(1, 1, 1, 1),
    "rugs/rug_corner_tl.png": lambda: rug(1, 0, 1, 0),
    "rugs/rug_top.png": lambda: rug(0, 0, 1, 0),
    "rugs/rug_corner_tr.png": lambda: rug(0, 1, 1, 0),
    "rugs/rug_left.png": lambda: rug(1, 0, 0, 0),
    "rugs/rug_centre.png": lambda: rug(0, 0, 0, 0),
    "rugs/rug_right.png": lambda: rug(0, 1, 0, 0),
    "rugs/rug_corner_bl.png": lambda: rug(1, 0, 0, 1),
    "rugs/rug_bottom.png": lambda: rug(0, 0, 0, 1),
    "rugs/rug_corner_br.png": lambda: rug(0, 1, 0, 1),
    "rugs/rug_runner.png": lambda: rug(1, 1, 0, 0),
    "features/column.png": column,
    "features/potted_plant.png": potted_plant,
    "features/grand_chair.png": grand_chair,
}

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    for rel, fn in TILES.items():
        fn().save(os.path.join(out, rel))
    print(len(TILES), "tiles ->", out)
