"""Alchemist variants of every base person sprite.

Usage: python3 make_alchemist.py PERSON_SPRITE_DIR [OUT_DIR]

Writes <base>_alchemist.png next to each base sprite (see person_kit.py).

The alchemist kit (same on everyone):
  - brass goggles with blue lenses pushed up on the forehead
  - mustard work shirt with rolled sleeves (bare forearms)
  - long brown leather apron with a chest pocket, over the shirt,
    falling to the shins
  - a belt of three coloured potion vials
  - grey trousers and dark boots (halflings: bare feet)
  - a round-bottomed flask of bubbling green potion held up in the
    right hand (viewer's left)
"""
import sys
from person_kit import Figure, main, N, CLEAR, SKIN, LEATHER, GOLD

SHIRT = [(214, 170, 78, 255), (170, 128, 56, 255), (122, 90, 42, 255)]
APRON = [(134, 92, 62, 255), (100, 66, 44, 255), (72, 46, 32, 255)]
TROUSER = [(110, 108, 116, 255), (80, 78, 88, 255), (58, 56, 66, 255)]
BOOT = [(66, 52, 48, 255), (44, 34, 32, 255)]
BRASS = [(232, 196, 104, 255), (176, 136, 60, 255)]
LENS = [(150, 220, 240, 255), (70, 150, 200, 255)]
GLASS = (210, 236, 236, 255)
POTION = [(148, 236, 96, 255), (84, 186, 62, 255), (48, 128, 44, 255)]
VIALS = [(220, 70, 70, 255), (90, 140, 230, 255), (150, 230, 90, 255)]


def alchemist(f: Figure):
    p, px = f.part, f.px
    hx0, _, hx1, _ = f.head
    tx0, ty0, tx1, ty1 = f.torso
    sx0, sy0, sx1, sy1 = f.shorts
    apron_bottom = f.foot_y - (2 if f.small else 3)
    ax0, ax1 = tx0 + 1, tx1 - 1                    # apron is a bit narrower than the body

    for y in range(N):
        for x in range(N):
            name, s = p[y][x], f.shade(x, y)
            if name in ("torso", "top"):
                px[y][x] = SHIRT[min(2, s)]
            elif name in ("shorts", "belt"):
                px[y][x] = TROUSER[min(2, s)]
            elif name == "arm":
                if y <= f.arm_y0 + (1 if f.small else 2):
                    px[y][x] = SHIRT[min(2, s)]
                elif y == f.arm_y0 + (2 if f.small else 3):
                    px[y][x] = SHIRT[1]                # rolled cuff
            elif name == "leg":
                boot = (not f.barefoot) and y >= f.foot_y - 2
                px[y][x] = BOOT[0 if s == 0 else 1] if boot else TROUSER[min(2, s)]
            elif name == "foot" and not f.barefoot:
                px[y][x] = BOOT[0 if s == 0 else 1]

    # apron: bib over the chest, then down over the legs to the shins
    for y in range(ty0 + 1, apron_bottom + 1):
        if y <= sy1:
            xs = [x for x in range(ax0, ax1 + 1)
                  if p[y][x] in ("torso", "top", "shorts", "belt")]
        else:
            legs = [x for x in range(N) if p[y][x] == "leg"]
            xs = list(range(min(legs), max(legs) + 1)) if legs else []
        if not xs:
            continue
        for x, s in __import__("person_kit").run_shades(xs).items():
            if p[y][x] == "beard":
                continue
            px[y][x] = APRON[s]
    for x in range(ax0, ax1 + 1):                  # neck strap ends
        if p[ty0][x] in ("torso", "top") and x in (ax0, ax1):
            px[ty0][x] = APRON[1]
    # chest pocket with a stirring rod poking out
    pk_y = ty0 + 2
    for x in (13, 14):
        if px[pk_y][x] in APRON:
            px[pk_y][x] = APRON[2]
    if px[pk_y - 1][13] in APRON:
        px[pk_y - 1][13] = GOLD[0]

    # vial belt: dark strap with three coloured vials
    by = f.belt_y
    for x in range(N):
        if px[by][x] in APRON or p[by][x] in ("belt", "shorts"):
            px[by][x] = LEATHER[2]
    for i, c in enumerate(VIALS):
        vx = sx0 + 1 + i * 2
        if vx <= sx1:
            px[by][vx] = GLASS
            if px[by + 1][vx] != CLEAR:
                px[by + 1][vx] = c

    # goggles pushed up on the forehead: a dark strap round the hair
    # with two brass-rimmed blue lenses, a row clear of the eyes
    gy = f.head_top - 2
    hair_xs = [x for x in range(N) if p[gy][x] == "hair"]
    for x in hair_xs:
        px[gy][x] = LEATHER[2]
    lx = (hx0 + hx1) // 2
    for cx in (lx - 1, lx + 2):
        for x, c in ((cx - 1, BRASS[0]), (cx, LENS[0]), (cx + 1, BRASS[1])):
            if x in hair_xs:
                px[gy][x] = c
        if p[gy + 1][cx] == "hair":
            px[gy + 1][cx] = LENS[1]                # lens depth
    # flask held up in the viewer's-left hand
    x0, y0, x1, y1 = f.lhand
    fx = f.fist(f.lhand, -1) - 1                    # flask's right column
    bulb_top = y0 - 1
    for y in range(bulb_top, bulb_top + 3):         # round bulb, 3 wide
        for x in (fx - 2, fx - 1, fx):
            corner = (y in (bulb_top, bulb_top + 2)) and x in (fx - 2, fx)
            if not corner or y == bulb_top + 2:
                f.put(x, y, POTION[0] if x == fx - 2 else POTION[1] if x == fx - 1 else POTION[2])
    f.put(fx - 2, bulb_top, CLEAR)
    f.put(fx, bulb_top, CLEAR)
    f.put(fx - 1, bulb_top - 1, GLASS)              # neck
    f.put(fx - 1, bulb_top - 2, LEATHER[1])         # cork
    f.put(fx - 2, bulb_top - 3, POTION[0])          # bubbles
    f.put(fx - 1, bulb_top - 5, POTION[1])
    return f.render()


if __name__ == "__main__":
    main(alchemist, "alchemist", sys.argv)
