"""Reagent item icons + a one-screen tileset sheet.

Usage: python3 make_reagents.py [ITEM_SPRITE_DIR]
  (ITEM_SPRITE_DIR defaults to web/public/modules/default/sprites/item)

Draws one 32x32 icon per brewing reagent in the item-icon house style
(1px art, dark #202020 outline, light/mid/shadow steps, soft drop
shadow like the potions) and writes:

  <ITEM_SPRITE_DIR>/reagent_<name>.png   the game icons
  reagents_tileset.png                    the raw 32px tiles in a row
  _reagents_sheet.png                     one-screen labelled preview

Reagents (recipes.json uses all five; Healing Herb is shown for
reference since it shares the herb family look):
  brimite_ore       red-black ore chunk with glowing ember veins
  glowcap_mushroom  squat mushroom with a luminous teal cap + spots
  moonpetal         pale lavender five-petal bloom with a silver heart
  serpent_root      coiled brown root with a snake-like forked tip
  spring_water      (existing clear potion — shown, not redrawn)
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


def blank():
    return Image.new("RGBA", (N, N), CLEAR)


def outline(img):
    """Ring every opaque shape with a 1px dark outline (4-neighbour)."""
    px = img.load()
    solid = {(x, y) for y in range(N) for x in range(N) if px[x, y][3] == 255}
    for x, y in list(solid):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            X, Y = x + dx, y + dy
            if 0 <= X < N and 0 <= Y < N and (X, Y) not in solid and px[X, Y][3] < 255:
                px[X, Y] = OUT
    return img


def drop_shadow(img, cx, cy, rx, ry):
    """Soft oval under the item (drawn first, so the item covers it)."""
    sh = blank()
    ImageDraw.Draw(sh).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=SHADOW)
    sh.alpha_composite(img)
    return sh


def shade_ellipse(d, box, light, mid, dark):
    """Filled ellipse lit from the upper left: dark rim on the lower
    right, light highlight upper left."""
    x0, y0, x1, y1 = box
    d.ellipse(box, fill=mid)
    d.ellipse((x0 + 1, y0 + 1, x1, y1), fill=dark)
    d.ellipse((x0, y0, x1 - 1, y1 - 1), fill=mid)
    w, h = x1 - x0, y1 - y0
    d.ellipse((x0 + w * 0.18, y0 + h * 0.15, x0 + w * 0.5, y0 + h * 0.45), fill=light)


# ── the reagents ──────────────────────────────────────────────────

def brimite_ore():
    im = blank(); d = ImageDraw.Draw(im)
    rock = [(14, 7), (21, 9), (26, 15), (25, 22), (18, 26), (9, 24), (6, 17), (8, 11)]
    d.polygon(rock, fill=(86, 40, 44, 255))
    d.polygon([(14, 7), (21, 9), (24, 14), (16, 15), (9, 12)], fill=(122, 58, 60, 255))   # lit top face
    d.polygon([(16, 15), (24, 14), (26, 15), (25, 22), (18, 26)], fill=(58, 26, 32, 255))  # shadow face
    # glowing ember veins
    for a, b in (((10, 18), (15, 16)), ((15, 16), (19, 20)), ((19, 20), (23, 18)), ((13, 11), (17, 13))):
        d.line((a, b), fill=(255, 140, 40, 255))
    for p in ((15, 16), (19, 20), (17, 13)):
        d.point(p, fill=(255, 226, 120, 255))
    return drop_shadow(outline(im), 16, 27, 10, 2)


def glowcap_mushroom():
    im = blank(); d = ImageDraw.Draw(im)
    # stem
    d.rectangle((13, 17, 18, 26), fill=(222, 214, 190, 255))
    d.line(((18, 17), (18, 26)), fill=(176, 166, 140, 255))
    d.line(((13, 26), (18, 26)), fill=(176, 166, 140, 255))
    # cap
    d.pieslice((5, 6, 26, 26), 180, 360, fill=(40, 168, 160, 255))
    d.pieslice((7, 7, 22, 22), 200, 300, fill=(110, 232, 214, 255))
    d.line(((6, 16), (25, 16)), fill=(24, 110, 108, 255))
    # glowing spots
    for p in ((10, 11), (15, 9), (20, 12), (13, 13)):
        d.rectangle((p[0], p[1], p[0] + 1, p[1] + 1), fill=(220, 255, 240, 255))
    img = outline(im)
    return drop_shadow(img, 16, 27, 7, 2)


def moonpetal():
    im = blank(); d = ImageDraw.Draw(im)
    d.line(((16, 20), (16, 28)), fill=(70, 120, 70, 255), width=2)            # stem
    d.ellipse((17, 23, 22, 26), fill=(90, 150, 86, 255))                       # leaf
    petal = [(196, 176, 232, 255), (156, 132, 204, 255)]
    for (x, y) in ((16, 7), (23, 12), (21, 20), (11, 20), (9, 12)):
        d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=petal[1])
        d.ellipse((x - 4, y - 4, x + 2, y + 2), fill=petal[0])
    d.ellipse((12, 10, 20, 18), fill=(226, 230, 240, 255))                     # silver heart
    d.ellipse((13, 11, 17, 15), fill=(255, 255, 255, 255))
    d.point((18, 16), fill=(170, 176, 196, 255))
    return outline(im)


def serpent_root():
    im = blank(); d = ImageDraw.Draw(im)
    dark, mid, light = (88, 56, 34, 255), (132, 88, 52, 255), (176, 128, 78, 255)
    # one continuous S-coil, thick, with a lit upper edge
    path = [(8, 9), (12, 7), (17, 7), (21, 9), (21, 13), (17, 16), (12, 17),
            (9, 20), (10, 24), (15, 26), (21, 25), (25, 22)]
    d.line(path, fill=mid, width=4, joint="curve")
    d.line([(x - 1, y - 1) for x, y in path[:4]], fill=light, width=1)
    d.line([(x, y + 1) for x, y in path[7:]], fill=dark, width=1)
    # forked "tongue" at the head end
    d.line(((7, 9), (3, 7)), fill=(196, 64, 64, 255))
    d.line(((7, 9), (3, 11)), fill=(196, 64, 64, 255))
    # rootlets off the tail
    for a, b in (((14, 27), (13, 29)), ((20, 26), (21, 29)), ((25, 22), (28, 24))):
        d.line((a, b), fill=dark)
    d.point((9, 8), fill=(250, 220, 90, 255))  # eye-knot
    return drop_shadow(outline(im), 16, 28, 9, 2)


def existing(name):
    return Image.open(os.path.join(ITEM_DIR, name + ".png")).convert("RGBA")


NEW = [
    ("brimite_ore", "Brimite Ore", brimite_ore),
    ("glowcap_mushroom", "Glowcap Mushroom", glowcap_mushroom),
    ("moonpetal", "Moonpetal", moonpetal),
    ("serpent_root", "Serpent Root", serpent_root),
]
SHOWN = [("spring_water", "Spring Water", lambda: existing("potion_clear")),
         ("healing_herb", "Healing Herb", lambda: existing("herb"))]


def main():
    tiles = []
    for item_id, label, draw in NEW:
        img = draw()
        img.save(os.path.join(ITEM_DIR, f"reagent_{item_id}.png"))
        tiles.append((label, img))
    for item_id, label, draw in SHOWN:
        tiles.append((label, draw()))

    # raw tileset: 32px tiles in one row, no gaps
    row = Image.new("RGBA", (N * len(tiles), N), CLEAR)
    for i, (_, t) in enumerate(tiles):
        row.alpha_composite(t, (i * N, 0))
    row.save(os.path.join(HERE, "reagents_tileset.png"))

    # one-screen labelled sheet (fits a 1280x720 screen)
    S, cell_w, cell_h = 4, 200, 220
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    W, H = cols * cell_w + 40, rows * cell_h + 80
    sheet = Image.new("RGBA", (W, H), (26, 26, 40, 255))
    sd = ImageDraw.Draw(sheet)
    try:
        title = ImageFont.load_default(size=22)
        font = ImageFont.load_default(size=16)
    except TypeError:
        title = font = ImageFont.load_default()
    sd.text((20, 18), "Reagents", font=title, fill=(255, 210, 110, 255))
    for i, (label, t) in enumerate(tiles):
        cx = 20 + (i % cols) * cell_w
        cy = 60 + (i // cols) * cell_h
        sd.rectangle((cx + 20, cy, cx + 20 + N * S + 16, cy + N * S + 16),
                     outline=(70, 70, 92, 255), fill=(20, 20, 32, 255))
        sheet.alpha_composite(t.resize((N * S, N * S), Image.NEAREST), (cx + 28, cy + 8))
        tw = sd.textlength(label, font=font)
        sd.text((cx + 28 + (N * S - tw) / 2, cy + N * S + 26), label, font=font,
                fill=(232, 226, 210, 255))
    sheet.save(os.path.join(HERE, "_reagents_sheet.png"))
    print("wrote", len(NEW), "icons;", os.path.join(HERE, "_reagents_sheet.png"))


if __name__ == "__main__":
    main()
