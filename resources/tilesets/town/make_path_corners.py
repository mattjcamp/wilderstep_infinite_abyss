"""Four path corners that join path_straight_v / path_straight_h.
Usage: python3 make_path_corners.py STRAIGHT_V STRAIGHT_H OUT_DIR"""
import os, sys
from PIL import Image
V = Image.open(sys.argv[1]).convert("RGBA"); H = Image.open(sys.argv[2]).convert("RGBA")
OUT = sys.argv[3]; os.makedirs(OUT, exist_ok=True)
VX0, VX1, VL, VR = 15, 46, 20, 41     # vertical band, edge zones x<=VL / x>=VR
HY0, HY1, HT, HB = 17, 45, 18, 37     # horizontal band, edge zones y<=HT / y>=HB
TAN = (186, 156, 108, 255)
CLEAR = (0, 0, 0, 0)

def corner(up, left):
    """up: vertical arm goes to the top (else bottom); left: horizontal arm goes left (else right)."""
    im = Image.new("RGBA", (64, 64), CLEAR)
    for y in range(64):
        for x in range(64):
            inV, inH = VX0 <= x <= VX1, HY0 <= y <= HY1
            varm = inV and ((y < HY0) if up else (y > HY1))
            harm = inH and ((x < VX0) if left else (x > VX1))
            if varm:
                p = V.getpixel((x, y))
            elif harm:
                p = H.getpixel((x, y))
            elif inV and inH:                       # the turn
                closed_h = y >= HB if up else y <= HT          # closed top/bottom edge
                closed_v = x >= VR if left else x <= VL         # closed left/right edge
                if closed_h and closed_v:                       # outer corner: round it
                    dx = (x - VR) if left else (VL - x)
                    dy = (y - HB) if up else (HT - y)
                    hz = (HY1 - HB) if up else (HT - HY0)
                    vz = (VX1 - VR) if left else (VL - VX0)
                    if (dx / max(vz, 1)) ** 2 + (dy / max(hz, 1)) ** 2 > 1.6:
                        continue
                    p = H.getpixel((x, y)) if dy >= dx * hz / max(vz, 1) else V.getpixel((x, y))
                elif closed_h:
                    p = H.getpixel((x, y))
                elif closed_v:
                    p = V.getpixel((x, y))
                else:
                    hi = HT < y < HB; vi = VL < x < VR
                    p = H.getpixel((x, y)) if hi else (V.getpixel((x, y)) if vi else TAN)
                    if p[3] == 0: p = TAN
            else:
                continue
            im.putpixel((x, y), p)
    return im

def junction(up, down, left, right):
    """T-junctions and the cross: arms on the given sides. The centre
    square keeps an edge only on sides with no arm; where two arms meet
    the corner is left open, as on the bends."""
    im = Image.new("RGBA", (64, 64), CLEAR)
    for y in range(64):
        for x in range(64):
            inV, inH = VX0 <= x <= VX1, HY0 <= y <= HY1
            if inV and ((up and y < HY0) or (down and y > HY1)):
                p = V.getpixel((x, y))
            elif inH and ((left and x < VX0) or (right and x > VX1)):
                p = H.getpixel((x, y))
            elif inV and inH:
                if not up and y <= HT or not down and y >= HB:
                    p = H.getpixel((x, y))
                elif not left and x <= VL or not right and x >= VR:
                    p = V.getpixel((x, y))
                else:
                    hi = HT < y < HB; vi = VL < x < VR
                    p = H.getpixel((x, y)) if hi else (V.getpixel((x, y)) if vi else TAN)
                    if p[3] == 0 or (p[0] < 120 and not (hi and vi)): p = TAN
            else:
                continue
            im.putpixel((x, y), p)
    return im


for name, up, left in (("tl", False, False), ("tr", False, True), ("bl", True, False), ("br", True, True)):
    corner(up, left).save(os.path.join(OUT, f"path_bend_{name}.png"))
JUNCTIONS = {"cross": (True, True, True, True),
             "t_left": (True, True, True, False), "t_right": (True, True, False, True),
             "t_up": (True, False, True, True), "t_down": (False, True, True, True)}
for name, arms in JUNCTIONS.items():
    junction(*arms).save(os.path.join(OUT, f"path_{name}.png"))
