"""Skeleton monster sprite in the 3/4 character style.

Pose follows the reference sketch: big skull, hunched shoulders, arms
bent outward ending in claws, ribs on a spine, pelvis, bowed legs in a
wide stance. Authored on the 32x32 grid every character sprite uses
(2x to 64x64), human height with the feet on the shared ground row
(27); transparent background, dark outline (which also fills the gaps
between ribs and bones), light from the top-left, ground shadow.
"""
import sys
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
BONE = [(240, 230, 202, 255), (196, 182, 152, 255), (138, 124, 104, 255)]  # light, mid, shadow
SOCKET = (22, 14, 20, 255)
GLOW = (214, 64, 52, 255)
CLEAR = (0, 0, 0, 0)

L, M, S = 0, 1, 2
cells = {}


def put(x, y, shade=L):
    cells[(x, y)] = shade


def hline(y, x0, x1, shade=L):
    for x in range(x0, x1 + 1):
        put(x, y, shade)


# skull
hline(3, 13, 18)
for y in range(4, 9):
    hline(y, 12, 19)
for y in range(4, 9):
    put(19, y, M); put(18, y, M) if y >= 7 else None
hline(8, 12, 19, M)
hline(9, 13, 18, M)                     # upper teeth row
hline(10, 14, 17, S)                    # jaw
# spine + collarbones
put(15, 11, M); put(16, 11, S)
hline(12, 10, 21)
put(20, 12, M); put(21, 12, M)
for y in range(12, 20):
    put(15, y, L); put(16, y, M)
# ribs (gaps between them become outline)
for y, (x0, x1) in ((13, (12, 19)), (15, (12, 19)), (17, (13, 18))):
    hline(y, x0, x1)
    put(x1, y, M); put(x1 - 1, y, M)
# pelvis
put(12, 20, L); hline(20, 13, 18); put(19, 20, M)
hline(21, 14, 17, M)
# arms: down and out, bent at the elbow, claws
for x, y in [(9, 13), (9, 14), (8, 15), (8, 16), (7, 17), (7, 18), (7, 19), (6, 20)]:
    put(x, y)
for x, y in [(22, 13), (22, 14), (23, 15), (23, 16), (24, 17), (24, 18), (24, 19), (25, 20)]:
    put(x, y, M)
for x, y in [(5, 21), (7, 21), (5, 22), (7, 22), (6, 21)]:
    put(x, y)
for x, y in [(24, 21), (26, 21), (24, 22), (26, 22), (25, 21)]:
    put(x, y, M)
# legs: bowed, wide stance
for x, y in [(13, 22), (12, 23), (11, 24), (11, 25), (11, 26)]:
    put(x, y)
for x, y in [(18, 22), (19, 23), (20, 24), (20, 25), (20, 26)]:
    put(x, y, M)
hline(27, 9, 12); put(12, 27, M)        # feet
hline(27, 19, 22, M)


def build():
    px = [[CLEAR] * N for _ in range(N)]
    for (x, y), sh in cells.items():
        px[y][x] = BONE[sh]
    # face: sockets with a faint glow, nose hole, teeth gaps
    for x, y in [(13, 5), (14, 5), (13, 6), (14, 6), (17, 5), (18, 5), (17, 6), (18, 6)]:
        px[y][x] = SOCKET
    px[6][14] = GLOW; px[6][17] = GLOW
    px[7][15] = SOCKET; px[7][16] = SOCKET
    for x in (14, 16, 18):
        px[9][x] = SOCKET
    px[3][14] = (255, 248, 228, 255)    # skull shine
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
    ImageDraw.Draw(sh).ellipse([15, 53, 48, 61], fill=(0, 0, 0, 96))
    return Image.alpha_composite(sh, art)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "skeleton.png"
    build().save(out)
    print("wrote", out)
