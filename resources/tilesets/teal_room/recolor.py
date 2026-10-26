"""Recolour the Default shop tiles (sprites/indoor/<shop pieces>).

Usage:  python3 resources/tilesets/teal_room/recolor.py [scheme]
        (run from the repo root)

Reads the teal/gold 3/4-view originals in teal_room/teal_gold/ and
writes recoloured copies over web/public/modules/default/sprites/indoor/.
Only the shop pieces listed in teal_gold/ are touched. Every tile uses
exactly the source dark / mid / light colours, so this is a straight
swap; the lantern's light keeps a warm GLOW so it reads as a lamp.
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(ROOT, "teal_gold")
OUT_DIR = os.path.join(ROOT, "..", "..", "..", "web", "public", "modules",
                       "default", "sprites", "indoor")
SOURCE = [(8, 7, 20), (0, 180, 170), (255, 190, 55)]   # dark, mid, light
GLOW = (255, 200, 90)
SCHEMES = {
    "warm_timber":     [(22, 13, 9), (140, 90, 52), (236, 196, 128)],
    "market_green":    [(9, 17, 13), (46, 112, 82), (230, 204, 122)],
    "burgundy_brass":  [(18, 8, 12), (124, 46, 58), (238, 192, 112)],
    "harbour_blue":    [(8, 12, 22), (46, 98, 142), (238, 224, 192)],
    "plum_sage":       [(16, 10, 20), (96, 66, 112), (196, 214, 160)],
    "teal_gold":       SOURCE,
}
GLOW_TILES = {"lantern.png"}


def main(scheme="warm_timber"):
    colors = SCHEMES[scheme]
    n = 0
    for f in sorted(os.listdir(SRC_DIR)):
        if not f.endswith(".png"):
            continue
        im = Image.open(os.path.join(SRC_DIR, f)).convert("RGBA")
        px = im.load()
        mapping = dict(zip(SOURCE, colors))
        if f in GLOW_TILES and scheme != "teal_gold":
            mapping[SOURCE[2]] = GLOW
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a and (r, g, b) in mapping:
                    px[x, y] = mapping[(r, g, b)] + (a,)
        im.save(os.path.join(OUT_DIR, f))
        n += 1
    print(f"{n} shop tiles recoloured to {scheme}")


if __name__ == "__main__":
    main(*sys.argv[1:])
