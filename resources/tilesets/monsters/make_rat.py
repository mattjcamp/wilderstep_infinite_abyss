"""Giant Rat monster sprite in the 3/4 character style.

Pose follows the reference line drawing (side view, facing left,
arched back, round ear, pointed snout, tail curling down to the
right). Authored on the 32x32 grid used by every character sprite,
scaled 2x to 64x64: transparent background, dark outline, light from
the top-left, ground shadow, feet on the shared ground row (27).
"""
import sys
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
FUR = [(168, 146, 128, 255), (122, 102, 90, 255), (82, 66, 60, 255)]   # light, mid, dark
BELLY = (190, 172, 152, 255)
PINK = [(226, 160, 160, 255), (178, 112, 118, 255)]                     # skin light, dark
EYE = (196, 36, 40, 255)
SHINE = (255, 236, 220, 255)
CLEAR = (0, 0, 0, 0)

# body mask rows: y -> list of (x0, x1) spans (inclusive)
BODY = {
    14: [(14, 20)],
    15: [(10, 22)],
    16: [(7, 24)],
    17: [(5, 25)],
    18: [(3, 25)],
    19: [(2, 26)],
    20: [(4, 26)],
    21: [(6, 26)],
    22: [(9, 25)],
    23: [(10, 24)],
}
EAR = {12: [(10, 11)], 13: [(9, 12)], 14: [(9, 12)], 15: [(9, 11)]}
LEGS = {   # short legs under the body (fur), paws below (pink)
    24: [(10, 11), (13, 14), (20, 23)],
    25: [(10, 11), (13, 14), (21, 23)],
    26: [(10, 11), (13, 14), (21, 22)],
}
PAWS = {27: [(9, 11), (13, 15), (19, 22)]}
TAIL = [(27, 21), (28, 22), (28, 23), (29, 24), (29, 25), (29, 26), (28, 27),
        (27, 27), (26, 27), (25, 28)]


def spans(d):
    for y, ss in d.items():
        for x0, x1 in ss:
            for x in range(x0, x1 + 1):
                yield x, y


def build():
    px = [[CLEAR] * N for _ in range(N)]
    body = set(spans(BODY))
    top = {}
    bot = {}
    for x, y in body:
        top[x] = min(top.get(x, 99), y)
        bot[x] = max(bot.get(x, -1), y)
    for x, y in body:
        c = FUR[1]
        if y - top[x] <= 1:
            c = FUR[0]                              # light along the back
        if bot[x] - y <= 0:
            c = FUR[2]                              # shade on the underside
        if x >= 23 and y - top[x] > 1:
            c = FUR[2] if x >= 25 else c            # rump turns away from light
        px[y][x] = c
    for x in range(5, 12):                          # pale throat / belly
        if (x, 21) in body: px[21][x] = BELLY
        if (x, 20) in body and x < 9: px[20][x] = BELLY
    for x, y in spans(EAR):
        px[y][x] = FUR[1]
    px[13][10] = PINK[0]; px[14][10] = PINK[0]; px[14][11] = PINK[1]   # inner ear
    for x, y in spans(LEGS):
        px[y][x] = FUR[1] if x not in (11, 14, 23) else FUR[2]
    for x, y in spans(PAWS):
        px[y][x] = PINK[0]
    for i, (x, y) in enumerate(TAIL):
        px[y][x] = PINK[0] if i < 4 else PINK[1]
    # face
    px[19][2] = PINK[1]; px[18][3] = PINK[0]        # nose tip
    px[17][7] = EYE; px[17][8] = OUTLINE; px[16][7] = SHINE
    px[19][5] = FUR[2]                              # mouth line
    # fur strokes along the flank (echo the reference's rib lines)
    for x, y in [(16, 18), (17, 19), (19, 18), (20, 19), (13, 19), (14, 20)]:
        px[y][x] = FUR[2]
    px[15][16] = FUR[0]; px[16][18] = FUR[0]

    filled = [[px[y][x] != CLEAR for x in range(N)] for y in range(N)]
    for y in range(N):
        for x in range(N):
            if not filled[y][x] and any(
                0 <= x + dx < N and 0 <= y + dy < N and filled[y + dy][x + dx]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[y][x] = OUTLINE
    # whiskers (drawn after the outline so they stay thin)
    for x, y in [(1, 17), (0, 16), (1, 20), (0, 21)]:
        px[y][x] = OUTLINE

    art = Image.new("RGBA", (N, N))
    art.putdata([c for row in px for c in row])
    art = art.resize((64, 64), Image.NEAREST)
    sh = Image.new("RGBA", (64, 64), CLEAR)
    ImageDraw.Draw(sh).ellipse([12, 52, 56, 61], fill=(0, 0, 0, 96))
    return Image.alpha_composite(sh, art)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "giant_rat.png"
    build().save(out)
    print("wrote", out)
