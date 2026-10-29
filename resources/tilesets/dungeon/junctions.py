"""Dungeon wall junctions built from the room-wall pieces so they fit.

Usage: python3 junctions.py SPRITE_DIR

Reads wall_top, wall_left, wall_right, wall_corner_tl and wall_corner_bl
from SPRITE_DIR and writes the junction pieces next to them. Every piece
reuses those tiles' pixels, so caps, faces and side strips line up:

  wall_divider      a free-standing wall running north-south: the side
                    strip, centred in the tile
  wall_divider_top  its north end (the strip starts with a cap)
  wall_divider_end  its south end (the strip ends in a short face)
  wall_t_down       a top/bottom wall with a divider leaving it downward
  wall_t_up         a top/bottom wall that a divider runs into from above
  wall_cross        a divider crossing a top/bottom wall
  wall_t_left       a left side wall with a wall leaving it to the right
  wall_t_right      a right side wall with a wall leaving it to the left

Run it on both the teal/gold originals and the recoloured sprites.
"""
import os, sys
from PIL import Image

D = sys.argv[1]
L = lambda n: Image.open(os.path.join(D, n + ".png")).convert("RGBA")
top, left, right = L("wall_top"), L("wall_left"), L("wall_right")
tl, bl = L("wall_corner_tl"), L("wall_corner_bl")

S0, S1 = 0, 18          # the left side strip occupies columns 0..17
C0 = 23                 # where a strip goes when centred (23..40)
CLEAR = (0, 0, 0, 0)


def strip_from(src, y0=0, y1=64):
    """Columns 0..17 of `src`, rows y0..y1."""
    return src.crop((S0, y0, S1, y1))


def centred(*parts, base=None):
    """Put strip pieces (image, y) in the middle of `base` (or empty)."""
    im = base.copy() if base else Image.new("RGBA", (64, 64), CLEAR)
    if base:
        im.paste(CLEAR, (C0, 0, C0 + S1, 64))
    for part, y in parts:
        im.alpha_composite(part, (C0, y))
    return im


pieces = {
    "wall_divider": centred((strip_from(left), 0)),
    "wall_divider_top": centred((strip_from(tl), 0)),
    "wall_divider_end": centred((strip_from(bl), 0)),
    "wall_t_down": centred((strip_from(tl), 0), base=top),
    "wall_t_up": centred((strip_from(bl), 0), base=top),
    "wall_cross": centred((strip_from(left), 0), base=top),
}
t_left = top.copy()
t_left.paste(CLEAR, (0, 0, S1, 64))
t_left.alpha_composite(strip_from(left), (0, 0))
pieces["wall_t_left"] = t_left
t_right = top.copy()
t_right.paste(CLEAR, (64 - S1, 0, 64, 64))
t_right.alpha_composite(right.crop((64 - S1, 0, 64, 64)), (64 - S1, 0))
pieces["wall_t_right"] = t_right

for n, im in pieces.items():
    im.save(os.path.join(D, n + ".png"))
print(len(pieces), "junction pieces ->", D)
