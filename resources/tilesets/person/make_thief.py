"""Thief variants of every base person sprite.

Usage: python3 make_thief.py PERSON_SPRITE_DIR [OUT_DIR]
  (PERSON_SPRITE_DIR = web/public/modules/default/sprites/person;
   OUT_DIR defaults to the same folder)

Writes <base>_thief.png next to each base sprite. Works like
make_fighter.py (and reuses its helpers, so it must sit next to it):
each base's parts are repainted, keeping the base's own light / mid /
shadow steps, faces and hair.

The thief kit (same on everyone):
  - grey-green hood over the crown (side hair, beards and braids still
    show) and a black domino mask across the eyes
  - brown leather jerkin with a lighter bandolier strap across the
    chest, dark sleeves and dark leather bracers
  - belt with a coin pouch, dark trousers and soft black boots
    (halflings keep their bare, hairy feet)
  - a dagger in each hand
"""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_fighter as mf   # noqa: E402

N = mf.N
OUTLINE, CLEAR = mf.OUTLINE, mf.CLEAR
SKIN = mf.SKIN
STEEL, GOLD = mf.STEEL, mf.GOLD

HOOD = [(92, 112, 94, 255), (64, 80, 68, 255), (44, 56, 48, 255)]
JERKIN = [(128, 88, 58, 255), (92, 62, 42, 255), (62, 42, 30, 255)]
STRAP = [(176, 128, 82, 255), (138, 96, 60, 255)]
SLEEVE = [(78, 74, 86, 255), (56, 52, 64, 255), (40, 36, 48, 255)]
TROUSER = [(72, 68, 80, 255), (52, 48, 60, 255), (38, 34, 46, 255)]
BOOT = [(66, 52, 48, 255), (44, 34, 32, 255)]
BELT = [(54, 38, 30, 255), (40, 28, 24, 255)]
POUCH = [(160, 116, 72, 255), (118, 82, 50, 255)]
MASK = (30, 26, 36, 255)
EYE_GLINT = (236, 232, 220, 255)


def thief(base_name, base_img):
    part, shadow = mf.BASES[base_name]()
    barefoot = base_name.startswith("halfling")
    small = base_name.split("_")[0] in ("halfling", "gnome")

    src = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            c = base_img.getpixel((2 * x, 2 * y))
            src[y][x] = c if c[3] == 255 else CLEAR
    px = [[src[y][x] if part[y][x] is not None else CLEAR for x in range(N)] for y in range(N)]

    hx0, head_top, hx1, hy1 = mf.bbox(part, "head")
    foot_y = mf.bbox(part, "foot")[1]
    has_shorts = any(part[y][x] == "shorts" for y in range(N) for x in range(N))
    sy0 = mf.bbox(part, "shorts")[1]
    has_belt = any(part[y][x] == "belt" for y in range(N) for x in range(N))

    arm_top, arm_bot = {}, {}
    for x in range(N):
        ys = mf.column_runs(part, "arm", x)
        if ys:
            arm_top[x], arm_bot[x] = min(ys), max(ys)

    for y in range(N):
        for x in range(N):
            name = part[y][x]
            s = mf.shade_of(src[y][x])
            if name == "hair" and y < head_top:
                px[y][x] = HOOD[min(2, s)]
            elif name in ("torso", "top"):
                px[y][x] = JERKIN[min(2, s)]
            elif name in ("shorts", "belt"):
                px[y][x] = TROUSER[min(2, s)]
            elif name == "arm":
                if y >= arm_bot[x] - 1:
                    px[y][x] = BELT[0 if s == 0 else 1]           # bracer
                else:
                    px[y][x] = SLEEVE[min(2, s)]
            elif name == "leg":
                boot = (not barefoot) and y >= foot_y - (2 if small else 3)
                px[y][x] = BOOT[0 if s == 0 else 1] if boot else TROUSER[min(2, s)]
            elif name == "foot" and not barefoot:
                px[y][x] = BOOT[0 if s == 0 else 1]

    # hood sides: a cowl edge either side of the face for a few rows
    for y in range(head_top, head_top + (2 if small else 3)):
        for x in (hx0 - 1, hx1 + 1):
            if part[y][x] in (None, "hair") and 0 <= x < N:
                px[y][x] = HOOD[1] if x < 16 else HOOD[2]
    # domino mask across the eyes (eyes become a glint)
    eye_y = None
    for y in range(head_top, hy1 + 1):
        if any(part[y][x] == "head" and src[y][x] == OUTLINE for x in range(N)):
            eye_y = y
            break
    if eye_y is not None:
        for x in range(hx0, hx1 + 1):
            if part[eye_y][x] == "head":
                px[eye_y][x] = EYE_GLINT if src[eye_y][x] == OUTLINE else MASK

    # bandolier: a strap from the viewer's-right shoulder to the left hip
    tx0, ty0, tx1, ty1 = mf.bbox(part, "torso")
    for i, y in enumerate(range(ty0, ty1 + 1)):
        x = tx1 - 1 - i
        if 0 <= x < N and part[y][x] in ("torso", "top"):
            px[y][x] = STRAP[0]
            if part[y][x - 1] in ("torso", "top"):
                px[y][x - 1] = STRAP[1]

    # belt with a coin pouch
    belt_y = mf.bbox(part, "belt")[1] if has_belt else sy0
    for x in range(N):
        if part[belt_y][x] in ("belt", "shorts"):
            px[belt_y][x] = BELT[1] if x > 17 else BELT[0]
    px[belt_y][15] = STEEL[1]                                 # buckle
    pouch_x = mf.bbox(part, "shorts")[2] - 2
    for y in (belt_y + 1, belt_y + 2):
        for x in (pouch_x, pouch_x + 1):
            px[y][x] = POUCH[0] if x == pouch_x else POUCH[1]
    px[belt_y + 1][pouch_x] = GOLD[0]                         # coin glint

    # ── Daggers, one in each hand ──
    blade_len = 3 if small else 4

    def dagger(hand_bbox, outward):
        x0, y0, x1, y1 = hand_bbox
        hand_edge = x0 if outward < 0 else x1
        fist = hand_edge + outward
        col = hand_edge + 2 * outward
        for y in range(y0, y1 + 1):
            px[y][fist] = SKIN[0]
            px[y][col] = BELT[0]                             # grip
        px[y1 + 1][col] = STEEL[1]                           # pommel
        guard = y0 - 1
        for x in (col - 1, col, col + 1):
            px[guard][x] = STEEL[1]
        for y in range(guard - blade_len, guard):
            px[y][col] = STEEL[0]
        px[guard - blade_len][col] = STEEL[1]                # point

    dagger(mf.bbox(part, "hand", "left"), -1)
    dagger(mf.bbox(part, "hand", "right"), +1)

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
        thief(name, base).save(os.path.join(out_dir, f"{name}_thief.png"))
    print(len(mf.BASES), "thieves ->", out_dir)
