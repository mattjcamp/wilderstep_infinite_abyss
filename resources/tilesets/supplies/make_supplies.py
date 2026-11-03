"""Alternative item icons for Lockpick and Camping Supplies.

Usage: python3 make_supplies.py [ITEM_SPRITE_DIR]
  (defaults to web/public/modules/default/sprites/item)

Two options each, 32x32, in the item-icon house style (1px art, dark
outline, light/mid/shadow steps, soft drop shadow):

  lockpick_a          thieves' pick roll: three picks + a tension
                      wrench fanned out of a small leather wrap
  lockpick_b          iron ring holding a hook pick, a rake and a wrench
  camping_supplies_a  rolled bedroll strapped to a backpack, tin cup
  camping_supplies_b  bedroll + campfire kit: bundled firewood, flint
                      and a cooking pot

Writes the chosen icons to ITEM_SPRITE_DIR — lockpick_ring.png (option
B) and camping_supplies.png (option A), used by items.json — and a
comparison sheet `_supplies_sheet.png` here with every option.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ITEM_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "web/public/modules/default/sprites/item")

N = 32
OUT = (32, 32, 32, 255)
SHADOW = (0, 0, 0, 96)
CLEAR = (0, 0, 0, 0)
STEEL = [(220, 224, 232, 255), (160, 166, 180, 255), (100, 104, 118, 255)]
LEATHER = [(176, 120, 72, 255), (132, 86, 50, 255), (90, 58, 34, 255)]
WOOD = [(184, 132, 80, 255), (140, 96, 56, 255), (98, 64, 38, 255)]
WOOL = [(206, 92, 76, 255), (160, 62, 54, 255), (112, 40, 38, 255)]
CANVAS = [(170, 160, 112, 255), (128, 120, 82, 255), (88, 82, 56, 255)]


def blank():
    return Image.new("RGBA", (N, N), CLEAR)


def outline(img):
    px = img.load()
    solid = {(x, y) for y in range(N) for x in range(N) if px[x, y][3] == 255}
    for x, y in list(solid):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            X, Y = x + dx, y + dy
            if 0 <= X < N and 0 <= Y < N and (X, Y) not in solid and px[X, Y][3] < 255:
                px[X, Y] = OUT
    return img


def drop_shadow(img, cx, cy, rx, ry):
    sh = blank()
    ImageDraw.Draw(sh).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=SHADOW)
    sh.alpha_composite(img)
    return sh


def pick(d, x0, y0, x1, y1, tip):
    """A thin steel pick from (x0,y0) to (x1,y1) with a tip shape."""
    d.line(((x0, y0), (x1, y1)), fill=STEEL[1], width=1)
    if tip == "hook":
        d.line(((x1, y1), (x1 + 1, y1 - 2)), fill=STEEL[0])
    elif tip == "rake":
        for k in range(3):
            d.point((x1 - k * 2, y1 - k * 2 - 1), fill=STEEL[0])
    elif tip == "diamond":
        d.polygon([(x1, y1 - 2), (x1 + 2, y1), (x1, y1 + 2), (x1 - 2, y1)], fill=STEEL[0])


# ── Lockpick ──────────────────────────────────────────────────────

def lockpick_a():
    """Picks fanned out of a leather wrap."""
    im = blank(); d = ImageDraw.Draw(im)
    # picks first (the wrap overlaps their handles)
    d.line(((10, 22), (6, 6)), fill=STEEL[1], width=2)
    d.line(((6, 6), (8, 4)), fill=STEEL[0], width=1)           # hook
    d.line(((14, 21), (14, 4)), fill=STEEL[1], width=2)
    for k in range(3):                                           # rake
        d.point((15, 5 + k * 3), fill=STEEL[0])
    d.line(((18, 21), (23, 6)), fill=STEEL[1], width=2)
    d.polygon([(23, 3), (25, 5), (23, 7), (21, 5)], fill=STEEL[0])  # diamond
    # tension wrench: L-shape
    d.line(((22, 22), (27, 13)), fill=STEEL[2], width=2)
    d.line(((27, 13), (28, 11)), fill=STEEL[1], width=2)
    # leather wrap
    d.rounded_rectangle((5, 18, 25, 27), radius=3, fill=LEATHER[1])
    d.rectangle((6, 19, 24, 21), fill=LEATHER[0])
    d.line(((6, 26), (24, 26)), fill=LEATHER[2])
    d.line(((15, 18), (15, 27)), fill=LEATHER[2])               # strap
    d.rectangle((14, 21, 16, 23), fill=(214, 176, 72, 255))     # buckle
    return drop_shadow(outline(im), 15, 28, 11, 2)


def lockpick_b():
    """Iron ring holding a hook, a rake and a tension wrench."""
    im = blank(); d = ImageDraw.Draw(im)
    d.ellipse((4, 4, 14, 14), outline=STEEL[2], width=2)       # ring
    d.arc((4, 4, 14, 14), 180, 270, fill=STEEL[0], width=1)
    # tools hang from the ring's lower right
    d.line(((12, 12), (26, 26)), fill=STEEL[1], width=2)        # hook pick
    d.line(((26, 26), (27, 23)), fill=STEEL[0], width=2)
    d.line(((11, 13), (19, 28)), fill=STEEL[1], width=2)        # rake
    for k in range(3):
        d.point((18 - k, 27 - k * 2), fill=STEEL[0])
    d.line(((13, 11), (28, 15)), fill=STEEL[2], width=2)        # wrench
    d.line(((28, 15), (29, 18)), fill=STEEL[1], width=2)
    # leather grips where the tools meet the ring
    for x, y in ((14, 14), (13, 16), (15, 12)):
        d.rectangle((x, y, x + 1, y + 1), fill=LEATHER[1])
    return drop_shadow(outline(im), 17, 28, 10, 2)


# ── Camping Supplies ──────────────────────────────────────────────

def camping_a():
    """Bedroll strapped on top of a canvas pack, tin cup hanging off it."""
    im = blank(); d = ImageDraw.Draw(im)
    # pack body
    d.rounded_rectangle((8, 11, 24, 27), radius=3, fill=CANVAS[1])
    d.rectangle((9, 12, 16, 26), fill=CANVAS[0])
    d.rounded_rectangle((10, 18, 22, 25), radius=2, fill=CANVAS[2])  # pocket
    d.rectangle((15, 18, 17, 20), fill=LEATHER[1])                    # pocket strap
    # bedroll on top
    d.rounded_rectangle((5, 5, 27, 12), radius=4, fill=WOOL[1])
    d.rectangle((7, 6, 25, 8), fill=WOOL[0])
    d.line(((7, 11), (25, 11)), fill=WOOL[2])
    d.ellipse((24, 5, 29, 12), fill=WOOL[2])                           # roll end
    d.ellipse((25, 7, 27, 10), fill=WOOL[0])
    for x in (11, 20):                                                 # straps
        d.rectangle((x, 4, x + 1, 13), fill=LEATHER[2])
    # tin cup on the side
    d.rectangle((2, 18, 6, 23), fill=STEEL[1])
    d.line(((2, 18), (6, 18)), fill=STEEL[0])
    return drop_shadow(outline(im), 16, 28, 11, 2)


def camping_b():
    """Bedroll + firewood bundle + cooking pot."""
    im = blank(); d = ImageDraw.Draw(im)
    # firewood bundle (back)
    for i, y in enumerate((8, 11, 14)):
        d.rounded_rectangle((6 + i, y, 26 - i, y + 3), radius=1, fill=WOOD[1])
        d.line(((7 + i, y), (25 - i, y)), fill=WOOD[0])
        d.ellipse((24 - i, y, 27 - i, y + 3), fill=WOOD[0])
        d.point((25 - i, y + 1), fill=WOOD[2])
    d.rectangle((15, 7, 16, 18), fill=LEATHER[2])                  # cord
    # bedroll (front left)
    d.rounded_rectangle((3, 18, 17, 26), radius=4, fill=WOOL[1])
    d.rectangle((5, 19, 15, 21), fill=WOOL[0])
    d.ellipse((13, 18, 19, 26), fill=WOOL[2])
    d.ellipse((14, 20, 17, 24), fill=WOOL[0])
    # cooking pot (front right)
    d.rectangle((19, 19, 28, 26), fill=STEEL[2])
    d.rectangle((19, 19, 23, 25), fill=STEEL[1])
    d.line(((18, 19), (29, 19)), fill=STEEL[0])
    d.arc((19, 14, 28, 22), 200, 340, fill=STEEL[1])               # handle
    return drop_shadow(outline(im), 16, 28, 12, 2)


def main():
    made = {
        "lockpick_a": lockpick_a(), "lockpick_b": lockpick_b(),
        "camping_supplies_a": camping_a(), "camping_supplies_b": camping_b(),
    }
    # Chosen icons (2026-11-03): Lockpick = option B, Camping Supplies =
    # option A. Only those are written to the game; the others live on
    # in the comparison sheet.
    made["lockpick_b"].save(os.path.join(ITEM_DIR, "lockpick_ring.png"))
    made["camping_supplies_a"].save(os.path.join(ITEM_DIR, "camping_supplies.png"))
    cur = lambda n: Image.open(os.path.join(ITEM_DIR, n + ".png")).convert("RGBA")
    rows = [("Lockpick", [("old", cur("lockpick")), ("option A", made["lockpick_a"]), ("option B", made["lockpick_b"])]),
            ("Camping Supplies", [("old", cur("rock")), ("option A", made["camping_supplies_a"]), ("option B", made["camping_supplies_b"])])]
    S, cw, ch = 4, 170, 190
    sheet = Image.new("RGBA", (190 + 3 * cw, 30 + len(rows) * ch), (26, 26, 40, 255))
    sd = ImageDraw.Draw(sheet)
    try:
        f = ImageFont.load_default(size=16)
    except TypeError:
        f = ImageFont.load_default()
    for r, (title, cells) in enumerate(rows):
        y = 20 + r * ch
        sd.text((16, y + 60), title, font=f, fill=(255, 210, 110, 255))
        for c, (lab, img) in enumerate(cells):
            x = 190 + c * cw
            sd.rectangle((x, y, x + N * S + 12, y + N * S + 12), fill=(20, 20, 32, 255), outline=(70, 70, 92, 255))
            sheet.alpha_composite(img.resize((N * S, N * S), Image.NEAREST), (x + 6, y + 6))
            tw = sd.textlength(lab, font=f)
            sd.text((x + 6 + (N * S - tw) / 2, y + N * S + 18), lab, font=f, fill=(232, 226, 210, 255))
    sheet.save(os.path.join(HERE, "_supplies_sheet.png"))
    print("ok")


if __name__ == "__main__":
    main()
