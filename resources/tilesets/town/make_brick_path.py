"""Brick path pieces (straight v/h + four bends) in the old Plaza's
brick texture: grey running-bond bricks with dark mortar.

Usage: python3 make_brick_path.py OUT_DIR

The brick texture repeats every 64 px both ways and is aligned to the
tile grid, so neighbouring pieces continue the same brickwork. The
path is a 32 px band through the middle of the tile; its edges get a
dark kerb, a little heavier on edges that face down (3/4 view).
"""
import os, random, sys
from PIL import Image

MAIN = (140, 136, 126, 255)    # Plaza brick
DARK = (58, 54, 50, 255)       # Plaza mortar
LIGHT = (176, 172, 162, 255)   # lit top lip of each brick
CLEAR = (0, 0, 0, 0)
B0, B1 = 16, 47                # the band: x (vertical) / y (horizontal)
R = 7                          # outer-corner radius


def texture():
    rnd = random.Random(7)
    t = [[MAIN] * 64 for _ in range(64)]
    rows = [[11, 10, 11, 11, 10, 11], [10, 11, 11, 10, 11, 11]]
    for r in range(8):                         # 8 courses of 8 px
        y0 = r * 8
        widths = rows[r % 2][:]
        rnd.shuffle(widths)
        x = (r % 2) * 5                        # running bond offset
        for w in widths:
            for k in range(w):                 # vertical joint
                pass
            for yy in range(y0, y0 + 8):
                t[yy][x % 64] = DARK
            for xx in range(x, x + w):
                t[y0 + 7][xx % 64] = DARK      # bed joint
                t[y0][xx % 64] = LIGHT if (xx - x) not in (0, 1, w - 1) else t[y0][xx % 64]
            # rounded brick corners, like the plaza's worn bricks
            for (cx, cy) in ((x + 1, y0), (x + w - 1, y0), (x + 1, y0 + 6), (x + w - 1, y0 + 6)):
                t[cy][cx % 64] = DARK
            # a few chips / speckles
            for _ in range(rnd.choice((0, 1, 1, 2))):
                sx = x + rnd.randint(2, w - 2); sy = y0 + rnd.randint(2, 5)
                t[sy][sx % 64] = DARK
            x += w
    return t


JUNCTIONS = {"cross": (True, True, True, True),
             "t_left": (True, True, True, False), "t_right": (True, True, False, True),
             "t_up": (True, False, True, True), "t_down": (False, True, True, True)}


def inside(x, y, piece):
    """Is (x, y) on the path for this piece?"""
    inV, inH = B0 <= x <= B1, B0 <= y <= B1
    if piece in JUNCTIONS:
        up, down, left, right = JUNCTIONS[piece]
        return (inV and inH) or (inV and ((up and y < B0) or (down and y > B1))) \
            or (inH and ((left and x < B0) or (right and x > B1)))
    if piece == "straight_v":
        return inV
    if piece == "straight_h":
        return inH
    up = piece in ("bend_bl", "bend_br")           # vertical arm goes up
    left = piece in ("bend_tr", "bend_br")         # horizontal arm goes left
    varm = inV and ((y <= B1) if up else (y >= B0))
    harm = inH and ((x <= B1) if left else (x >= B0))
    if not (varm or harm):
        return False
    # round the outer corner of the turn
    cx = B1 - R if left else B0 + R
    cy = B1 - R if up else B0 + R
    if inV and inH:
        dx = (x - cx) if left else (cx - x)
        dy = (y - cy) if up else (cy - y)
        if dx > 0 and dy > 0 and dx * dx + dy * dy > R * R:
            return False
    return True


def piece(name, tex):
    im = Image.new("RGBA", (64, 64), CLEAR)
    on = lambda x, y: 0 <= x < 64 and 0 <= y < 64 and inside(x, y, name) or \
        (not (0 <= x < 64 and 0 <= y < 64) and inside(min(max(x, 0), 63), min(max(y, 0), 63), name))
    for y in range(64):
        for x in range(64):
            if not inside(x, y, name):
                continue
            c = tex[y][x]
            edge = not on(x - 1, y) or not on(x + 1, y) or not on(x, y - 1)
            below = not on(x, y + 1) or not on(x, y + 2)      # heavier lower kerb
            if edge or below:
                c = DARK
            elif not on(x, y - 2):
                c = LIGHT                                    # lit kerb top
            im.putpixel((x, y), c)
    return im


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    tex = texture()
    names = ("straight_v", "straight_h", "bend_tl", "bend_tr", "bend_bl", "bend_br") + tuple(JUNCTIONS)
    for n in names:
        piece(n, tex).save(os.path.join(out, f"brick_path_{n}.png"))
    print(len(names), "pieces ->", out)
