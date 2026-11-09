"""Generate the 2x1 'Shabby House' town tile (128x64 -> two 64x64 tiles).
Palette is drawn from the existing stone_1 / timber_shop house sprites."""
import sys, random, math
import numpy as np
from PIL import Image

W, H = 128, 64
rng = random.Random(7)
img = np.zeros((H, W, 4), np.uint8)

def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        img[y, x, :3] = c; img[y, x, 3] = 255

def rect(x0, y0, x1, y1, c):          # inclusive
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, c)

def line(x0, y0, x1, y1, c, w=1):
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
        for dx in range(w):
            put(x + dx, y, c)

# ---- palette (all sampled from the existing house sprites)
OUT  = (26, 16, 13); OUT2 = (14, 7, 5); OUT3 = (23, 11, 8)
R = [(72,19,17),(97,26,24),(111,37,29),(135,39,32),(152,43,34),(173,63,46),(214,84,60),(226,116,83)]
# weathered grey-brown planks
GW = [(43,27,19),(53,40,32),(69,59,50),(86,67,53),(102,86,73),(117,101,86),(127,107,89),(143,122,101),(156,130,105)]
BW = [(26,15,10),(41,18,12),(65,35,22),(81,45,27),(99,57,34),(112,65,39),(118,71,43),(135,85,54)]
ST = [(28,26,30),(46,45,48),(68,63,61),(89,77,71),(101,92,84),(117,106,96),(130,116,103),(139,124,110),(153,136,117),(166,147,126)]
DARK = (28,26,30)
IRON = (46,45,48)

# ---- geometry
WX0, WX1 = 12, 115          # wall span
WY0, WY1 = 33, 63           # wall top (under eave) .. ground
EAVE = 31                   # roof bottom edge (centre)
RIDGE = 7

def sag(x):                  # roof sags in the middle
    t = (x - WX0) / (WX1 - WX0)
    return round(1.4 * math.sin(math.pi * t))

# ======================= WALLS (weathered vertical planks)
x = WX0
planks = []
while x <= WX1:
    w = rng.choice([4, 5, 5, 6])
    planks.append((x, min(x + w - 1, WX1))); x += w
for i, (a, b) in enumerate(planks):
    base = rng.choice([3, 4, 4, 5, 5, 6])
    top_off = rng.choice([0, 0, 0, 1, 2])     # ragged tops
    bot_off = rng.choice([0, 0, 1, 2])
    for y in range(WY0 + top_off, WY1 - 4 - bot_off + 1):
        for xx in range(a, b + 1):
            s = base
            if xx == a: s = base + 1          # lit left edge of each board
            if xx == b: s = base - 2          # shadowed right edge
            # vertical grain streaks
            if (xx * 7 + i * 3) % 5 == 0 and rng.random() < 0.55: s -= 1
            if rng.random() < 0.06: s += rng.choice([-1, 1])
            put(xx, y, GW[max(1, min(8, s))])
    # dark gap between boards
    for y in range(WY0, WY1 - 4 + 1):
        put(b, y, GW[0] if rng.random() < 0.85 else GW[1])
    # knots
    if rng.random() < 0.45:
        ky = rng.randint(WY0 + 6, WY1 - 10); kx = (a + b) // 2
        put(kx, ky, GW[1]); put(kx, ky + 1, GW[2])
    # rotten bottom end of some boards
    if bot_off:
        for xx in range(a, b + 1):
            put(xx, WY1 - 4 - bot_off + 1, GW[1])

# horizontal rails (nailed battens) — one sags
for ry, tilt in ((WY0 + 6, 0), (WY1 - 9, 1)):
    for xx in range(WX0, WX1 + 1):
        dy = round(tilt * (xx - WX0) / (WX1 - WX0) * 1.4)
        put(xx, ry + dy, BW[4]); put(xx, ry + dy + 1, BW[3]); put(xx, ry + dy + 2, BW[1])
        if (xx - WX0) % 11 == 3: put(xx, ry + dy + 1, IRON)   # nail heads

# corner posts
for px, lit in ((WX0, True), (WX1 - 2, False)):
    for y in range(WY0, WY1 - 3):
        put(px, y, BW[5] if lit else BW[3]); put(px + 1, y, BW[4] if lit else BW[2]); put(px + 2, y, BW[2] if lit else BW[1])

# missing board patch (dark hole) left of the door
for y in range(48, 55):
    for xx in range(41, 44):
        put(xx, y, DARK if y > 48 else OUT)
put(41, 55, GW[1]); put(43, 47, GW[1])

# ======================= FOUNDATION (rough uneven stones)
fy0 = WY1 - 4
x = WX0 - 1
while x <= WX1 + 1:
    w = rng.randint(4, 7); h = rng.choice([4, 5, 5])
    s = rng.randint(4, 7)
    for y in range(WY1 - h + 1, WY1 + 1):
        for xx in range(x, min(x + w - 1, WX1 + 1) + 1):
            c = s
            if y == WY1 - h + 1: c = s + 2
            if xx == x: c = min(c, s) + 1
            if y == WY1 or xx == min(x + w - 1, WX1 + 1): c = s - 3
            put(xx, y, ST[max(1, min(9, c))])
    x += w
for xx in range(WX0 - 1, WX1 + 2):           # mortar/shadow line at top of foundation
    if img[fy0 - 1, xx, 3]: put(xx, fy0 - 1, GW[1])

# ======================= DOOR (crooked plank door, ajar)
DX0, DX1, DY0 = 57, 72, 39
rect(DX0 - 2, DY0 - 2, DX1 + 2, WY1, BW[1])                 # frame shadow
rect(DX0 - 1, DY0 - 1, DX1 + 1, WY1, BW[4])                 # frame
rect(DX0, DY0, DX1, WY1, DARK)                               # dark interior
for xx in range(DX0, DX1 - 2):                               # door leaf, slightly swung
    k = (xx - DX0) % 4
    c = [BW[5], BW[4], BW[4], BW[2]][k]
    top = DY0 + (1 if xx > DX0 + 8 else 0)
    for y in range(top, WY1 + 1):
        cc = c
        if rng.random() < 0.08: cc = BW[3]
        put(xx, y, cc)
# Z brace
line(DX0, DY0 + 4, DX1 - 3, DY0 + 4, BW[6]); line(DX0, DY0 + 5, DX1 - 3, DY0 + 5, BW[2])
line(DX0, WY1 - 4, DX1 - 3, WY1 - 4, BW[6]); line(DX0, WY1 - 3, DX1 - 3, WY1 - 3, BW[2])
line(DX0 + 1, WY1 - 5, DX1 - 4, DY0 + 6, BW[6]); line(DX0 + 1, WY1 - 4, DX1 - 4, DY0 + 7, BW[2])
# rusty ring handle
for (hx, hy) in ((DX1 - 6, 50), (DX1 - 5, 51), (DX1 - 6, 52), (DX1 - 7, 51)):
    put(hx, hy, OUT)
put(DX1 - 6, 51, BW[1])
# door step: one cracked stone
rect(DX0 - 1, WY1, DX1 + 1, WY1, ST[3])

# ======================= LEFT WINDOW (boarded up)
def window(x0, y0, w, h):
    rect(x0 - 1, y0 - 1, x0 + w, y0 + h, BW[1])
    rect(x0, y0, x0 + w - 1, y0 + h - 1, DARK)
    for xx in range(x0 - 2, x0 + w + 2):                     # sill
        put(xx, y0 + h + 1, BW[5]); put(xx, y0 + h + 2, BW[2])
    for yy in range(y0 - 1, y0 + h + 1):
        put(x0 - 2, yy, BW[4]); put(x0 + w + 1, yy, BW[2])
    for xx in range(x0 - 2, x0 + w + 2):
        put(xx, y0 - 2, BW[4])

window(22, 41, 12, 9)
# two crossed boards
for i in range(-1, 15):
    put(21 + i, 39 + round(i * 0.75), BW[5]); put(21 + i, 40 + round(i * 0.75), BW[3]); put(21 + i, 41 + round(i * 0.75), BW[1])
    put(21 + i, 50 - round(i * 0.55), GW[6]); put(21 + i, 51 - round(i * 0.55), GW[4]); put(21 + i, 52 - round(i * 0.55), GW[1])
put(21, 40, IRON); put(34, 49, IRON); put(22, 51, IRON); put(34, 44, IRON)

# ======================= RIGHT WINDOW (cracked, one shutter hanging)
window(88, 41, 11, 9)
rect(88, 41, 98, 49, (28, 26, 30))
# muntins
line(93, 41, 93, 49, BW[3]); line(88, 45, 98, 45, BW[3])
put(90, 43, ST[4]); put(96, 47, ST[3])                       # faint glints on dirty glass
# left shutter in place (faded red)
rect(84, 40, 86, 51, R[3]); line(84, 40, 84, 51, R[4]); line(86, 40, 86, 51, R[1])
put(85, 44, R[1]); put(85, 47, R[1])
# right shutter hanging by one hinge, tilted
for i in range(12):
    yy = 41 + i; xo = 101 + round(i * 0.45)
    put(xo, yy, R[4]); put(xo + 1, yy, R[3]); put(xo + 2, yy, R[2]); put(xo + 3, yy, OUT3)
put(101, 42, IRON)

# ======================= ROOF (sagging, faded tiles with missing ones & a plank patch)
RX0, RX1 = WX0 - 5, WX1 + 5
def roof_span(y):
    # trapezoid: narrower at ridge
    t = (y - RIDGE) / (EAVE - RIDGE)
    inset = round((1 - t) * 7)
    return RX0 + inset, RX1 - inset

TILE_W, TILE_H = 8, 5
for y in range(RIDGE, EAVE + 2):                 # underlay so slipped tiles never leave holes
    a, b = roof_span(min(y, EAVE))
    for xx in range(a, b + 1):
        put(xx, y + sag(xx), R[0])
rows = list(range(RIDGE, EAVE + 1))
for y in rows:
    a, b = roof_span(y)
    for xx in range(a, b + 1):
        row = (y - RIDGE) // TILE_H
        ry = (y - RIDGE) % TILE_H
        off = (row % 2) * 4
        col = (xx - RX0 + off) % TILE_W
        tile_id = ((xx - RX0 + off) // TILE_W, row)
        trng = random.Random(tile_id[0] * 131 + tile_id[1] * 17 + 5)
        shade = trng.choice([2, 3, 3, 4, 4, 4, 5, 5])
        drop = 1 if trng.random() < 0.18 else 0         # askew tile, slipped a pixel
        if ry == 0:
            c = shade + 1 if col < 5 else shade
        elif ry == TILE_H - 2:
            c = shade - 1
        elif ry == TILE_H - 1:
            c = 0 if col in (0, TILE_W - 1) else 1     # rounded tile bottom
        else:
            c = shade
        if col == TILE_W - 1 and ry < TILE_H - 1: c = min(c, 1)
        if col == 0 and 0 < ry < TILE_H - 2: c = min(6, c + 1)
        # light from the upper left; right end of the roof falls into shade
        if xx > RX1 - 22 and c > 1: c -= 1
        if row == 0 and c > 1: c -= 1                    # under the ridge beam
        put(xx, y + sag(xx) + (drop if ry == TILE_H - 1 else 0), R[max(0, min(7, c))])

# roof outline & eave shadow
for xx in range(RX0, RX1 + 1):
    yb = EAVE + sag(xx)
    put(xx, yb + 1, OUT)
    put(xx, yb + 2, BW[4] if (xx // 9) % 3 else BW[3]); put(xx, yb + 3, BW[2]); put(xx, yb + 4, OUT2)
    if WX0 <= xx <= WX1:
        put(xx, yb + 5, GW[0]); put(xx, yb + 6, GW[1] if rng.random() < .7 else GW[2])
for y in rows:
    a, b = roof_span(y)
    put(a - 1, y + sag(a), OUT); put(b + 1, y + sag(b), OUT)
# ridge beam
a, b = roof_span(RIDGE)
for xx in range(a - 1, b + 2):
    put(xx, RIDGE - 1 + sag(xx), BW[5]); put(xx, RIDGE - 2 + sag(xx), BW[3]); put(xx, RIDGE - 3 + sag(xx), OUT)
put(a - 1, RIDGE - 2 + sag(a), OUT); put(b + 1, RIDGE - 2 + sag(b), OUT)

# missing tiles: dark holes with battens showing
for (mx, my) in ((34, 18), (42, 23), (70, 13)):
    for y in range(my, my + 4):
        for xx in range(mx, mx + 6):
            yy = y + sag(xx)
            put(xx, yy, OUT3 if (y - my) != 2 else BW[2])
    for xx in range(mx, mx + 6):
        put(xx, my - 1 + sag(xx), R[1])

# plank patch nailed over the roof (right side)
PX0, PX1, PY0, PY1 = 88, 106, 16, 26
for k, xx0 in enumerate(range(PX0, PX1, 4)):
    sh = [6, 5, 7, 4, 6][k % 5]
    for xx in range(xx0, min(xx0 + 4, PX1)):
        for y in range(PY0 + (k % 2), PY1 + (k % 3 == 0)):
            c = sh if xx != xx0 + 3 else 1
            if xx == xx0: c = min(8, sh + 1)
            put(xx, y + sag(xx), GW[c])
    put(xx0 + 1, PY0 + 1 + (k % 2) + sag(xx0), IRON); put(xx0 + 1, PY1 - 2 + sag(xx0), IRON)
for xx in range(PX0, PX1):
    put(xx, PY1 + 1 + sag(xx), OUT)
for y in range(PY0, PY1 + 1):
    put(PX1, y + sag(PX1), OUT)

# a couple of slipped tiles hanging over the eave
for (sx, sy) in ((26, EAVE + 3), (80, EAVE + 4)):
    sy += sag(sx)
    rect(sx, sy, sx + 4, sy + 1, R[4]); rect(sx, sy + 2, sx + 4, sy + 2, R[1]); put(sx + 5, sy + 1, OUT)

# ======================= CHIMNEY (crooked stovepipe of rough stone, leaning)
CX, CY0, CY1 = 28, 0, 15
for y in range(CY0 + 2, CY1 + 1):
    lean = round((CY1 - y) * 0.18)
    course = (y - CY0 - 2) // 3
    for i in range(8):
        xx = CX + i + lean
        joint = (i + (course % 2) * 2) % 5 == 4
        s_ = 7 if i < 2 else (6 if i < 5 else 4)
        if (y - CY0 - 2) % 3 == 2 or joint: s_ = 2
        elif (y - CY0 - 2) % 3 == 0: s_ += 1
        put(xx, y, ST[min(9, s_)])
    put(CX - 1 + lean, y, OUT); put(CX + 8 + lean, y, OUT)
# broken cap
lean = round((CY1 - CY0 - 2) * 0.18)
for i in range(-1, 9):
    put(CX + i + lean, CY0 + 1, ST[8] if i < 4 else ST[5])
    put(CX + i + lean, CY0, OUT)
put(CX + 6 + lean, CY0, (0, 0, 0)); img[CY0, CX + 6 + lean, 3] = 0     # chipped corner
put(CX + 2 + lean, CY0 + 2, OUT); put(CX + 3 + lean, CY0 + 2, OUT)     # flue

# ======================= small debris: leaning plank & bucket by the wall
for i in range(18):                              # loose board leaning against right wall
    put(108 + round(i * 0.18), 45 + i, GW[6]); put(109 + round(i * 0.18), 45 + i, GW[4]); put(110 + round(i * 0.18), 45 + i, GW[1])
# bucket near door
for y in range(57, 63):
    for xx in range(46, 52):
        put(xx, y, BW[4] if xx < 48 else BW[3] if xx < 50 else BW[1])
for xx in range(45, 53):
    put(xx, 57, IRON); put(xx, 61, IRON)
for xx in range(46, 52): put(xx, 56, OUT)
put(45, 58, OUT); put(52, 58, OUT)

# ======================= finalize: snap to palette, write
pal = [OUT, OUT2, OUT3, DARK, IRON] + R + GW + BW + ST
P = np.array(pal, float)
rgb = img[..., :3].astype(float)
d = ((rgb[..., None, :] - P[None, None]) ** 2).sum(-1)
img[..., :3] = P[d.argmin(-1)].astype(np.uint8)
im = Image.fromarray(img, "RGBA")
out = sys.argv[1] if len(sys.argv) > 1 else "."
im.save(f"{out}/house_shabby_full.png")
for c in range(2):
    im.crop((c * 64, 0, c * 64 + 64, 64)).save(f"{out}/house_shabby_r0c{c}.png")
