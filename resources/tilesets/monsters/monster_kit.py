"""Small drawing kit for monster sprites in the 3/4 character style.

Every monster is authored on the shared 32x32 art grid (scaled 2x to
64x64) with the same rules as the hand-built make_skeleton.py /
make_rat.py / make_goblin.py / make_dire_wolf.py sprites:

  - fill named parts, each with a (light, mid, shadow) palette;
  - shade every horizontal run of a part like the base renderers do
    (light, the last third mid, the last pixel shadow; a part's
    bottom edge drops a step) — light from the top-left;
  - paint details on top, then a 1-art-px dark outline round the
    whole silhouette, and a soft ground shadow underneath.

Colours may carry alpha (ghosts, oozes); the outline is drawn round
any non-clear pixel.
"""
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
CLEAR = (0, 0, 0, 0)


class Canvas:
    def __init__(self):
        self.part = [[None] * N for _ in range(N)]
        self.px = [[CLEAR] * N for _ in range(N)]
        self.pal = {}

    # ── parts ──
    def palette(self, name, pal):
        self.pal[name] = pal

    def set(self, name, x, y):
        if 0 <= x < N and 0 <= y < N:
            self.part[y][x] = name

    def rect(self, name, x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(name, x, y)

    def spans(self, name, rows, mirror=False):
        """rows: {y: [(x0, x1), ...]}; mirror=True also fills x -> 31-x."""
        for y, ss in rows.items():
            for x0, x1 in ss:
                for x in range(x0, x1 + 1):
                    self.set(name, x, y)
                    if mirror:
                        self.set(name, N - 1 - x, y)

    def line(self, name, x0, y0, x1, y1, width=1):
        for x, y in bresenham(x0, y0, x1, y1):
            for d in range(width):
                self.set(name, x + d, y)

    def erase(self, x, y):
        if 0 <= x < N and 0 <= y < N:
            self.part[y][x] = None

    # ── paint ──
    def shade(self):
        for y in range(N):
            x = 0
            while x < N:
                if self.part[y][x] is None:
                    x += 1; continue
                x0 = x
                while x < N and self.part[y][x] == self.part[y][x0]:
                    x += 1
                x1, name = x - 1, self.part[y][x0]
                pal = self.pal[name]
                w = x1 - x0 + 1
                for xx in range(x0, x1 + 1):
                    pos = xx - x0
                    s = 0
                    if w >= 3 and pos >= w - (w // 3):
                        s = 1
                    if w >= 2 and pos == w - 1:
                        s = 2 if w >= 4 else 1
                    if y + 1 < N and self.part[y + 1][xx] != name:
                        s = max(s, 1)
                    self.px[y][xx] = pal[min(s, len(pal) - 1)]

    def dot(self, x, y, c):
        if 0 <= x < N and 0 <= y < N:
            self.px[y][x] = c

    def dots(self, pts, c):
        for x, y in pts:
            self.dot(x, y, c)

    def hole(self, x, y):
        """Knock a pixel out (becomes outline / background)."""
        self.dot(x, y, CLEAR)
        self.erase(x, y)

    def render(self, shadow=(15, 52, 48, 61), shadow_alpha=96, outline=OUTLINE):
        px = [row[:] for row in self.px]
        filled = [[px[y][x][3] > 0 for x in range(N)] for y in range(N)]
        for y in range(N):
            for x in range(N):
                if not filled[y][x] and any(
                    0 <= x + dx < N and 0 <= y + dy < N and filled[y + dy][x + dx]
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    px[y][x] = outline
        art = Image.new("RGBA", (N, N))
        art.putdata([c for row in px for c in row])
        art = art.resize((64, 64), Image.NEAREST)
        sh = Image.new("RGBA", (64, 64), CLEAR)
        if shadow:
            ImageDraw.Draw(sh).ellipse(list(shadow), fill=(0, 0, 0, shadow_alpha))
        return Image.alpha_composite(sh, art)


def bresenham(x0, y0, x1, y1):
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        yield x0, y0
        if x0 == x1 and y0 == y1:
            return
        e2 = 2 * err
        if e2 >= dy:
            err += dy; x0 += sx
        if e2 <= dx:
            err += dx; y0 += sy


def alpha(c, a):
    return (c[0], c[1], c[2], a)
