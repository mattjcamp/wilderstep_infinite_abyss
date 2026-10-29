"""Ranger variants of every base person sprite.

Usage: python3 make_ranger.py PERSON_SPRITE_DIR [OUT_DIR]

Writes <base>_ranger.png next to each base sprite (see person_kit.py).

The ranger kit (same on everyone):
  - bare head (hair, beards and braids show) with a green hood lowered
    round the shoulders as a collar
  - forest-green tunic with a brown leather chest strap, brown belt
  - brown trousers and tall brown boots (halflings: bare feet)
  - leather bracer on the bow arm
  - a longbow held upright in the right hand (viewer's left)
  - a quiver of red-fletched arrows over the far shoulder
"""
import sys
from person_kit import Figure, main, N, CLEAR, SKIN, LEATHER, GOLD

TUNIC = [(84, 140, 76, 255), (58, 102, 56, 255), (40, 72, 42, 255)]
HOOD = [(70, 118, 64, 255), (48, 86, 48, 255)]
TROUSER = [(132, 100, 70, 255), (98, 72, 50, 255), (70, 50, 36, 255)]
BOOT = [(110, 74, 46, 255), (78, 52, 34, 255)]
WOOD = [(176, 124, 70, 255), (128, 86, 48, 255)]
STRING = (222, 218, 200, 255)
QUIVER = [(126, 82, 48, 255), (92, 58, 36, 255)]
FLETCH = [(214, 72, 60, 255), (236, 232, 220, 255)]


def ranger(f: Figure):
    p, px = f.part, f.px
    for y in range(N):
        for x in range(N):
            name, s = p[y][x], f.shade(x, y)
            if name in ("torso", "top"):
                px[y][x] = TUNIC[min(2, s)]
            elif name in ("shorts", "belt"):
                px[y][x] = TUNIC[min(2, s)] if y < f.shorts[1] + 2 else TROUSER[min(2, s)]
            elif name == "arm":
                if x < 16 and y >= f.arm_bot[x] - 1:
                    px[y][x] = LEATHER[min(2, s)]          # bow-arm bracer
                elif y <= f.arm_bot[x] - 2 or x >= 16:
                    px[y][x] = TUNIC[min(2, s)] if y <= f.arm_y0 + 3 else SKIN[min(2, s)]
            elif name == "leg":
                boot = (not f.barefoot) and y >= f.foot_y - (3 if f.small else 4)
                px[y][x] = BOOT[0 if s == 0 else 1] if boot else TROUSER[min(2, s)]
            elif name == "foot" and not f.barefoot:
                px[y][x] = BOOT[0 if s == 0 else 1]

    # tunic skirt flap below the belt
    f.skirt(f.shorts[1] + 1, TUNIC, start=f.shorts[1] + 1)

    # lowered hood: a collar across the shoulder line
    tx0, ty0, tx1, _ = f.torso
    for x in range(tx0, tx1 + 1):
        if p[ty0][x] in ("torso", "top", "beard"):
            if p[ty0][x] != "beard":
                px[ty0][x] = HOOD[0] if x < 17 else HOOD[1]

    # leather chest strap (quiver strap) shoulder to hip
    for i, y in enumerate(range(ty0 + 1, f.belt_y)):
        x = tx0 + 1 + i
        if p[y][x] in ("torso", "top"):
            px[y][x] = LEATHER[1]

    # belt with a brass buckle
    for x in range(N):
        if p[f.belt_y][x] in ("belt", "shorts", "torso", "top"):
            px[f.belt_y][x] = LEATHER[2] if x > 17 else LEATHER[1]
    px[f.belt_y][15] = GOLD[0]; px[f.belt_y][16] = GOLD[1]

    # quiver over the far (viewer's-right) shoulder, worn behind
    qx = tx1 - 1
    q_top = ty0 - (3 if f.small else 4)
    for y in range(q_top + 2, ty0 + 4):
        for x in (qx, qx + 1):
            f.put_behind(x, y, QUIVER[0] if x == qx else QUIVER[1])
    for x, y, c in ((qx, q_top, FLETCH[0]), (qx + 1, q_top + 1, FLETCH[0]),
                    (qx, q_top + 1, FLETCH[1]), (qx + 2, q_top, FLETCH[1])):
        f.put_behind(x, y, c)

    # longbow, upright in the viewer's-left hand: the handle sits in
    # the fist, the limbs curve out to tips three columns further out,
    # and the string runs straight between the tips on the outside
    x0, y0, x1, y1 = f.lhand
    grip = f.fist(f.lhand, -1)
    cy = (y0 + y1) // 2
    half = 7 if f.small else 10
    for y in range(cy - half, cy + half + 1):
        d = abs(y - cy)
        off = 0 if d <= 1 else 1 if d <= half * 0.5 else 2 if d <= half * 0.85 else 3
        if off == 0:
            f.put(grip, y, LEATHER[1])                 # leather-wrapped handle
        else:
            f.put(grip - off, y, WOOD[0] if y < cy else WOOD[1])
    for y in range(cy - half + 1, cy + half):
        f.put(grip - 3, y, STRING)                     # bowstring
    for y in range(y0, y1 + 1):                        # fingers over the handle
        f.put(grip, y, SKIN[0])
    return f.render()


if __name__ == "__main__":
    main(ranger, "ranger", sys.argv)
