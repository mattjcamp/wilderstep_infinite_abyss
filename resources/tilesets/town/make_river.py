"""River pieces that follow the path layout (straights, bends, T's and
a cross), filled with the shared water pattern (map/water.png).

Usage: python3 make_river.py WATER_PNG OUT_DIR   (WATER_PNG = sprites/map/water.png)

The river is the same 32 px band through the middle of the tile as the
brick path (same rounded outer corners), so the pieces join the same
way. Inside the band: the dark water base the game draws behind water
tiles, with the water tile's blue waves on top (the wave texture is the
64 px water tile itself, so it continues from tile to tile). The banks
are a solid blue line; everything outside the band is transparent so
the tile's Grass background shows through.
"""
import os, sys
from PIL import Image

WATER = Image.open(sys.argv[1]).convert("RGBA")
OUT = sys.argv[2]
BASE = (12, 12, 20, 255)          # the game's backdrop colour (#0c0c14)
BANK = (0, 119, 255, 255)         # the water's blue
FOAM = (110, 176, 255, 255)       # lit top bank
CLEAR = (0, 0, 0, 0)
B0, B1, R = 16, 47, 7

ARMS = {  # up, down, left, right
    "straight_v": (True, True, False, False), "straight_h": (False, False, True, True),
    "bend_tl": (False, True, False, True), "bend_tr": (False, True, True, False),
    "bend_bl": (True, False, False, True), "bend_br": (True, False, True, False),
    "cross": (True, True, True, True),
    "t_left": (True, True, True, False), "t_right": (True, True, False, True),
    "t_up": (True, False, True, True), "t_down": (False, True, True, True),
}


def inside(x, y, piece):
    if not (0 <= x < 64 and 0 <= y < 64):
        x, y = min(max(x, 0), 63), min(max(y, 0), 63)   # runs carry on past the edge
    up, down, left, right = ARMS[piece]
    inV, inH = B0 <= x <= B1, B0 <= y <= B1
    if piece.startswith("straight"):
        return inV if up else inH
    on = (inV and inH) or (inV and ((up and y < B0) or (down and y > B1))) \
        or (inH and ((left and x < B0) or (right and x > B1)))
    if on and piece.startswith("bend") and inV and inH:      # round the outer corner
        cx = B1 - R if left else B0 + R
        cy = B1 - R if up else B0 + R
        dx = (x - cx) if left else (cx - x)
        dy = (y - cy) if up else (cy - y)
        if dx > 0 and dy > 0 and dx * dx + dy * dy > R * R:
            return False
    return on


def piece(name):
    im = Image.new("RGBA", (64, 64), CLEAR)
    for y in range(64):
        for x in range(64):
            if not inside(x, y, name):
                continue
            near = lambda d: any(not inside(x + dx, y + dy, name)
                                 for dx in range(-d, d + 1) for dy in range(-d, d + 1))
            if near(1):
                c = FOAM if not inside(x, y - 1, name) or not inside(x, y - 2, name) else BANK
            elif near(2):
                c = BANK
            else:
                w = WATER.getpixel((x, y))
                c = w if w[3] else BASE
            im.putpixel((x, y), c)
    return im


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for n in ARMS:
        piece(n).save(os.path.join(OUT, f"river_{n}.png"))
    print(len(ARMS), "pieces ->", OUT)
