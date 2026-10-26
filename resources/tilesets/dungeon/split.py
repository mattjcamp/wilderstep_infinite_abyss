"""Split the 'RPG TILESET' sheet into 64x64 dungeon tiles.

Each tile on the sheet is ~176 px square (a 64-px design upscaled
~2.75x). We crop the square, box-downscale to 64x64 and snap every
pixel to the sheet's 3-colour palette. Wall pieces and props get a
transparent background (the dark #080714) so they can sit on a floor
via background_sprite; floors / water / pits stay opaque.
"""
import sys, os
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
DARK, TEAL, GOLD = (8, 7, 20), (0, 180, 170), (255, 190, 55)
PAL = np.array([DARK, TEAL, GOLD])
S = 176  # source tile size
XS = [25, 230, 435, 641, 845, 1050]

GRID = {  # y0: [(name, transparent_dark)]
    60: [("floor_cobble", 0), ("floor_flagstone", 0), ("floor_smooth", 0),
         ("floor_pebbles", 0), ("floor_brick", 0), ("floor_planks", 0)],
    278: [("wall", 1), ("wall_archway", 1), ("wall_alt", 1),
          ("wall_pillar", 1), ("wall_corner", 1), ("wall_t", 1)],
    490: [("wall_step", 1), ("wall_window", 1), ("wall_corner_inner", 1),
          ("wall_cross", 1), ("wall_banner", 1), ("wall_portcullis", 1)],
    861: [("water", 0), ("pit_edge", 0), ("pit", 0),
          ("floor_grate", 0), ("stairs", 0), ("door", 0)],
}
# Props row: (name, x0, x1). Band y 700..835.
PROPS = [("chest", 27, 145), ("crate", 189, 288), ("barrel", 335, 421),
         ("pots", 491, 621), ("torch", 705, 751), ("brazier", 829, 900),
         ("rubble", 946, 1080), ("bones", 1107, 1216)]
PROP_Y = (700, 836)


def snap(img, transparent):
    a = np.asarray(img.convert("RGB")).astype(int)
    d = ((a[:, :, None, :] - PAL[None, None]) ** 2).sum(-1)
    idx = d.argmin(-1)
    rgb = PAL[idx].astype(np.uint8)
    alpha = np.where((idx == 0) & transparent, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def main():
    src = Image.open(SRC).convert("RGB")
    os.makedirs(OUT, exist_ok=True)
    names = []
    for y0, row in GRID.items():
        for x0, (name, tr) in zip(XS, row):
            crop = src.crop((x0, y0, x0 + S + 1, y0 + S + 1))
            tile = snap(crop.resize((64, 64), Image.BOX), bool(tr))
            tile.save(os.path.join(OUT, f"{name}.png")); names.append(name)
    k = 64 / (S + 1)
    for name, x0, x1 in PROPS:
        crop = src.crop((x0 - 4, PROP_Y[0], x1 + 5, PROP_Y[1]))
        w, h = round(crop.width * k), round(crop.height * k)
        small = snap(crop.resize((w, h), Image.BOX), True)
        tile = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        tile.alpha_composite(small, ((64 - w) // 2, 64 - h - 6))
        tile.save(os.path.join(OUT, f"{name}.png")); names.append(name)
    print(len(names), "tiles")


main()
