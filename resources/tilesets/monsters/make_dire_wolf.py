"""Dire Wolf monster sprite in the 3/4 character style.

Side view facing left like the Giant Rat, but big enough to fill the
tile: a heavy grey wolf with its head low and forward in a snarl —
pricked ears, a glowing amber eye, bared fangs, raised hackles along
the back, a pale chest ruff and belly, long legs (far-side legs a step
darker) and a bushy drooping tail.

Authored on the 32x32 grid every character sprite uses (2x to 64x64),
feet on the shared ground row (27); transparent background, dark
outline, light from the top-left (each row of fur is shaded: last
third mid, last pixel shadow), ground shadow. Same construction as
make_rat.py / make_skeleton.py / make_goblin.py.
"""
import sys
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
CLEAR = (0, 0, 0, 0)
FUR = [(116, 110, 118, 255), (82, 76, 86, 255), (56, 52, 62, 255)]       # light, mid, shadow
FAR = [(84, 78, 88, 255), (62, 58, 68, 255), (44, 40, 50, 255)]        # far-side legs
PALE = [(176, 170, 168, 255), (138, 132, 132, 255)]                      # ruff / belly
HACKLE = (40, 36, 46, 255)
EYE = (250, 196, 58, 255)
NOSE = (30, 24, 30, 255)
MOUTH = (110, 30, 40, 255)
FANG = (246, 240, 222, 255)

# part -> {row: [(x0, x1), ...]}
FUR_SPANS = {
    5: [(7, 7), (10, 10)],                    # ear tips
    6: [(6, 8), (9, 11)],
    7: [(6, 11)],
    8: [(5, 12)],                             # skull
    9: [(4, 13), (16, 17), (20, 21), (23, 24)],   # + hackle tufts on the back
    10: [(3, 28)],                            # neck, back and tail root
    11: [(2, 26)],
    12: [(1, 26)],                            # snout tip
    13: [(2, 26)],
    14: [(3, 26)],                            # jaw
    15: [(6, 26)],
    16: [(9, 26)],
    17: [(10, 25)],
    18: [(11, 18), (21, 25)],                 # deep chest, tucked belly, thigh
    19: [(11, 17), (21, 25)],
    20: [(12, 17), (22, 25)],
    21: [(13, 15), (22, 25)],                 # near legs (hind leg angles
    22: [(13, 15), (22, 24)],                 #  back at the hock)
    23: [(13, 15), (23, 25)],
    24: [(13, 15), (24, 25)],
    25: [(13, 15), (24, 25)],
    26: [(13, 15), (24, 25)],
    27: [(13, 16), (23, 26)],                 # paws
}
TAIL_SPANS = {
    11: [(28, 29)], 12: [(28, 30)], 13: [(29, 30)], 14: [(29, 30)],
    15: [(29, 30)], 16: [(28, 29)], 17: [(28, 28)],
}
FAR_SPANS = {   # far-side legs, a step darker, a stride behind the near ones
    20: [(10, 11), (19, 20)],
    21: [(10, 11), (19, 20)],
    22: [(10, 11), (19, 20)],
    23: [(10, 11), (20, 21)],
    24: [(10, 11), (20, 21)],
    25: [(10, 11), (20, 21)],
    26: [(10, 11), (20, 21)],
    27: [(9, 11), (19, 22)],
}


def build():
    part = [[None] * N for _ in range(N)]
    for name, spans in (("fur", FUR_SPANS), ("fur", TAIL_SPANS), ("far", FAR_SPANS)):
        for y, ss in spans.items():
            for x0, x1 in ss:
                for x in range(x0, x1 + 1):
                    part[y][x] = name

    pal = {"fur": FUR, "far": FAR}
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
                if y + 1 < N and part[y + 1][xx] is None:
                    s = max(s, 1)
                px[y][xx] = pal[name][s]

    # dark hackles along the spine
    for x, y in [(16, 9), (17, 9), (20, 9), (21, 9), (23, 9), (24, 9),
                 (14, 10), (15, 10), (18, 10), (19, 10), (22, 10), (25, 10)]:
        px[y][x] = HACKLE
    # pale chest ruff, throat and belly line
    for x, y in [(7, 15), (8, 15), (9, 15), (10, 15), (9, 16), (10, 16), (11, 16),
                 (10, 17), (11, 17), (12, 17), (11, 18), (12, 18), (12, 19), (13, 20)]:
        px[y][x] = PALE[0]
    for x in range(14, 19):
        px[18][x] = PALE[1]
    # ears: dark inner ear
    px[7][7] = FUR[2]; px[7][10] = FUR[2]
    # face: heavy brow, glowing eye, nose, snarl with fangs
    px[8][7] = FUR[2]; px[8][8] = FUR[2]
    px[9][8] = EYE; px[9][9] = FUR[2]
    px[12][1] = NOSE; px[11][2] = NOSE
    for x in range(2, 9):
        px[13][x] = MOUTH
    px[13][3] = FANG; px[13][6] = FANG; px[12][4] = FANG
    px[11][5] = FUR[2]; px[11][6] = FUR[2]                # snarl wrinkles
    px[9][5] = (156, 150, 156, 255)                        # head shine
    # pale tail tip
    px[17][28] = PALE[1]; px[16][29] = PALE[1]

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
    ImageDraw.Draw(sh).ellipse([16, 52, 58, 61], fill=(0, 0, 0, 96))
    return Image.alpha_composite(sh, art)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "dire_wolf.png"
    build().save(out)
    print("wrote", out)
