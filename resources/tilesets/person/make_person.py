"""Base humanoid ('person') sprite in the 3/4 tile style.

Authored on a 32x32 grid (the tiles' 2-px pixel size), scaled 2x to
64x64. Transparent background, 1-art-px dark outline, light from the
top-left (light / mid / shadow skin), plain shorts as a neutral base
for clothing variants, and a soft ground shadow so the figure stands
on the floor tile.

Character colours are their own set, NOT the environment palettes, so
a person looks the same in shops, dungeons and outdoors. Variants
(guard, merchant, ...) swap the CLOTH / HAIR entries.
"""
import os, sys
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
SKIN = [(242, 200, 154, 255), (208, 150, 108, 255), (150, 98, 74, 255)]   # light, mid, shadow
HAIR = [(176, 116, 66, 255), (122, 76, 44, 255), (80, 48, 30, 255)]       # light, mid, dark
CLOTH = [(92, 112, 168, 255), (62, 76, 124, 255)]                          # base, shadow
EYE = OUTLINE
CLEAR = (0, 0, 0, 0)

# Silhouette parts: (name, x0, y0, x1, y1) inclusive, 32-grid.
# Gaps of one column between arms/torso and between the legs become
# outline, which separates the limbs the way the original does.
PARTS = [
    ("hair",   13, 3, 18, 5),
    ("hair",   12, 4, 19, 6),
    ("head",   13, 6, 18, 9),
    ("neck",   15, 10, 16, 10),
    ("torso",  10, 11, 21, 12),     # broad shoulders
    ("torso",  11, 13, 20, 14),     # chest
    ("torso",  12, 15, 19, 16),     # waist (V taper)
    ("shorts", 11, 17, 20, 19),
    ("arm",     8, 12, 9, 15),      # upper arms, angled out
    ("arm",    22, 12, 23, 15),
    ("arm",     7, 16, 8, 19),      # forearms
    ("arm",    23, 16, 24, 19),
    ("hand",    7, 20, 8, 21),
    ("hand",   23, 20, 24, 21),
    ("leg",    11, 20, 13, 23),     # thighs
    ("leg",    18, 20, 20, 23),
    ("leg",    10, 24, 12, 26),     # shins, stance widens
    ("leg",    19, 24, 21, 26),
    ("foot",    9, 27, 12, 27),
    ("foot",   19, 27, 22, 27),
]


def build():
    part = [[None] * N for _ in range(N)]
    for name, x0, y0, x1, y1 in PARTS:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if part[y][x] is None or name == "hair":
                    part[y][x] = name
    # trim: rounded shoulders, hair sides hang beside the face
    for x, y in [(10, 11), (21, 11), (12, 4), (19, 4)]:
        part[y][x] = None
    for y in (6, 7):
        part[y][12] = "hair"; part[y][19] = "hair"

    px = [[CLEAR] * N for _ in range(N)]

    def at(x, y):
        return part[y][x] if 0 <= x < N and 0 <= y < N else None

    # fill with lighting: base light, right column of every horizontal
    # run in mid, last column in shadow; bottom row of a part in mid.
    for y in range(N):
        x = 0
        while x < N:
            if part[y][x] is None:
                x += 1; continue
            x0 = x
            while x < N and part[y][x] is not None and part[y][x] == part[y][x0]:
                x += 1
            x1 = x - 1
            name = part[y][x0]
            for xx in range(x0, x1 + 1):
                w = x1 - x0 + 1
                pos = xx - x0
                shade = 0
                if w >= 3 and pos >= w - (w // 3):
                    shade = 1
                if w >= 2 and pos == w - 1:
                    shade = 2 if w >= 4 else 1
                if at(xx, y + 1) != name and name in ("leg", "arm", "torso", "head"):
                    shade = max(shade, 1)
                if name in ("hair",):
                    px[y][xx] = HAIR[min(2, shade + (1 if y >= 6 else 0))]
                elif name == "shorts":
                    px[y][xx] = CLOTH[1 if shade else 0]
                else:
                    px[y][xx] = SKIN[shade]

    # details
    px[3][14] = HAIR[0]; px[4][13] = HAIR[0]; px[4][14] = HAIR[0]   # hair shine
    px[5][17] = HAIR[2]; px[5][15] = HAIR[1]                        # fringe strands
    px[7][14] = EYE; px[7][17] = EYE                                # eyes
    px[9][15] = SKIN[1]; px[9][16] = SKIN[1]                        # mouth / chin
    for x in (13, 14, 17, 18):
        px[14][x] = SKIN[1]                                         # chest line
    px[16][15] = SKIN[1]                                            # navel
    for x in range(11, 21):
        px[17][x] = CLOTH[1] if x > 16 else CLOTH[0]                # waistband
    px[18][15] = CLOTH[1]; px[18][16] = CLOTH[1]                    # seam
    px[19][15] = CLOTH[1]; px[19][16] = CLOTH[1]                    # crotch seam
    px[23][12] = SKIN[1]; px[23][19] = SKIN[1]                      # knees

    # outline: every empty cell 4-adjacent to the figure
    filled = [[px[y][x] != CLEAR for x in range(N)] for y in range(N)]
    for y in range(N):
        for x in range(N):
            if filled[y][x]:
                continue
            if any(0 <= x + dx < N and 0 <= y + dy < N and filled[y + dy][x + dx]
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[y][x] = OUTLINE

    art = Image.new("RGBA", (N, N))
    art.putdata([c for row in px for c in row])
    art = art.resize((64, 64), Image.NEAREST)

    # ground shadow under the feet, drawn beneath the figure
    sh = Image.new("RGBA", (64, 64), CLEAR)
    ImageDraw.Draw(sh).ellipse([15, 53, 48, 61], fill=(0, 0, 0, 96))
    return Image.alpha_composite(sh, art)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "person.png"
    build().save(out)
    print("wrote", out)
