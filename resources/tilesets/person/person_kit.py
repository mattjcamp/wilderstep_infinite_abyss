"""Shared helpers for the class-variant sprite generators
(make_ranger.py, make_alchemist.py, make_druid.py, make_paladin.py).

Same approach as make_fighter.py (whose base part maps this reuses, so
it must sit next to it): load a base person sprite onto its 32x32 art
grid together with its part map, repaint parts as gear while keeping
each pixel's light / mid / shadow step, add props, then redraw the
outline and the ground shadow and scale back up to 64x64.
"""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_fighter as mf   # noqa: E402

N = mf.N
OUTLINE, CLEAR = mf.OUTLINE, mf.CLEAR
SKIN, HAIR, CLOTH = mf.SKIN, mf.HAIR, mf.CLOTH
STEEL, LEATHER, GOLD = mf.STEEL, mf.LEATHER, mf.GOLD
BASES = mf.BASES
bbox = mf.bbox
shade_of = mf.shade_of


class Figure:
    """One base sprite on the art grid: `part` (part names), `src`
    (the base's own pixels) and `px` (the canvas being repainted)."""

    def __init__(self, base_name, base_img):
        self.name = base_name
        self.part, self.shadow = BASES[base_name]()
        self.small = base_name.split("_")[0] in ("halfling", "gnome")
        self.barefoot = base_name.startswith("halfling")
        self.female = base_name.endswith("female")
        p = self.part
        self.src = [[CLEAR] * N for _ in range(N)]
        for y in range(N):
            for x in range(N):
                c = base_img.getpixel((2 * x, 2 * y))
                self.src[y][x] = c if c[3] == 255 else CLEAR
        self.px = [[self.src[y][x] if p[y][x] is not None else CLEAR
                    for x in range(N)] for y in range(N)]
        self.head = bbox(p, "head")
        self.head_top = self.head[1]
        self.torso = bbox(p, "torso")
        self.foot_y = bbox(p, "foot")[1]
        self.shorts = bbox(p, "shorts")
        self.has_belt = self.has("belt")
        self.belt_y = bbox(p, "belt")[1] if self.has_belt else self.shorts[1]
        self.lhand = bbox(p, "hand", "left")
        self.rhand = bbox(p, "hand", "right")
        self.arm_top, self.arm_bot = {}, {}
        for x in range(N):
            ys = mf.column_runs(p, "arm", x)
            if ys:
                self.arm_top[x], self.arm_bot[x] = min(ys), max(ys)
        self.arm_y0 = min(self.arm_top.values())

    def has(self, name):
        return any(self.part[y][x] == name for y in range(N) for x in range(N))

    def shade(self, x, y):
        return shade_of(self.src[y][x])

    def put(self, x, y, c):
        if 0 <= x < N and 0 <= y < N:
            self.px[y][x] = c

    def put_behind(self, x, y, c):
        """Paint only where the figure isn't (for things worn behind it)."""
        if 0 <= x < N and 0 <= y < N and self.px[y][x] == CLEAR:
            self.px[y][x] = c

    def skirt(self, bottom, pal, start=None):
        """Fill between the legs from the hips (or `start`) to `bottom`
        with a shaded skirt run in palette `pal` (light, mid, shadow)."""
        y0 = (self.shorts[3] + 1) if start is None else start
        for y in range(y0, bottom + 1):
            xs = [x for x in range(N) if self.part[y][x] == "leg"]
            if xs:
                for x, s in run_shades(range(min(xs), max(xs) + 1)).items():
                    self.px[y][x] = pal[s]

    def fist(self, hand, side):
        """Close a hand round a held prop: the column just outside it."""
        x0, y0, x1, y1 = hand
        x = x0 - 1 if side < 0 else x1 + 1
        for y in range(y0, y1 + 1):
            self.put(x, y, SKIN[0])
        return x

    def render(self):
        px = self.px
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
        ImageDraw.Draw(sh).ellipse(list(self.shadow), fill=(0, 0, 0, 96))
        return Image.alpha_composite(sh, art)


def run_shades(xs):
    """Light / mid / shadow per x for one horizontal run (same rule as
    the base renderers: last third mid, last pixel shadow)."""
    xs = list(xs)
    x0, x1 = min(xs), max(xs)
    w = x1 - x0 + 1
    out = {}
    for x in range(x0, x1 + 1):
        pos = x - x0
        s = 0
        if w >= 3 and pos >= w - (w // 3):
            s = 1
        if w >= 2 and pos == w - 1:
            s = 2 if w >= 4 else 1
        out[x] = s
    return out


def main(builder, suffix, argv):
    src_dir = argv[1]
    out_dir = argv[2] if len(argv) > 2 else src_dir
    os.makedirs(out_dir, exist_ok=True)
    for name in BASES:
        base = Image.open(os.path.join(src_dir, f"{name}.png")).convert("RGBA")
        builder(Figure(name, base)).save(os.path.join(out_dir, f"{name}_{suffix}.png"))
    print(len(BASES), f"{suffix} sprites ->", out_dir)
