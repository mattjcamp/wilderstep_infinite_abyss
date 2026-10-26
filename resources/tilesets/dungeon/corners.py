"""Build the dungeon corner kit from the split tiles.

  wall_corner_tl  the sheet's corner (cap along the top, side strip
                  running down the left edge)
  wall_side_left  the side strip on its own, full height, to fill
                  between a top and a bottom corner
  wall_corner_bl  a normal wall face whose left end meets the side
                  strip coming down from above, so it lines up with
                  plain `wall` tiles beside it
  *_tr / *_right / *_br are mirror images.
"""
import sys, os
from PIL import Image, ImageOps
D = sys.argv[1]
src = os.path.join(D, "wall_corner.png")
if not os.path.exists(src):
    src = os.path.join(D, "wall_corner_tl.png")
tl = Image.open(src).convert("RGBA")
wall = Image.open(os.path.join(D, "wall.png")).convert("RGBA")

STRIP_W = 18
strip = tl.crop((0, 10, STRIP_W, 38))         # one brick period of the strip

side = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
for y in range(-6, 64, strip.height):
    side.alpha_composite(strip, (0, y)) if y >= 0 else side.paste(
        strip.crop((0, -y, STRIP_W, strip.height)), (0, 0))

bl = wall.copy()
bl.paste((0, 0, 0, 0), (0, 0, STRIP_W, 64))   # clear the face's left end
bl.alpha_composite(side.crop((0, 0, STRIP_W, 40)), (0, 0))
# the strip ends in its own short face, like the sheet's corner does
bl.alpha_composite(tl.crop((0, 38, STRIP_W, 64)), (0, 40))

out = {"wall_corner_tl": tl, "wall_corner_tr": ImageOps.mirror(tl),
       "wall_side_left": side, "wall_side_right": ImageOps.mirror(side),
       "wall_corner_bl": bl, "wall_corner_br": ImageOps.mirror(bl)}
for n, im in out.items():
    im.save(os.path.join(D, n + ".png"))
print("ok")
