"""Paladin variants of every base person sprite.

Usage: python3 make_paladin.py PERSON_SPRITE_DIR [OUT_DIR]

Writes <base>_paladin.png next to each base sprite (see person_kit.py).

The paladin kit (same on everyone) — a holy knight, so it shares the
fighter's sword-and-shield shape but reads brighter and nobler:
  - polished open helm with a gold band and a red plume
  - bright plate breastplate and pauldrons, gold-trimmed
  - royal-blue tabard with a gold holy cross, white belt
  - a blue cape hanging behind, showing past the arms and legs
  - plate greaves and sabatons (halflings keep their bare feet)
  - a gold-hilted longsword upright in the right hand (viewer's left)
  - a gold-rimmed white kite shield with a blue cross on the left arm
"""
import sys
from person_kit import Figure, main, N, CLEAR, SKIN, GOLD

PLATE = [(232, 236, 244, 255), (176, 184, 202, 255), (116, 124, 146, 255)]
TABARD = [(64, 96, 196, 255), (40, 64, 146, 255), (28, 44, 104, 255)]
CAPE = [(48, 74, 164, 255), (32, 50, 118, 255)]
PLUME = [(226, 68, 64, 255), (164, 40, 48, 255)]
WHITE = [(244, 240, 228, 255), (200, 194, 180, 255)]
GRIP = (96, 56, 40, 255)


def paladin(f: Figure):
    p, px = f.part, f.px
    hx0, _, hx1, _ = f.head
    tx0, ty0, tx1, ty1 = f.torso
    sx0, sy0, sx1, sy1 = f.shorts

    for y in range(N):
        for x in range(N):
            name, s = p[y][x], f.shade(x, y)
            if name == "hair" and y < f.head_top:
                px[y][x] = PLATE[1] if y == f.head_top - 1 else PLATE[min(2, s)]
            elif name in ("torso", "top"):
                px[y][x] = PLATE[min(2, s)]
            elif name in ("shorts", "belt"):
                px[y][x] = TABARD[min(2, s)]
            elif name == "arm":
                if y <= f.arm_y0 + 1:
                    px[y][x] = PLATE[min(2, s)]          # pauldron
                elif y >= f.arm_bot[x] - 1:
                    px[y][x] = PLATE[1 if s == 0 else 2]   # vambrace
            elif name == "leg":
                if f.barefoot and y >= f.foot_y - 1:
                    continue
                px[y][x] = PLATE[min(2, s)]
            elif name == "foot" and not f.barefoot:
                px[y][x] = PLATE[1 if s == 0 else 2]

    # gold trim: helm band, pauldron edges, breastplate hem
    for x in range(N):
        if p[f.head_top - 1][x] == "hair":
            px[f.head_top - 1][x] = GOLD[0] if x < 17 else GOLD[1]
    for x, y0 in f.arm_top.items():
        if y0 == f.arm_y0 or p[f.arm_y0][x] == "arm":
            px[f.arm_y0 + 1][x] = GOLD[1]
    # tabard: from mid-chest down over the shorts, with a gold cross
    tab_x0, tab_x1 = tx0 + 2, tx1 - 2
    for y in range(ty0 + 2, sy1 + 1):
        xs = [x for x in range(tab_x0, tab_x1 + 1) if p[y][x] in ("torso", "top", "shorts", "belt")]
        for i, x in enumerate(xs):
            if p[y][x] == "beard":
                continue
            px[y][x] = TABARD[2] if i == len(xs) - 1 else TABARD[1] if i >= len(xs) - 2 else TABARD[0]
    cy = ty0 + 3
    for x, y in ((15, cy - 1), (16, cy - 1), (15, cy), (16, cy), (14, cy), (17, cy),
                 (15, cy + 1), (16, cy + 1), (15, cy + 2), (16, cy + 2)):
        if px[y][x] in TABARD:
            px[y][x] = GOLD[0] if x <= 15 else GOLD[1]
    # white belt with a gold buckle
    for x in range(N):
        if p[f.belt_y][x] in ("shorts", "belt", "torso", "top"):
            px[f.belt_y][x] = WHITE[0] if x < 17 else WHITE[1]
    px[f.belt_y][15] = GOLD[0]; px[f.belt_y][16] = GOLD[1]

    # red plume on top of the helm
    crown = [x for x in range(N) if p[f.head_top - 3][x] == "hair"] or [15, 16]
    top_y = min(y for y in range(N) for x in range(N) if p[y][x] == "hair")
    mx = (min(crown) + max(crown)) // 2
    for x, y, c in ((mx, top_y - 1, PLUME[0]), (mx + 1, top_y - 1, PLUME[1]),
                    (mx + 1, top_y - 2, PLUME[0]), (mx + 2, top_y - 2, PLUME[1]),
                    (mx + 2, top_y - 3, PLUME[1])):
        f.put(x, y, c)

    # ── Longsword, gold hilt, upright in the viewer's-left hand ──
    x0, y0, x1, y1 = f.lhand
    f.fist(f.lhand, -1)
    br = x0 - 2
    bl = br - 1
    gy = y0 - 1
    blade_len = 8 if f.small else 11
    for y in range(y0, y1 + 1):
        f.put(bl, y, GRIP); f.put(br, y, GRIP)
    f.put(bl, y1 + 1, GOLD[0]); f.put(br, y1 + 1, GOLD[1])
    for x in range(bl - 1, br + 2):
        f.put(x, gy, GOLD[0] if x <= bl else GOLD[1])
    for y in range(gy - blade_len + 1, gy):
        f.put(bl, y, PLATE[0]); f.put(br, y, PLATE[1])
    f.put(bl, gy - blade_len, PLATE[0])

    # ── Kite shield, white with a blue cross, on the viewer's-right arm ──
    rx0, ry0, rx1, ry1 = f.rhand
    s0, s1 = rx0 - 1, rx1 + (2 if f.small else 3)
    t0, t1 = ry0 - (5 if f.small else 6), ry1 + (3 if f.small else 4)
    cells = set()
    for y in range(t0, t1 + 1):
        inset = max(0, y - (t1 - 3)) if not f.small else max(0, y - (t1 - 2))
        for x in range(s0 + inset, s1 - inset + 1):
            cells.add((x, y))
    for (x, y) in cells:
        edge = any((x + dx, y + dy) not in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            c = GOLD[0] if (y == t0 or x == s0) else GOLD[1]
        else:
            c = WHITE[1] if x >= s1 - 1 else WHITE[0]
        f.put(x, y, c)
    cx = (s0 + s1) // 2
    cyy = (t0 + t1) // 2 - 1
    for y in range(t0 + 2, t1 - 2):
        if (cx, y) in cells:
            f.put(cx, y, TABARD[1])
    for x in range(s0 + 1, s1):
        if (x, cyy) in cells:
            f.put(x, cyy, TABARD[0])

    # ── Blue cape hanging behind ──
    cape_bottom = f.foot_y - (2 if f.small else 3)
    xs_all = [x for y in range(N) for x in range(N) if p[y][x] in ("arm", "torso")]
    cx0, cx1 = min(xs_all) - 1, max(xs_all) + 1
    for y in range(ty0 + 1, cape_bottom + 1):
        for x in range(cx0, cx1 + 1):
            f.put_behind(x, y, CAPE[1] if x < 16 else CAPE[1] if x > cx1 - 2 else CAPE[0])
    return f.render()


if __name__ == "__main__":
    main(paladin, "paladin", sys.argv)
