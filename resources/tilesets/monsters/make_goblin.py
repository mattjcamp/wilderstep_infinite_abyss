"""Goblin monster sprite in the 3/4 character style.

Small, hunched and wiry: an oversized head with long ears sticking out
sideways, yellow eyes under a heavy brow, a wide grin with two fangs,
long arms, short bowed legs and big bare feet. Scrappy kit: a patched
leather vest, a ragged loincloth with a rope belt, and a crude, notched
iron blade.

Authored on the 32x32 grid every character sprite uses (2x to 64x64),
about halfling height with the feet on the shared ground row (27);
transparent background, dark outline, light from the top-left (each
part is shaded per row: last third mid, last pixel shadow), ground
shadow. Same construction as make_skeleton.py / make_rat.py.
"""
import sys
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
CLEAR = (0, 0, 0, 0)
SKIN = [(146, 186, 86, 255), (104, 146, 62, 255), (70, 104, 46, 255)]     # light, mid, shadow
VEST = [(132, 94, 62, 255), (98, 68, 46, 255), (70, 48, 34, 255)]
CLOTH = [(140, 124, 98, 255), (106, 92, 72, 255), (78, 68, 54, 255)]
ROPE = (176, 150, 98, 255)
IRON = [(186, 176, 164, 255), (132, 120, 110, 255), (92, 80, 72, 255)]
RUST = (150, 84, 52, 255)
GRIP = (92, 58, 40, 255)
EYE = (246, 214, 64, 255)
PUPIL = (22, 14, 20, 255)
MOUTH = (60, 22, 30, 255)
FANG = (240, 234, 210, 255)

# (part, x0, y0, x1, y1) inclusive; later entries win
PARTS = [
    ("skin", 12, 10, 19, 17),          # big head
    ("skin", 8, 12, 11, 12),           # left ear, pointing out and up
    ("skin", 9, 13, 11, 13),
    ("skin", 7, 11, 8, 11),
    ("skin", 20, 12, 23, 12),          # right ear
    ("skin", 20, 13, 22, 13),
    ("skin", 23, 11, 24, 11),
    ("skin", 15, 18, 16, 18),          # neck
    ("vest", 12, 18, 19, 21),          # hunched torso in a vest
    ("cloth", 13, 22, 18, 23),         # loincloth
    ("skin", 10, 18, 11, 20),          # long arms
    ("skin", 20, 18, 21, 20),
    ("skin", 9, 21, 10, 23),
    ("skin", 21, 21, 22, 23),
    ("skin", 9, 24, 10, 24),           # hands
    ("skin", 21, 24, 22, 24),
    ("skin", 13, 24, 14, 26),          # short bowed legs
    ("skin", 17, 24, 18, 26),
    ("skin", 11, 27, 14, 27),          # big bare feet
    ("skin", 17, 27, 20, 27),
]
TRIMS = [(12, 10), (19, 10), (12, 17), (19, 17), (12, 18), (19, 18)]
PAL = {"skin": SKIN, "vest": VEST, "cloth": CLOTH}


def build():
    part = [[None] * N for _ in range(N)]
    for name, x0, y0, x1, y1 in PARTS:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                part[y][x] = name
    for x, y in TRIMS:
        part[y][x] = None

    px = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        x = 0
        while x < N:
            if part[y][x] is None:
                x += 1; continue
            x0 = x
            while x < N and part[y][x] == part[y][x0]:
                x += 1
            x1, name = x - 1, part[y][x0]
            w = x1 - x0 + 1
            for xx in range(x0, x1 + 1):
                pos = xx - x0
                s = 0
                if w >= 3 and pos >= w - (w // 3):
                    s = 1
                if w >= 2 and pos == w - 1:
                    s = 2 if w >= 4 else 1
                if y + 1 < N and part[y + 1][xx] != name:
                    s = max(s, 1)
                px[y][xx] = PAL[name][s]

    # face: heavy brow, yellow eyes, nose, wide fanged grin
    for x in (13, 14, 17, 18):
        px[12][x] = SKIN[2]
    px[13][13] = EYE; px[13][14] = PUPIL
    px[13][17] = PUPIL; px[13][18] = EYE
    px[14][15] = SKIN[1]; px[15][15] = SKIN[1]; px[15][16] = SKIN[2]
    for x in range(13, 19):
        px[16][x] = MOUTH
    px[16][14] = FANG; px[16][17] = FANG
    px[10][14] = (180, 214, 120, 255)     # head shine
    px[12][8] = SKIN[1]; px[12][22] = SKIN[2]   # inner ear
    # vest: open front showing a strip of green belly, a patch, and shoulder seam
    for y in range(19, 22):
        px[y][15] = SKIN[1]; px[y][16] = SKIN[2]
    px[20][13] = CLOTH[1]; px[19][13] = CLOTH[0]
    # rope belt and ragged loincloth hem
    for x in range(13, 19):
        px[22][x] = ROPE if x % 2 == 0 else CLOTH[2]
    px[23][14] = CLEAR; px[23][17] = CLEAR
    # knobbly knees and toes
    px[25][13] = SKIN[1]; px[25][18] = SKIN[2]
    px[27][11] = SKIN[1]; px[27][20] = SKIN[2]

    # crude notched blade, upright in the viewer's-left hand
    for y in (23, 24):
        px[y][8] = SKIN[0]                 # fist
        px[y][7] = GRIP
    px[22][6] = IRON[1]; px[22][7] = IRON[1]; px[22][8] = IRON[2]   # crossbar
    for y in range(16, 22):
        px[y][6] = IRON[0]; px[y][7] = IRON[1]
    px[15][7] = IRON[0]; px[14][7] = IRON[1]                        # hooked tip
    px[18][6] = CLEAR                                               # notch
    px[20][7] = RUST; px[17][7] = RUST

    filled = [[px[y][x] != CLEAR for x in range(N)] for y in range(N)]
    for y in range(N):
        for x in range(N):
            if not filled[y][x] and any(
                0 <= x + dx < N and 0 <= y + dy < N and filled[y + dy][x + dx]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[y][x] = OUTLINE
    art = Image.new("RGBA", (N, N))
    art.putdata([c for row in px for c in row])
    art = art.resize((64, 64), Image.NEAREST)
    sh = Image.new("RGBA", (64, 64), CLEAR)
    ImageDraw.Draw(sh).ellipse([18, 52, 45, 60], fill=(0, 0, 0, 96))
    return Image.alpha_composite(sh, art)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "goblin.png"
    build().save(out)
    print("wrote", out)
