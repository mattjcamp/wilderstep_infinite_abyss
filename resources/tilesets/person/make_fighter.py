"""Fighter variants of every base person sprite.

Usage: python3 make_fighter.py PERSON_SPRITE_DIR [OUT_DIR]
  (PERSON_SPRITE_DIR = web/public/modules/default/sprites/person;
   OUT_DIR defaults to the same folder)

Reads each base sprite (person_male.png, dwarf_female.png, ...) and
writes <base>_fighter.png next to it. The base art is NOT redrawn: the
script rebuilds each base's part map from its generator
(make_person.py / make_person_female.py / make_small_folk.py, which
must sit next to this file) and repaints the parts as fighter gear,
keeping the base's own lighting (each pixel's light / mid / shadow
step carries over to the new colour). Faces, hair, beards and braids
stay as drawn, so race and gender still read at a glance.

The fighter kit (same on everyone):
  - steel open helm over the crown of the hair
  - steel breastplate over the torso, steel pauldrons on the shoulders
  - red tabard skirt over the shorts, leather belt with a gold buckle
  - leather bracers, dark trousers and leather boots
    (halflings keep their bare, hairy feet)
  - a sword held upright in the right hand (viewer's left)
  - a red heater shield with a steel rim and gold boss on the left arm

Same construction rules as the bases: 32x32 art grid scaled 2x to
64x64, 1-art-px dark outline around the figure, light from the top
left, and the base's soft ground shadow.
"""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_person as mp           # noqa: E402
import make_person_female as mpf   # noqa: E402
import make_small_folk as msf      # noqa: E402

N = 32
OUTLINE = mp.OUTLINE
CLEAR = (0, 0, 0, 0)
SKIN, HAIR, CLOTH = mp.SKIN, mp.HAIR, mp.CLOTH

STEEL = [(206, 214, 224, 255), (146, 156, 174, 255), (92, 100, 120, 255)]   # light, mid, shadow
RED = [(186, 54, 52, 255), (128, 34, 42, 255)]                             # tabard / shield field
LEATHER = [(150, 100, 60, 255), (106, 68, 40, 255), (70, 44, 28, 255)]
TROUSER = [(92, 82, 90, 255), (64, 56, 66, 255), (46, 40, 50, 255)]
GOLD = [(240, 200, 96, 255), (186, 140, 58, 255)]


# ── Part maps of the bases ────────────────────────────────────────
def _grid(parts, wins=("hair",)):
    part = [[None] * N for _ in range(N)]
    for name, x0, y0, x1, y1 in parts:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if part[y][x] is None or name in wins:
                    part[y][x] = name
    return part


def person_male_parts():
    part = _grid(mp.PARTS)
    for x, y in [(10, 11), (21, 11), (12, 4), (19, 4)]:
        part[y][x] = None
    for y in (6, 7):
        part[y][12] = "hair"; part[y][19] = "hair"
    return part, (15, 53, 48, 61)


def person_female_parts():
    part = _grid(mpf.PARTS)
    for x, y in [(12, 4), (19, 4), (11, 6), (20, 6)]:
        part[y][x] = None
    return part, (17, 53, 46, 61)


def small_folk_parts(fn):
    """Run a make_small_folk builder with its render() swapped for a
    recorder, and rebuild the part map exactly the way render() does."""
    got = {}
    real = msf.render

    def spy(parts, trims=(), details=(), hair_dark_from=99, shadow=(17, 53, 46, 61)):
        got.update(parts=parts, trims=trims, shadow=shadow)
        return real(parts, trims, details, hair_dark_from, shadow)

    msf.render = spy
    try:
        fn()
    finally:
        msf.render = real
    part = _grid(got["parts"], wins=msf.HAIR_PARTS + ("belt", "top"))
    for x, y in got["trims"]:
        part[y][x] = None
    return part, got["shadow"]


BASES = {
    "person_male": person_male_parts,
    "person_female": person_female_parts,
    "halfling_male": lambda: small_folk_parts(lambda: msf.halfling(False)),
    "halfling_female": lambda: small_folk_parts(lambda: msf.halfling(True)),
    "dwarf_male": lambda: small_folk_parts(lambda: msf.dwarf(False)),
    "dwarf_female": lambda: small_folk_parts(lambda: msf.dwarf(True)),
    "gnome_male": lambda: small_folk_parts(lambda: msf.gnome(False)),
    "gnome_female": lambda: small_folk_parts(lambda: msf.gnome(True)),
}


# ── Helpers ───────────────────────────────────────────────────────
def shade_of(c):
    """Light / mid / shadow step (0, 1, 2) of a base pixel."""
    for pal in (SKIN, HAIR):
        if c in pal:
            return pal.index(c)
    if c in CLOTH:
        return CLOTH.index(c)
    return 1


def bbox(part, name, side=None):
    pts = [(x, y) for y in range(N) for x in range(N) if part[y][x] == name]
    if side == "left":
        pts = [p for p in pts if p[0] < 16]
    elif side == "right":
        pts = [p for p in pts if p[0] >= 16]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def column_runs(part, name, x):
    return [y for y in range(N) if part[y][x] == name]


# ── Fighter ───────────────────────────────────────────────────────
def fighter(base_name, base_img):
    part, shadow = BASES[base_name]()
    small = base_name.split("_")[0] in ("halfling", "gnome")
    barefoot = base_name.startswith("halfling")

    # Base art on the 32 grid (every opaque 2x2 block is one colour;
    # the half-transparent ground shadow is dropped and redrawn).
    src = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            c = base_img.getpixel((2 * x, 2 * y))
            src[y][x] = c if c[3] == 255 else CLEAR

    px = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            if part[y][x] is not None:
                px[y][x] = src[y][x]

    head_top = bbox(part, "head")[1]
    foot_y = bbox(part, "foot")[1]
    has_shorts = any(part[y][x] == "shorts" for y in range(N) for x in range(N))
    shorts_top = bbox(part, "shorts")[1] if has_shorts else None
    has_belt = any(part[y][x] == "belt" for y in range(N) for x in range(N))

    # per-column arm extents: shoulder rows = steel, last row = bracer
    arm_top = {}
    arm_bot = {}
    for x in range(N):
        ys = column_runs(part, "arm", x)
        if ys:
            arm_top[x], arm_bot[x] = min(ys), max(ys)
    arm_y0 = min(arm_top.values())

    for y in range(N):
        for x in range(N):
            name = part[y][x]
            c = src[y][x]
            s = shade_of(c)
            if name == "hair" and y < head_top:
                # open helm over the crown; darker rim on its last row
                px[y][x] = STEEL[2] if y == head_top - 1 and s < 2 else STEEL[min(2, s)]
                if y == head_top - 1:
                    px[y][x] = STEEL[1] if s == 0 else STEEL[2]
            elif name in ("torso", "top"):
                px[y][x] = STEEL[min(2, s)]
            elif name == "shorts":
                if c in CLOTH:
                    px[y][x] = RED[CLOTH.index(c)]
            elif name == "arm":
                if y <= arm_y0 + 1:
                    px[y][x] = STEEL[min(2, s)]          # pauldron
                elif y == arm_bot[x]:
                    px[y][x] = LEATHER[min(2, s)]        # bracer
            elif name == "leg":
                boot = (not barefoot) and y >= foot_y - (2 if small else 3)
                px[y][x] = (LEATHER if boot else TROUSER)[min(2, s)]
            elif name == "foot" and not barefoot:
                px[y][x] = LEATHER[1 if s == 0 else 2]

    # breastplate detail: a centre ridge highlight and a lower plate edge
    tx0, ty0, tx1, ty1 = bbox(part, "torso")
    for y in range(ty0 + 1, ty1 + 1):
        if part[y][15] in ("torso", "top"):
            px[y][15] = STEEL[0]
    for x in range(tx0, tx1 + 1):
        if part[ty1][x] in ("torso", "top") and part[ty1 + 1][x] not in ("torso", "top"):
            px[ty1][x] = STEEL[2] if x > 16 else STEEL[1]

    # belt with a gold buckle on the tabard's top row (dwarves already wear one)
    if has_belt:
        bx0, by, bx1, _ = bbox(part, "belt")
        for x in range(bx0, bx1 + 1):
            px[by][x] = LEATHER[2] if x > 17 else LEATHER[1]
        px[by][15] = GOLD[0]; px[by][16] = GOLD[1]
    elif has_shorts:
        for x in range(N):
            if part[shorts_top][x] == "shorts":
                px[shorts_top][x] = LEATHER[2] if x > 17 else LEATHER[1]
        px[shorts_top][15] = GOLD[0]; px[shorts_top][16] = GOLD[1]

    # tabard centre panel split (a darker seam down the middle)
    if has_shorts:
        _, _, _, sy1 = bbox(part, "shorts")
        for y in range(shorts_top + 1, sy1 + 1):
            for x in (15, 16):
                if part[y][x] == "shorts":
                    px[y][x] = RED[1]

    # ── Sword: upright in the viewer's-left hand ──
    hx0, hy0, hx1, hy1 = bbox(part, "hand", "left")
    blade_r = hx0 - 2
    blade_l = blade_r - 1
    guard_y = hy0 - 1
    blade_len = 7 if small else 10
    for y in range(hy0, hy1 + 1):
        px[y][hx0 - 1] = SKIN[0]                     # fist closes round the grip
        px[y][blade_l] = LEATHER[1]
        px[y][blade_r] = LEATHER[2]
    px[hy1 + 1][blade_l] = GOLD[0]; px[hy1 + 1][blade_r] = GOLD[1]   # pommel
    for x in range(blade_l - 1, blade_r + 2):
        px[guard_y][x] = GOLD[0] if x <= blade_l else GOLD[1]         # crossguard
    tip = guard_y - blade_len
    for y in range(tip + 1, guard_y):
        px[y][blade_l] = STEEL[0]
        px[y][blade_r] = STEEL[1]
    px[tip][blade_l] = STEEL[0]                                       # point

    # ── Shield: heater on the viewer's-right arm ──
    rx0, ry0, rx1, ry1 = bbox(part, "hand", "right")
    sx0 = rx0 - 1
    sx1 = rx1 + (2 if small else 3)
    sy0 = ry0 - (5 if small else 6)
    sy1 = ry1 + (2 if small else 3)
    cells = set()
    for y in range(sy0, sy1 + 1):
        inset = max(0, y - (sy1 - 2))                # taper the last rows to a point
        for x in range(sx0 + inset, sx1 - inset + 1):
            cells.add((x, y))
    for (x, y) in cells:
        edge = any((x + dx, y + dy) not in cells
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            c = STEEL[0] if (y == sy0 or x == sx0) else STEEL[2] if x == sx1 or y >= sy1 - 2 else STEEL[1]
        else:
            c = RED[1] if x >= sx1 - 1 else RED[0]
        px[y][x] = c
    bx = (sx0 + sx1) // 2
    by = (sy0 + sy1) // 2 - 1
    px[by][bx] = GOLD[0]; px[by][bx + 1] = GOLD[1]
    px[by + 1][bx] = GOLD[1]; px[by + 1][bx + 1] = GOLD[1]

    # ── outline: drop the old one, redraw round the new silhouette ──
    for y in range(N):
        for x in range(N):
            if px[y][x] == OUTLINE and part[y][x] is None:
                px[y][x] = CLEAR
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
    ImageDraw.Draw(sh).ellipse(list(shadow), fill=(0, 0, 0, 96))
    return Image.alpha_composite(sh, art)


if __name__ == "__main__":
    src_dir = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else src_dir
    os.makedirs(out_dir, exist_ok=True)
    for name in BASES:
        base = Image.open(os.path.join(src_dir, f"{name}.png")).convert("RGBA")
        fighter(name, base).save(os.path.join(out_dir, f"{name}_fighter.png"))
    print(len(BASES), "fighters ->", out_dir)
