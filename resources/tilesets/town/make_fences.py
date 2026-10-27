"""Wood and stone fence sets that connect like the path pieces.

Usage: python3 make_fences.py OUT_DIR

Each set has six pieces: straight_h, straight_v and the four bends
(tl = right+down, tr = left+down, bl = up+right, br = up+left). The
fence line runs through the middle of the tile, so pieces join on any
side. Drawn on a 32x32 grid and scaled 2x like the shop/dungeon art,
with a dark outline round every part.

  wood:  a post in the middle of every tile with two rails; seen end-on
         (vertical runs) the rails become two strips past the post
  stone: a low wall with a light cap on top and a block face in front;
         vertical runs show the cap only, the way the dungeon's side
         walls do, and a bend's face continues under the cap
"""
import os, sys
from PIL import Image

N = 32
CLEAR = None

WOOD = {"line": (40, 26, 14), "dark": (88, 56, 30), "main": (146, 98, 56), "light": (212, 170, 110)}
STONE = {"line": (40, 38, 36), "dark": (92, 88, 82), "main": (160, 154, 142), "light": (222, 216, 204)}

PIECES = ("straight_h", "straight_v", "bend_tl", "bend_tr", "bend_bl", "bend_br")


def arms(piece):
    """Which sides the fence leaves the tile by: (up, down, left, right)."""
    return {
        "straight_h": (False, False, True, True),
        "straight_v": (True, True, False, False),
        "bend_tl": (False, True, False, True),
        "bend_tr": (False, True, True, False),
        "bend_bl": (True, False, False, True),
        "bend_br": (True, False, True, False),
    }[piece]


class Art:
    def __init__(self):
        self.px = [[CLEAR] * N for _ in range(N)]

    def rect(self, x0, y0, x1, y1, c):
        for y in range(max(0, y0), min(N - 1, y1) + 1):
            for x in range(max(0, x0), min(N - 1, x1) + 1):
                self.px[y][x] = c

    def outline(self, col):
        """Clear pixels next to a filled one become the outline colour
        (pixels past the tile edge never count, so runs join cleanly)."""
        add = []
        for y in range(N):
            for x in range(N):
                if self.px[y][x] is not CLEAR:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    X, Y = x + dx, y + dy
                    if 0 <= X < N and 0 <= Y < N and self.px[Y][X] not in (CLEAR, col):
                        add.append((x, y)); break
        for x, y in add:
            self.px[y][x] = col

    def image(self):
        im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        im.putdata([(c + (255,)) if c else (0, 0, 0, 0) for row in self.px for c in row])
        return im.resize((N * 2, N * 2), Image.NEAREST)


# ── wood ──────────────────────────────────────────────────────────
POST_X0, POST_X1, POST_Y0, POST_Y1 = 14, 17, 7, 18
RAILS_Y = ((9, 10), (14, 15))          # horizontal rails (light row, main row)
RAILS_X = ((12, 13), (18, 19))         # vertical rails (light col, main col)


def wood(piece):
    up, down, left, right = arms(piece)
    p = WOOD
    a = Art()
    # rails running sideways
    for (yl, ym) in RAILS_Y:
        if left:
            a.rect(0, yl, POST_X0 - 1, yl, p["light"]); a.rect(0, ym, POST_X0 - 1, ym, p["main"])
        if right:
            a.rect(POST_X1 + 1, yl, N - 1, yl, p["light"]); a.rect(POST_X1 + 1, ym, N - 1, ym, p["main"])
    # rails running away from / toward the viewer
    for (xl, xm) in RAILS_X:
        if up:
            a.rect(xl, 0, xl, POST_Y0 - 1, p["light"]); a.rect(xm, 0, xm, POST_Y0 - 1, p["main"])
        if down:
            a.rect(xl, POST_Y1 + 1, xl, N - 1, p["light"]); a.rect(xm, POST_Y1 + 1, xm, N - 1, p["main"])
    # grain on the sideways rails
    for x in range(N):
        if x % 7 == 3 and (left and x < POST_X0 or right and x > POST_X1):
            a.rect(x, RAILS_Y[0][1], x, RAILS_Y[0][1], p["dark"])
        if x % 9 == 5 and (left and x < POST_X0 or right and x > POST_X1):
            a.rect(x, RAILS_Y[1][1], x, RAILS_Y[1][1], p["dark"])
    a.outline(p["line"])
    # the post: lit top, lit left edge, shaded right edge, a nail per rail
    a.rect(POST_X0 - 1, POST_Y0 - 1, POST_X1 + 1, POST_Y1 + 1, p["line"])
    a.rect(POST_X0, POST_Y0, POST_X1, POST_Y1, p["main"])
    a.rect(POST_X0, POST_Y0, POST_X1, POST_Y0 + 1, p["light"])
    a.rect(POST_X0, POST_Y0 + 2, POST_X0, POST_Y1, p["light"])
    a.rect(POST_X1, POST_Y0 + 2, POST_X1, POST_Y1, p["dark"])
    for (yl, ym) in RAILS_Y:
        a.rect(POST_X0 + 1, ym, POST_X0 + 1, ym, p["line"])
    return a


# ── stone ─────────────────────────────────────────────────────────
SX0, SX1 = 13, 18                      # cap strip of a vertical run
CAP0, CAP1 = 6, 11                     # cap rows of a horizontal run
FACE1 = 19                             # front face rows CAP1+1 .. FACE1


def cap_texture(a, x0, y0, x1, y1, p, horizontal):
    a.rect(x0, y0, x1, y1, p["light"])
    if horizontal:
        for x in range(x0, x1 + 1):
            if x % 8 == 0:
                a.rect(x, y0, x, y1, p["main"])            # joints between cap stones
            if x % 8 == 4:
                a.rect(x, y0 + 2, x, y0 + 2, p["main"])     # pits
    else:
        for y in range(y0, y1 + 1):
            if y % 8 == 0:
                a.rect(x0, y, x1, y, p["main"])
            if y % 8 == 4:
                a.rect(x0 + 2, y, x0 + 2, y, p["main"])


def face_texture(a, x0, x1, p):
    y0, y1 = CAP1 + 1, FACE1
    a.rect(x0, y0, x1, y1, p["main"])
    a.rect(x0, y0, x1, y0, p["dark"])                       # shadow under the cap
    mid = (y0 + 1 + y1) // 2
    a.rect(x0, mid, x1, mid, p["dark"])                     # bed joint
    for x in range(x0, x1 + 1):
        if x % 8 == 2:
            a.rect(x, y0 + 1, x, mid - 1, p["dark"])
            if x + 1 <= x1:
                a.rect(x + 1, y0 + 1, x + 1, y0 + 1, p["light"])
        if x % 8 == 6:
            a.rect(x, mid + 1, x, y1, p["dark"])
            if x + 1 <= x1:
                a.rect(x + 1, mid + 1, x + 1, mid + 1, p["light"])


def stone(piece):
    up, down, left, right = arms(piece)
    p = STONE
    a = Art()
    hx0 = 0 if left else SX0
    hx1 = N - 1 if right else SX1
    has_h = left or right
    if has_h:
        # the face shows wherever no vertical run comes toward the viewer
        if down:
            if left:
                face_texture(a, 0, SX0 - 1, p)
            if right:
                face_texture(a, SX1 + 1, N - 1, p)
        else:
            face_texture(a, hx0, hx1, p)
        cap_texture(a, hx0, CAP0, hx1, CAP1, p, True)
    if up or down:
        y0 = 0 if up else CAP0
        y1 = N - 1 if down else CAP1
        cap_texture(a, SX0, y0, SX1, y1, p, False)
        if has_h:
            cap_texture(a, SX0, CAP0, SX1, CAP1, p, True)     # the corner stone
            a.rect(SX0, CAP0, SX1, CAP1, p["light"])
            a.rect(SX0 + 2, CAP0 + 2, SX0 + 2, CAP0 + 2, p["main"])
    if down and has_h:
        # the run coming toward the viewer casts a shade on the face beside it
        if left:
            a.rect(SX0 - 1, CAP1 + 1, SX0 - 1, FACE1, p["dark"])
        if right:
            a.rect(SX1 + 1, CAP1 + 1, SX1 + 1, FACE1, p["dark"])
    a.outline(p["line"])
    return a


# ── gates (walkable) ──────────────────────────────────────────────
IRON = {"line": (24, 24, 30), "main": (66, 68, 80), "light": (140, 146, 164)}


def wood_post(a, x0, y0, x1, y1, p):
    a.rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, p["line"])
    a.rect(x0, y0, x1, y1, p["main"])
    a.rect(x0, y0, x1, y0 + 1, p["light"])
    a.rect(x0, y0 + 2, x0, y1, p["light"])
    a.rect(x1, y0 + 2, x1, y1, p["dark"])


def wood_gate_h():
    """Two posts near the tile edges, a braced plank gate between."""
    p = WOOD
    a = Art()
    for (yl, ym) in RAILS_Y:                      # rail stubs to the neighbours
        a.rect(0, yl, 2, yl, p["light"]); a.rect(0, ym, 2, ym, p["main"])
        a.rect(29, yl, 31, yl, p["light"]); a.rect(29, ym, 31, ym, p["main"])
    a.rect(9, 8, 22, 17, p["main"])               # the gate leaf
    a.rect(9, 8, 22, 8, p["light"])
    for x in range(9, 23):
        if x % 3 == 0:
            a.rect(x, 9, x, 17, p["dark"])        # board seams
    a.rect(9, 10, 22, 10, p["light"]); a.rect(9, 15, 22, 15, p["light"])   # ledges
    for k in range(4):                            # brace
        a.rect(10 + 3 * k, 14 - k, 12 + 3 * k, 14 - k, p["light"])
    a.outline(p["line"])
    a.rect(20, 12, 21, 12, IRON["light"])         # latch
    wood_post(a, 4, POST_Y0 - 1, 6, POST_Y1, p)
    wood_post(a, 25, POST_Y0 - 1, 27, POST_Y1, p)
    return a


def wood_gate_v():
    """Seen end-on: a short post at each end, the gate's top edge between."""
    p = WOOD
    a = Art()
    a.rect(14, 10, 17, 22, p["main"])             # top edge of the leaf
    a.rect(14, 10, 14, 22, p["light"]); a.rect(17, 10, 17, 22, p["dark"])
    for y in range(11, 22, 3):
        a.rect(15, y, 16, y, p["dark"])           # board ends
    a.outline(p["line"])
    wood_post(a, 14, 1, 17, 9, p)
    wood_post(a, 14, 21, 17, 30, p)
    a.rect(14, 25, 15, 25, IRON["light"])         # latch
    return a


def pillar(a, x0, x1, top, p, bottom=FACE1):
    """Stone gate pillar: taller cap, block face down to the wall's foot."""
    a.rect(x0, top, x1, top + 4, p["light"])
    a.rect(x0, top + 5, x1, bottom, p["main"])
    a.rect(x0, top + 5, x1, top + 5, p["dark"])
    for y in range(top + 9, bottom, 4):
        a.rect(x0, y, x1, y, p["dark"])
    a.rect(x0, top + 6, x0, bottom, p["light"])
    a.rect(x1, top + 6, x1, bottom, p["dark"])
    a.rect(x0 + 2, top + 2, x1 - 2, top + 2, p["main"])


def iron_bars_h(a, x0, x1, y0, y1):
    for x in range(x0, x1 + 1):
        if (x - x0) % 3 == 1:
            a.rect(x, y0, x, y1, IRON["main"])
            a.rect(x, y0 - 1, x, y0 - 1, IRON["light"])   # spear tips
    a.rect(x0, y0 + 1, x1, y0 + 1, IRON["main"]); a.rect(x0, y1 - 1, x1, y1 - 1, IRON["main"])
    a.rect(x0, y0 + 1, x1, y0 + 1, IRON["light"])


def stone_gate_h():
    p = STONE
    a = Art()
    iron_bars_h(a, 9, 22, 9, FACE1)
    a.outline(IRON["line"])
    b = Art()
    face_texture(b, 0, 3, p); cap_texture(b, 0, CAP0, 3, CAP1, p, True)
    face_texture(b, 28, 31, p); cap_texture(b, 28, CAP0, 31, CAP1, p, True)
    pillar(b, 3, 8, 3, p)
    pillar(b, 23, 28, 3, p)
    b.outline(p["line"])
    for y in range(N):                             # pillars over the bars
        for x in range(N):
            if b.px[y][x] is not CLEAR:
                a.px[y][x] = b.px[y][x]
    return a


def stone_gate_v():
    """Seen end-on: a pillar each side of the opening, the iron gate's
    edge between them; the far pillar shows its face, the near one its cap."""
    p = STONE
    a = Art()
    a.rect(15, 12, 16, 21, IRON["main"])
    a.rect(15, 12, 15, 21, IRON["light"])
    for y in range(13, 21, 3):
        a.rect(14, y, 17, y, IRON["main"])
    a.outline(IRON["line"])
    b = Art()
    cap_texture(b, SX0, 0, SX1, 1, p, False)
    pillar(b, 12, 19, 1, p, bottom=11)
    b.rect(12, 22, 19, 31, p["light"])
    b.rect(12, 22, 19, 22, p["main"]); b.rect(14, 25, 14, 25, p["main"]); b.rect(17, 29, 17, 29, p["main"])
    b.outline(p["line"])
    for y in range(N):
        for x in range(N):
            if b.px[y][x] is not CLEAR:
                a.px[y][x] = b.px[y][x]
    return a


def arch_gate(portcullis):
    """A stone arch that sits in a horizontal stone-fence run. The wall
    stubs at each side line up with the fence; the arch rises above it.
    The opening is clear (walkable) or holds a lowered iron portcullis."""
    p = STONE
    a = Art()
    if portcullis:
        bars = Art()
        for x in range(8, 24):
            if x % 3 == 1:
                bars.rect(x, 6, x, 17, IRON["main"])
                bars.rect(x, 18, x, 18, IRON["light"])     # spikes
        for y in (8, 12, 16):
            bars.rect(8, y, 23, y, IRON["main"])
        bars.rect(8, 8, 23, 8, IRON["light"])
        bars.outline(IRON["line"])
        a.px = [r[:] for r in bars.px]
    b = Art()
    # wall stubs to the neighbouring fence pieces
    face_texture(b, 0, 2, p); cap_texture(b, 0, CAP0, 2, CAP1, p, True)
    face_texture(b, 29, 31, p); cap_texture(b, 29, CAP0, 31, CAP1, p, True)
    # the arch block: cap on top, block face below, opening cut out
    b.rect(3, 1, 28, 2, p["light"])
    b.rect(6, 1, 6, 2, p["main"]); b.rect(16, 1, 16, 2, p["main"]); b.rect(25, 1, 25, 2, p["main"])
    b.rect(3, 3, 28, FACE1, p["main"])
    b.rect(3, 3, 28, 3, p["dark"])
    for y in range(7, FACE1, 4):                   # courses on the piers
        b.rect(3, y, 28, y, p["dark"])
    for y in range(4, FACE1 + 1):
        k = ((y - 4) // 4) % 2
        for x in (5 + 2 * k, 26 - 2 * k):
            if (y - 4) % 4 != 3:
                b.rect(x, y, x, y, p["dark"])
    b.rect(3, 4, 3, FACE1, p["light"]); b.rect(28, 4, 28, FACE1, p["dark"])
    # opening: x 9..22, round top peaking at row 6
    cx, r = 15.5, 7.0
    for y in range(4, FACE1 + 1):
        for x in range(8, 24):
            dy = max(0.0, 12.5 - y)
            if (x - cx) ** 2 + (dy * 1.05) ** 2 <= r * r and y >= 6:
                b.px[y][x] = CLEAR
    # voussoirs: a light ring round the opening with dark joints
    ring = []
    for y in range(3, FACE1 + 1):
        for x in range(4, 28):
            if b.px[y][x] is not CLEAR and any(
                    0 <= y + dy < N and b.px[y + dy][x + dx] is CLEAR and 8 <= x + dx <= 23
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1))):
                ring.append((x, y))
    for (x, y) in ring:
        b.px[y][x] = p["light"] if y < 13 else p["main"]
    for (x, y) in ((11, 5), (15, 4), (16, 4), (20, 5), (9, 8), (22, 8)):
        b.px[y][x] = p["dark"]
    b.outline(p["line"])
    for y in range(N):
        for x in range(N):
            if b.px[y][x] is not CLEAR:
                a.px[y][x] = b.px[y][x]
    return a


GATES = {"wood": {"gate_h": wood_gate_h, "gate_v": wood_gate_v},
         "stone": {"gate_h": stone_gate_h, "gate_v": stone_gate_v,
                   "archway": lambda: arch_gate(False),
                   "portcullis": lambda: arch_gate(True)}}



if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for kind, fn in (("wood", wood), ("stone", stone)):
        for piece in PIECES:
            fn(piece).image().save(os.path.join(out, f"fence_{kind}_{piece}.png"))
        for piece, gfn in GATES[kind].items():
            gfn().image().save(os.path.join(out, f"fence_{kind}_{piece}.png"))
    print(sum(len(PIECES) + len(g) for g in GATES.values()), "pieces ->", out)
