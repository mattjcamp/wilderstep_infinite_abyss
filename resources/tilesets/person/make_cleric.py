"""Cleric variants of every base person sprite.

Usage: python3 make_cleric.py PERSON_SPRITE_DIR [OUT_DIR]
  (PERSON_SPRITE_DIR = web/public/modules/default/sprites/person;
   OUT_DIR defaults to the same folder)

Writes <base>_cleric.png next to each base sprite. Works like
make_fighter.py (and reuses its base part maps, so it must sit next to
it): each base's parts are repainted as vestments, keeping the base's
own light / mid / shadow steps, faces and hair.

The cleric kit (same on everyone):
  - bare head, so hair, beards and braids stay visible
  - long cream robe with full sleeves and gold cuffs, falling to just
    above the feet (the gap between the legs is filled in as a skirt)
  - a gold holy symbol (sun cross) on the chest
  - a blue sash belt with a gold clasp, and a gold hem
  - leather boots (halflings keep their bare, hairy feet)
  - a flanged mace held upright in the right hand (viewer's left);
    no shield, so the silhouette reads differently from the fighter
"""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_fighter as mf   # noqa: E402  (base part maps + shared colours)

N = mf.N
OUTLINE, CLEAR = mf.OUTLINE, mf.CLEAR
SKIN, CLOTH = mf.SKIN, mf.CLOTH
STEEL, LEATHER, GOLD = mf.STEEL, mf.LEATHER, mf.GOLD

ROBE = [(234, 228, 210, 255), (194, 184, 162, 255), (142, 130, 114, 255)]   # light, mid, shadow
SASH = [(70, 104, 184, 255), (44, 66, 132, 255)]
WOOD = [(150, 104, 62, 255), (104, 70, 42, 255)]


def _run_shades(xs):
    """Light / mid / shadow per x for one horizontal run (same rule as
    the base renderers: last third mid, last pixel shadow)."""
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


def cleric(base_name, base_img):
    part, shadow = mf.BASES[base_name]()
    barefoot = base_name.startswith("halfling")

    src = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            c = base_img.getpixel((2 * x, 2 * y))
            src[y][x] = c if c[3] == 255 else CLEAR
    px = [[src[y][x] if part[y][x] is not None else CLEAR for x in range(N)] for y in range(N)]

    foot_y = mf.bbox(part, "foot")[1]
    has_shorts = any(part[y][x] == "shorts" for y in range(N) for x in range(N))
    sx0, sy0, sx1, sy1 = mf.bbox(part, "shorts")
    has_belt = any(part[y][x] == "belt" for y in range(N) for x in range(N))
    robe_bottom = foot_y - 2                       # hem row

    arm_bot = {}
    for x in range(N):
        ys = mf.column_runs(part, "arm", x)
        if ys:
            arm_bot[x] = max(ys)

    for y in range(N):
        for x in range(N):
            name = part[y][x]
            s = mf.shade_of(src[y][x])
            if name in ("torso", "top", "shorts"):
                px[y][x] = ROBE[min(2, s)]
            elif name == "arm":
                px[y][x] = GOLD[0 if s == 0 else 1] if y == arm_bot[x] else ROBE[min(2, s)]
            elif name == "leg":
                if y <= robe_bottom:
                    px[y][x] = ROBE[min(2, s)]
                elif not barefoot:
                    px[y][x] = LEATHER[min(2, s)]
            elif name == "foot" and not barefoot:
                px[y][x] = LEATHER[1 if s == 0 else 2]

    # skirt: fill the gap between the legs from the hips down to the hem
    for y in range(sy1 + 1, robe_bottom + 1):
        xs = [x for x in range(N) if part[y][x] == "leg"]
        if not xs:
            continue
        shades = _run_shades(range(min(xs), max(xs) + 1))
        for x, s in shades.items():
            px[y][x] = ROBE[s]
    # gold hem
    for x in range(N):
        if px[robe_bottom][x] in ROBE:
            px[robe_bottom][x] = GOLD[0] if px[robe_bottom][x] == ROBE[0] else GOLD[1]
    # front fold down the middle of the skirt
    for y in range(sy0 + 1, robe_bottom):
        if px[y][16] in ROBE:
            px[y][16] = ROBE[1]

    # sash belt (dwarves: over their own belt) with a gold clasp
    belt_y = mf.bbox(part, "belt")[1] if has_belt else sy0
    for x in range(N):
        if part[belt_y][x] in ("belt", "shorts", "torso", "top"):
            px[belt_y][x] = SASH[1] if x > 17 else SASH[0]
    px[belt_y][15] = GOLD[0]; px[belt_y][16] = GOLD[1]
    # sash tails hanging from the clasp
    for y in (belt_y + 1, belt_y + 2):
        if px[y][17] in ROBE:
            px[y][17] = SASH[0]
    if px[belt_y + 1][18] in ROBE:
        px[belt_y + 1][18] = SASH[1]

    # holy symbol: a small gold sun cross on the chest (only on robe,
    # so a dwarf's beard stays in front of it)
    tx0, ty0, tx1, ty1 = mf.bbox(part, "torso")
    cy = ty0 + 2
    sym = [(15, cy - 1), (16, cy - 1), (14, cy), (15, cy), (16, cy), (17, cy),
           (15, cy + 1), (16, cy + 1)]
    for x, y in sym:
        if part[y][x] in ("torso", "top") and px[y][x] in ROBE:
            px[y][x] = GOLD[1] if x >= 16 else GOLD[0]

    # ── Mace: upright in the viewer's-left hand ──
    hx0, hy0, hx1, hy1 = mf.bbox(part, "hand", "left")
    small = base_name.split("_")[0] in ("halfling", "gnome")
    hx = hx0 - 2                                   # haft column
    for y in range(hy0, hy1 + 1):
        px[y][hx0 - 1] = SKIN[0]                   # fist round the haft
        px[y][hx] = WOOD[1]
    px[hy1 + 1][hx] = STEEL[1]                     # butt cap
    haft_top = hy0 - (4 if small else 6)
    for y in range(haft_top, hy0):
        px[y][hx] = WOOD[0]
    # flanged head: 3x3 block with spikes
    top = haft_top - 3
    for y in range(top, haft_top):
        for x in (hx - 1, hx, hx + 1):
            px[y][x] = STEEL[0] if x == hx - 1 else STEEL[1] if x == hx else STEEL[2]
    px[top - 1][hx] = STEEL[0]                     # top spike
    px[top + 1][hx - 2] = STEEL[1]                 # side flanges
    px[top + 1][hx + 2] = STEEL[2]

    # outline round the new silhouette
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
    for name in mf.BASES:
        base = Image.open(os.path.join(src_dir, f"{name}.png")).convert("RGBA")
        cleric(name, base).save(os.path.join(out_dir, f"{name}_cleric.png"))
    print(len(mf.BASES), "clerics ->", out_dir)
