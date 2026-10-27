"""Recolour the Default dungeon tiles to a 3-colour scheme.

Usage:  python3 recolor.py [scheme]      (run from the repo root)

Reads the untouched teal/gold originals in
resources/tilesets/dungeon/teal_gold/ and writes recoloured copies to
web/public/modules/default/sprites/dungeon/. Every tile uses exactly
the source dark / mid / light colours, so this is a straight swap.
Torch and brazier flames get a separate warm FIRE colour so light
sources still read as fire on cold stone.
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(ROOT, "teal_gold")
OUT_DIR = os.path.join(ROOT, "..", "..", "..", "web", "public", "modules",
                       "default", "sprites", "dungeon")
SOURCE = [(8, 7, 20), (0, 180, 170), (255, 190, 55)]   # dark, mid, light
SCHEMES = {
    "cold_stone": {"colors": [(10, 10, 16), (78, 84, 102), (176, 182, 196)],
                   "fire": (255, 170, 60)},
    "torchlit":   {"colors": [(14, 9, 7), (92, 70, 54), (214, 160, 88)],
                   "fire": (255, 190, 80)},
    "mossy_crypt": {"colors": [(8, 14, 11), (64, 88, 72), (178, 196, 150)],
                    "fire": (255, 170, 60)},
    "moonlit":    {"colors": [(7, 9, 20), (48, 60, 104), (156, 176, 214)],
                   "fire": (255, 170, 60)},
    "teal_gold":  {"colors": SOURCE, "fire": None},
}
FIRE_TILES = {"torch.png", "brazier.png"}


# Tiles that now live in another sprites/ folder (relative to the
# Default sprites root), and tiles to leave alone for now.
MOVED = {'chest.png': 'objects', 'crate.png': 'objects', 'pots.png': 'objects', 'brazier.png': 'objects', 'barrel.png': 'objects', 'bones.png': 'objects', 'torch.png': 'objects'}
SKIP = set()


def out_path(f):
    if f in MOVED:
        return os.path.join(OUT_DIR, "..", MOVED[f], f)
    return os.path.join(OUT_DIR, f)


def main(scheme="cold_stone"):
    s = SCHEMES[scheme]
    n = 0
    for f in sorted(os.listdir(SRC_DIR)):
        if not f.endswith(".png") or f in SKIP:
            continue
        im = Image.open(os.path.join(SRC_DIR, f)).convert("RGBA")
        px = im.load()
        mapping = dict(zip(SOURCE, s["colors"]))
        if s["fire"] and f in FIRE_TILES:
            mapping[SOURCE[2]] = s["fire"]
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a and (r, g, b) in mapping:
                    px[x, y] = mapping[(r, g, b)] + (a,)
        im.save(out_path(f))
        n += 1
    print(f"{n} tiles recoloured to {scheme}")


if __name__ == "__main__":
    main(*sys.argv[1:])
