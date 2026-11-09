"""Derive Top-Wall versions of the shop window tiles.

The bottom-wall window tiles overlay the cap/panel strip that occupies rows
36-63 of shop/wall_bottom.png. shop/wall_top.png carries the identical strip
at rows 0-27, so each window is shifted up 36 rows. Everything below the strip
is left transparent so the tile's background (shop/wall_top.png) supplies the
brick, the same way the originals rely on shop/wall_bottom.png.

Usage: python3 make_top_windows.py [SPRITE_DIR]   (default: the live shop dir)
"""
import os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOP = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    HERE, "..", "..", "..", "web", "public", "modules", "default", "sprites", "shop")
SHIFT = 36          # wall_bottom strip top row -> wall_top strip top row (0)

for part in ("left", "right", "single"):
    src = Image.open(os.path.join(SHOP, f"window_{part}.png")).convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    out.paste(src.crop((0, SHIFT, src.width, src.height)), (0, 0))
    out.save(os.path.join(SHOP, f"window_top_{part}.png"))
    print("wrote", f"window_top_{part}.png")
