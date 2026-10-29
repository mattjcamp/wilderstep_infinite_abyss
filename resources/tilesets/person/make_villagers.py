"""Villager variants of every base person sprite, in four social tiers.

Usage: python3 make_villagers.py PERSON_SPRITE_DIR [OUT_DIR]

Writes <base>_villager_<tier>.png next to each base sprite for the
tiers poor, normal, wealthy and noble (see person_kit.py for how the
base parts are repainted). No weapons — townsfolk read by clothing.
Men wear tunics / doublets with trousers; women wear dresses that fall
to just above the feet. Hair, beards and braids always show.

  poor     drab, patched sackcloth with a frayed hem, rope belt, bare feet
  normal   linen shirt with a green tunic (men) or a laced brown bodice
           over a blue skirt (women), leather belt, plain shoes
  wealthy  burgundy doublet / gown with gold buttons and trim, a fur
           collar, a fat coin purse, dark hose and black boots
  noble    royal purple velvet with gold embroidery, an ermine mantle
           over the shoulders, a gold chain of office and a gold circlet
"""
import sys
import person_kit as pk
from person_kit import Figure, N, CLEAR, SKIN, GOLD, LEATHER

# palettes: light, mid, shadow
SACK = [(150, 134, 110, 255), (118, 104, 86, 255), (86, 76, 64, 255)]
PATCH = [(122, 112, 140, 255), (98, 112, 92, 255)]
ROPE = [(196, 170, 120, 255), (150, 126, 86, 255)]
LINEN = [(232, 226, 206, 255), (196, 188, 166, 255), (150, 142, 124, 255)]
GREEN = [(96, 150, 92, 255), (70, 114, 70, 255), (50, 84, 52, 255)]
BLUE = [(92, 120, 184, 255), (66, 90, 144, 255), (48, 64, 106, 255)]
BODICE = [(132, 92, 62, 255), (98, 68, 46, 255), (70, 48, 34, 255)]
TROUSER = [(132, 104, 74, 255), (100, 78, 56, 255), (72, 56, 40, 255)]
SHOE = [(98, 68, 46, 255), (70, 48, 34, 255)]
WINE = [(168, 50, 64, 255), (124, 34, 50, 255), (86, 24, 38, 255)]
HOSE = [(64, 56, 72, 255), (46, 40, 54, 255), (34, 30, 40, 255)]
BLACK = [(56, 50, 58, 255), (36, 32, 38, 255)]
FUR = [(178, 140, 100, 255), (140, 106, 74, 255)]
PURPLE = [(124, 66, 168, 255), (92, 46, 130, 255), (64, 32, 94, 255)]
ERMINE = [(246, 244, 236, 255), (210, 206, 196, 255)]
SPOT = (30, 26, 34, 255)
GEM = (220, 60, 80, 255)


def recolor(f, top, sleeve, bottom, legs, feet, robe_bottom=None):
    """Repaint the base parts. `top` / `sleeve` / `bottom` / `legs` are
    3-step palettes; `feet` a 2-step palette or None for bare feet.
    `robe_bottom` set → legs above it become dress (in `bottom`)."""
    p, px = f.part, f.px
    for y in range(N):
        for x in range(N):
            name, s = p[y][x], f.shade(x, y)
            if name in ("torso", "top"):
                px[y][x] = top[min(2, s)]
            elif name in ("shorts", "belt"):
                px[y][x] = bottom[min(2, s)]
            elif name == "arm":
                if sleeve is not None:
                    px[y][x] = sleeve[min(2, s)]
            elif name == "leg":
                if robe_bottom is not None and y <= robe_bottom:
                    px[y][x] = bottom[min(2, s)]
                elif legs is not None:
                    px[y][x] = legs[min(2, s)]
            elif name == "foot" and feet is not None and not f.barefoot:
                px[y][x] = feet[0 if s == 0 else 1]
    if robe_bottom is not None:
        f.skirt(robe_bottom, bottom)


def belt(f, pal, buckle=None):
    for x in range(N):
        if f.part[f.belt_y][x] in ("shorts", "belt", "torso", "top"):
            f.px[f.belt_y][x] = pal[1] if x > 17 else pal[0]
    if buckle:
        f.px[f.belt_y][15] = buckle[0]; f.px[f.belt_y][16] = buckle[1]


def dress_hem(f):
    return f.foot_y - 1


# ── Tiers ─────────────────────────────────────────────────────────
def poor(f: Figure):
    f.barefoot = True                               # everyone goes barefoot
    hem = dress_hem(f) if f.female else None
    recolor(f, SACK, None, SACK, SACK if not f.female else None, None, robe_bottom=hem)
    # short ragged sleeves: only the shoulder row is cloth
    for x, y0 in f.arm_top.items():
        for y in (f.arm_y0, f.arm_y0 + 1):
            if f.part[y][x] == "arm":
                f.px[y][x] = SACK[1]
    # men: ragged trousers cut off above the ankle
    if not f.female:
        for y in range(f.foot_y - 2, f.foot_y):
            for x in range(N):
                if f.part[y][x] == "leg":
                    f.px[y][x] = SKIN[f.shade(x, y) if f.shade(x, y) < 3 else 1]
    # patches
    tx0, ty0, tx1, ty1 = f.torso
    for x, y, c in ((tx0 + 2, ty0 + 2, PATCH[0]), (tx0 + 3, ty0 + 2, PATCH[0]),
                    (tx0 + 2, ty0 + 3, PATCH[0]), (tx1 - 2, ty1, PATCH[1])):
        if f.px[y][x] in SACK:
            f.px[y][x] = c
    sx0, sy0, sx1, sy1 = f.shorts
    if f.px[sy1][sx1 - 1] in SACK:
        f.px[sy1][sx1 - 1] = PATCH[1]
    # frayed hem: knock out every other pixel on the bottom cloth row
    hem_y = hem if f.female else sy1
    for x in range(N):
        if f.px[hem_y][x] in SACK and x % 2 == 1 and f.part[hem_y][x] != "leg":
            f.px[hem_y][x] = CLEAR
        elif f.px[hem_y][x] in SACK:
            f.px[hem_y][x] = SACK[2]
    belt(f, ROPE)
    return f.render()


def normal(f: Figure):
    tx0, ty0, tx1, ty1 = f.torso
    if f.female:
        recolor(f, BODICE, LINEN, BLUE, None, SHOE, robe_bottom=dress_hem(f))
        # linen chemise showing at the neckline, lacing down the bodice
        for x in range(N):
            if f.part[ty0][x] in ("torso", "top"):
                f.px[ty0][x] = LINEN[0] if x < 17 else LINEN[1]
        for y in range(ty0 + 1, ty1 + 1, 2):
            if f.px[y][15] in BODICE:
                f.px[y][15] = LINEN[1]; f.px[y][16] = LINEN[2]
        # hem band
        for x in range(N):
            if f.px[dress_hem(f)][x] in BLUE:
                f.px[dress_hem(f)][x] = BLUE[2]
    else:
        recolor(f, GREEN, LINEN, GREEN, TROUSER, SHOE)
        # linen collar and open neck
        for x in range(N):
            if f.part[ty0][x] in ("torso", "top", "beard") and f.part[ty0][x] != "beard":
                f.px[ty0][x] = LINEN[0] if x < 17 else LINEN[1]
        if f.px[ty0 + 1][15] in GREEN:
            f.px[ty0 + 1][15] = LINEN[1]
        # tunic skirt flap to mid-thigh
        f.skirt(f.shorts[3] + 1, GREEN, start=f.shorts[3] + 1)
    # rolled cuffs: forearms bare
    for x, yb in f.arm_bot.items():
        for y in range(f.arm_y0 + 3 + (0 if not f.small else -1), yb + 1):
            if f.part[y][x] == "arm":
                f.px[y][x] = SKIN[min(2, f.shade(x, y))]
        y = f.arm_y0 + 2 + (0 if not f.small else -1)
        if f.part[y][x] == "arm":
            f.px[y][x] = LINEN[1]
    belt(f, LEATHER, (GOLD[1], LEATHER[2]))
    return f.render()


def wealthy(f: Figure):
    tx0, ty0, tx1, ty1 = f.torso
    if f.female:
        recolor(f, WINE, WINE, WINE, None, BLACK, robe_bottom=dress_hem(f))
        hem = dress_hem(f)
        for x in range(N):
            if f.px[hem][x] in WINE:
                f.px[hem][x] = GOLD[0] if x % 2 == 0 else GOLD[1]
        # gold pendant necklace
        f.put(15, ty0 + 1, GOLD[0]); f.put(16, ty0 + 1, GOLD[1]); f.put(15, ty0 + 2, GEM)
    else:
        recolor(f, WINE, WINE, HOSE, HOSE, BLACK)
        f.skirt(f.shorts[3] + 1, WINE, start=f.shorts[3] + 1)   # doublet skirt
        # gold buttons down the front
        for y in range(ty0 + 1, ty1 + 1, 2):
            if f.px[y][15] in WINE:
                f.px[y][15] = GOLD[0]
        # black boots to the knee
        for y in range(f.foot_y - 3, f.foot_y):
            for x in range(N):
                if f.part[y][x] == "leg" and not f.barefoot:
                    f.px[y][x] = BLACK[0 if f.shade(x, y) == 0 else 1]
    # fur collar across the shoulders
    for x in range(N):
        if f.part[ty0][x] in ("torso", "top"):
            f.px[ty0][x] = FUR[0] if x < 17 else FUR[1]
    # gold cuffs
    for x, yb in f.arm_bot.items():
        if f.part[yb][x] == "arm":
            f.px[yb][x] = GOLD[0] if x < 16 else GOLD[1]
    belt(f, BLACK, (GOLD[0], GOLD[1]))
    # a fat coin purse hanging at the hip
    px0 = f.shorts[2] - 2
    for y, x, c in ((f.belt_y + 1, px0, LEATHER[0]), (f.belt_y + 1, px0 + 1, LEATHER[1]),
                    (f.belt_y + 2, px0, LEATHER[1]), (f.belt_y + 2, px0 + 1, LEATHER[2]),
                    (f.belt_y + 1, px0, GOLD[0])):
        f.put(x, y, c)
    return f.render()


def noble(f: Figure):
    tx0, ty0, tx1, ty1 = f.torso
    hx0, _, hx1, _ = f.head
    if f.female:
        recolor(f, PURPLE, PURPLE, PURPLE, None, BLACK, robe_bottom=dress_hem(f))
        hem = dress_hem(f)
        for x in range(N):
            if f.px[hem][x] in PURPLE:
                f.px[hem][x] = ERMINE[0] if x % 3 else SPOT
    else:
        recolor(f, PURPLE, PURPLE, HOSE, HOSE, BLACK)
        f.skirt(f.shorts[3] + 1, PURPLE, start=f.shorts[3] + 1)
        for y in range(f.foot_y - 3, f.foot_y):
            for x in range(N):
                if f.part[y][x] == "leg" and not f.barefoot:
                    f.px[y][x] = BLACK[0 if f.shade(x, y) == 0 else 1]
    # gold embroidery: a vertical band down the front
    for y in range(ty0 + 1, f.belt_y):
        if f.px[y][15] in PURPLE:
            f.px[y][15] = GOLD[0]; f.px[y][16] = GOLD[1] if f.px[y][16] in PURPLE else f.px[y][16]
    # ermine mantle over the shoulders and upper arms
    m_rows = range(ty0, ty0 + (2 if f.small else 3))
    for y in m_rows:
        for x in range(N):
            if f.part[y][x] in ("torso", "top", "arm"):
                f.px[y][x] = SPOT if (x + y * 3) % 5 == 0 else ERMINE[0] if x < 17 else ERMINE[1]
    # gold chain of office with a medallion
    cy = max(m_rows) + 1
    for x in range(tx0 + 2, tx1 - 1):
        if f.part[cy][x] in ("torso", "top"):
            f.px[cy][x] = GOLD[1]
    f.put(15, cy + 1, GOLD[0]); f.put(16, cy + 1, GOLD[1])
    # gold cuffs
    for x, yb in f.arm_bot.items():
        if f.part[yb][x] == "arm":
            f.px[yb][x] = GOLD[0] if x < 16 else GOLD[1]
    belt(f, GOLD)
    # gold circlet with a jewel, round the crown
    gy = f.head_top - 2
    hair_x = [x for x in range(N) if f.part[gy][x] == "hair"]
    for x in hair_x:
        f.px[gy][x] = GOLD[0] if x < 17 else GOLD[1]
    mid = (min(hair_x) + max(hair_x)) // 2
    f.put(mid, gy, GEM)
    for x in (min(hair_x) + 1, mid, max(hair_x) - 1):  # little points
        f.put(x, gy - 1, GOLD[0])
    return f.render()


TIERS = {"poor": poor, "normal": normal, "wealthy": wealthy, "noble": noble}

if __name__ == "__main__":
    import os
    from PIL import Image
    src_dir = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else src_dir
    os.makedirs(out_dir, exist_ok=True)
    for tier, fn in TIERS.items():
        for name in pk.BASES:
            base = Image.open(os.path.join(src_dir, f"{name}.png")).convert("RGBA")
            fn(Figure(name, base)).save(os.path.join(out_dir, f"{name}_villager_{tier}.png"))
    print(len(TIERS) * len(pk.BASES), "villager sprites ->", out_dir)
