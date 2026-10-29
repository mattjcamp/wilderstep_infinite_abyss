"""Druid variants of every base person sprite.

Usage: python3 make_druid.py PERSON_SPRITE_DIR [OUT_DIR]

Writes <base>_druid.png next to each base sprite (see person_kit.py).

The druid kit (same on everyone):
  - a wreath of leaves with red berries round the head (hair, beards
    and braids show)
  - long moss-green robe falling to just above the feet, with full
    sleeves
  - a brown fur-trimmed mantle over the shoulders
  - a twisted rope belt with a hanging sprig
  - simple brown shoes (halflings: bare feet)
  - a gnarled wooden staff with a curled crook and sprouting leaves,
    held in the right hand (viewer's left)
"""
import sys
import person_kit as pk
from person_kit import Figure, main, N, CLEAR, SKIN

ROBE = [(110, 138, 74, 255), (80, 104, 56, 255), (56, 74, 42, 255)]
MANTLE = [(140, 104, 70, 255), (104, 76, 52, 255), (74, 54, 38, 255)]
FUR = (218, 204, 176, 255)
ROPE = [(204, 172, 112, 255), (156, 126, 80, 255)]
LEAF = [(130, 200, 84, 255), (74, 150, 60, 255), (46, 104, 44, 255)]
BERRY = (214, 64, 64, 255)
SHOE = [(110, 74, 46, 255), (78, 52, 34, 255)]
WOOD = [(150, 108, 66, 255), (112, 78, 48, 255), (78, 54, 34, 255)]


def druid(f: Figure):
    p, px = f.part, f.px
    hx0, _, hx1, _ = f.head
    tx0, ty0, tx1, ty1 = f.torso
    robe_bottom = f.foot_y - 2

    for y in range(N):
        for x in range(N):
            name, s = p[y][x], f.shade(x, y)
            if name in ("torso", "top", "shorts", "belt"):
                px[y][x] = ROBE[min(2, s)]
            elif name == "arm":
                px[y][x] = MANTLE[min(2, s)] if y <= f.arm_y0 + 1 else ROBE[min(2, s)]
            elif name == "leg":
                if y <= robe_bottom:
                    px[y][x] = ROBE[min(2, s)]
                elif not f.barefoot:
                    px[y][x] = SHOE[0 if s == 0 else 1]
            elif name == "foot" and not f.barefoot:
                px[y][x] = SHOE[0 if s == 0 else 1]

    f.skirt(robe_bottom, ROBE)
    for y in range(f.shorts[1] + 1, robe_bottom + 1):   # robe fold
        if px[y][16] in ROBE:
            px[y][16] = ROBE[2]
    for x in range(N):                                  # darker hem
        if px[robe_bottom][x] in ROBE:
            px[robe_bottom][x] = ROBE[2] if px[robe_bottom][x] != ROBE[0] else ROBE[1]

    # mantle over the shoulders, fur trim along its lower edge
    m_rows = range(ty0, ty0 + (2 if f.small else 3))
    for y in m_rows:
        xs = [x for x in range(N) if p[y][x] in ("torso", "top")]
        if not xs:
            continue
        for x, s in pk.run_shades(xs).items():
            px[y][x] = MANTLE[s]
    trim_y = max(m_rows)
    for x in range(N):
        if px[trim_y][x] in MANTLE and p[trim_y][x] in ("torso", "top"):
            px[trim_y][x] = FUR
    # mantle clasp (a wooden toggle)
    px[ty0 + 1][15] = WOOD[0]; px[ty0 + 1][16] = WOOD[1]

    # rope belt with a sprig of leaves hanging from it
    by = f.belt_y
    for x in range(N):
        if px[by][x] in ROBE:
            px[by][x] = ROPE[0] if x % 2 == 0 else ROPE[1]
    for y, x, c in ((by + 1, 13, ROPE[1]), (by + 2, 13, LEAF[1]), (by + 2, 12, LEAF[0])):
        if px[y][x] != CLEAR:
            px[y][x] = c

    # leaf wreath round the head, with berries
    wy = f.head_top - 2                                 # on the crown, clear of the brows
    hair_x = [x for x in range(N) if p[wy][x] == "hair"]
    xs = list(range(min(hair_x) - 1, max(hair_x) + 2))
    for i, x in enumerate(xs):
        f.put(x, wy, LEAF[i % 2])
    for x in (xs[1], xs[len(xs) // 2], xs[-2]):
        f.put(x, wy, BERRY)
    f.put(xs[0], wy - 1, LEAF[0])                       # leaves sticking up
    f.put(xs[-1], wy - 1, LEAF[1])

    # gnarled staff with a curled crook, in the viewer's-left hand
    x0, y0, x1, y1 = f.lhand
    sx = f.fist(f.lhand, -1) - 1
    top = max(2, f.head_top - (2 if f.small else 3))
    for y in range(top, f.foot_y + 1):
        kink = 1 if (y - top) % 7 in (3, 4) else 0      # knotty wobble
        f.put(sx - kink, y, WOOD[0] if y < y0 else WOOD[1])
    # crook curling back over the top
    for x, y, c in ((sx - 1, top - 1, WOOD[0]), (sx - 2, top - 1, WOOD[1]),
                    (sx - 3, top, WOOD[1]), (sx - 3, top + 1, WOOD[2])):
        f.put(x, y, c)
    for x, y, c in ((sx + 1, top, LEAF[0]), (sx + 1, top + 1, LEAF[1]),
                    (sx - 2, top + 2, LEAF[1]), (sx + 1, top + 5, LEAF[0])):
        f.put(x, y, c)
    return f.render()


if __name__ == "__main__":
    main(druid, "druid", sys.argv)
