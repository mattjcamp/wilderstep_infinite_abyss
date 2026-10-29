"""Wizard variants of every base person sprite.

Usage: python3 make_wizard.py PERSON_SPRITE_DIR [OUT_DIR]
  (PERSON_SPRITE_DIR = web/public/modules/default/sprites/person;
   OUT_DIR defaults to the same folder)

Writes <base>_wizard.png next to each base sprite. Works like
make_fighter.py / make_cleric.py (and reuses their helpers, so it must
sit next to them): each base's parts are repainted, keeping the base's
own light / mid / shadow steps, faces and hair.

The wizard kit (same on everyone):
  - tall pointed hat with a gold band and a star, its tip bent over;
    side hair, beards and braids still show below the brim
  - floor-length purple robe with full sleeves and silver cuffs,
    scattered with small stars, closed with a gold rope belt
  - dark slippers peeking out under the hem (halflings: bare feet)
  - a tall wooden staff topped with a glowing blue orb, held in the
    right hand (viewer's left)
"""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_fighter as mf   # noqa: E402
import make_cleric as mc    # noqa: E402

N = mf.N
OUTLINE, CLEAR = mf.OUTLINE, mf.CLEAR
SKIN = mf.SKIN
GOLD = mf.GOLD

ROBE = [(112, 84, 186, 255), (78, 56, 140, 255), (52, 36, 98, 255)]   # light, mid, shadow
STAR = (246, 226, 132, 255)
SILVER = [(214, 220, 232, 255), (150, 160, 180, 255)]
SLIPPER = [(70, 50, 96, 255), (46, 32, 66, 255)]
WOOD = [(156, 108, 64, 255), (108, 72, 44, 255)]
ORB = [(214, 248, 255, 255), (110, 206, 255, 255), (52, 132, 220, 255)]   # glow, bright, deep


def wizard(base_name, base_img):
    part, shadow = mf.BASES[base_name]()
    barefoot = base_name.startswith("halfling")

    src = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            c = base_img.getpixel((2 * x, 2 * y))
            src[y][x] = c if c[3] == 255 else CLEAR
    px = [[src[y][x] if part[y][x] is not None else CLEAR for x in range(N)] for y in range(N)]

    head_top = mf.bbox(part, "head")[1]
    foot_y = mf.bbox(part, "foot")[1]
    sx0, sy0, sx1, sy1 = mf.bbox(part, "shorts")
    robe_bottom = foot_y - 1

    arm_bot = {}
    for x in range(N):
        ys = mf.column_runs(part, "arm", x)
        if ys:
            arm_bot[x] = max(ys)

    for y in range(N):
        for x in range(N):
            name = part[y][x]
            s = mf.shade_of(src[y][x])
            if name in ("torso", "top", "shorts", "belt"):
                px[y][x] = ROBE[min(2, s)]
            elif name == "arm":
                px[y][x] = SILVER[0 if s == 0 else 1] if y == arm_bot[x] else ROBE[min(2, s)]
            elif name == "leg":
                px[y][x] = ROBE[min(2, s)]
            elif name == "foot" and not barefoot:
                px[y][x] = SLIPPER[0 if s == 0 else 1]

    # floor-length skirt: fill between the legs from the hips to the hem
    for y in range(sy1 + 1, robe_bottom + 1):
        xs = [x for x in range(N) if part[y][x] == "leg"]
        if not xs:
            continue
        for x, s in mc._run_shades(range(min(xs), max(xs) + 1)).items():
            px[y][x] = ROBE[s]
    for x in range(N):                              # silver hem
        if px[robe_bottom][x] in ROBE:
            px[robe_bottom][x] = SILVER[0] if px[robe_bottom][x] == ROBE[0] else SILVER[1]
    for y in range(sy0 + 1, robe_bottom):           # front opening
        if px[y][16] in ROBE:
            px[y][16] = ROBE[2]

    # stars scattered over the robe (not on its outer edge)
    def robe_at(x, y):
        return 0 <= x < N and 0 <= y < N and px[y][x] in ROBE
    for y in range(N):
        for x in range(N):
            if (robe_at(x, y) and (x * 5 + y * 3) % 9 == 0 and x != 16
                    and all(robe_at(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))):
                px[y][x] = STAR

    # gold rope belt with a knot and a hanging end
    belt_y = mf.bbox(part, "belt")[1] if any(
        part[y][x] == "belt" for y in range(N) for x in range(N)) else sy0
    for x in range(N):
        if px[belt_y][x] in ROBE or px[belt_y][x] == STAR:
            px[belt_y][x] = GOLD[0] if x % 2 == 0 else GOLD[1]
    for y in (belt_y + 1, belt_y + 2):
        if px[y][14] in ROBE or px[y][14] == STAR:
            px[y][14] = GOLD[1]

    # ── Pointed hat ──
    hair_cols = [x for y in range(head_top) for x in range(N) if part[y][x] == "hair"]
    hx0, hx1 = min(hair_cols), max(hair_cols)
    brim = head_top - 1
    for y in range(brim):                           # crown hair goes under the hat
        for x in range(N):
            if part[y][x] == "hair":
                px[y][x] = CLEAR
    for x in range(hx0 - 1, hx1 + 2):               # wide brim
        px[brim][x] = ROBE[2] if x >= hx1 else ROBE[1]
    widths = [hx1 - hx0 - 1, hx1 - hx0 - 3, hx1 - hx0 - 3, 2] if brim < 8 else \
             [hx1 - hx0 - 1, hx1 - hx0 - 1, hx1 - hx0 - 3, hx1 - hx0 - 3, 2, 2]
    cx = (hx0 + hx1 + 1) / 2
    y = brim - 1
    for i, w in enumerate(widths):
        w = max(2, w)
        lean = 1 if i >= len(widths) - 2 else 0      # upper cone leans right
        x0 = int(cx - w / 2) + lean
        for x, s in mc._run_shades(range(x0, x0 + w)).items():
            px[y][x] = ROBE[s]
        if i == 0:                                   # gold band
            for x in range(x0, x0 + w):
                px[y][x] = GOLD[0] if x < x0 + w - 1 else GOLD[1]
        y -= 1
    tip_y = y + 1
    if y >= 0:
        px[y][int(cx) + 2] = ROBE[1]                 # bent-over tip
    star_y = brim - 3 if brim >= 8 else brim - 2
    px[star_y][int(cx) - 1] = STAR                   # star on the hat

    # ── Staff: tall, in the viewer's-left hand, orb on top ──
    lx0, ly0, lx1, ly1 = mf.bbox(part, "hand", "left")
    sx = lx0 - 2
    orb_y = max(1, tip_y)
    for y in range(ly0, ly1 + 1):
        px[y][lx0 - 1] = SKIN[0]                     # fist round the staff
    for y in range(orb_y + 2, foot_y + 1):
        px[y][sx] = WOOD[0] if y < ly0 else WOOD[1]
    px[orb_y][sx - 1] = ORB[0]; px[orb_y][sx] = ORB[1]
    px[orb_y + 1][sx - 1] = ORB[1]; px[orb_y + 1][sx] = ORB[2]
    if orb_y >= 1:
        px[orb_y - 1][sx - 1] = ORB[1]               # glow flick

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
        wizard(name, base).save(os.path.join(out_dir, f"{name}_wizard.png"))
    print(len(mf.BASES), "wizards ->", out_dir)
