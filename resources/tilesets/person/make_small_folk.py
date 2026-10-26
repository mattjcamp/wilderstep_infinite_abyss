"""Small-folk base people (halfling / dwarf / gnome, male + female).

Same construction as make_person.py so every humanoid is one art set:
32x32 grid scaled 2x to 64x64, transparent background, dark outline,
light from the top-left, character colours (not environment colours),
shorts (and a top on the female bases) as a neutral clothing base,
soft ground shadow, and the feet on the same ground row as the humans
(row 27) so everyone stands on the tile the same way.

Each race has its own build, not a shrunken human:
  halfling  ~2/3 human height, slim, curly hair, big bare feet
  dwarf     similar height but very broad and stocky; beard (male) /
            braids (female); belt
  gnome     the smallest, with a big head, big nose and wild hair
"""
import os, sys
from PIL import Image, ImageDraw

N = 32
OUTLINE = (22, 14, 20, 255)
SKIN = [(242, 200, 154, 255), (208, 150, 108, 255), (150, 98, 74, 255)]
HAIR = [(176, 116, 66, 255), (122, 76, 44, 255), (80, 48, 30, 255)]
CLOTH = [(92, 112, 168, 255), (62, 76, 124, 255)]
BELT = [(110, 72, 44, 255), (232, 190, 96, 255)]          # leather, buckle
LIPS = (196, 104, 100, 255)
EYE = OUTLINE
CLEAR = (0, 0, 0, 0)

SKIN_PARTS = ("head", "torso", "arm", "hand", "leg", "foot", "neck", "nose")
HAIR_PARTS = ("hair", "beard")
CLOTH_PARTS = ("shorts", "top")


def render(parts, trims=(), details=(), hair_dark_from=99, shadow=(17, 53, 46, 61)):
    """parts: [(name, x0, y0, x1, y1)]; later hair/beard entries win.
    details: [(x, y, colour)] painted after shading."""
    part = [[None] * N for _ in range(N)]
    for name, x0, y0, x1, y1 in parts:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if part[y][x] is None or name in HAIR_PARTS + ("belt", "top"):
                    part[y][x] = name
    for x, y in trims:
        part[y][x] = None

    def at(x, y):
        return part[y][x] if 0 <= x < N and 0 <= y < N else None

    px = [[CLEAR] * N for _ in range(N)]
    for y in range(N):
        x = 0
        while x < N:
            if part[y][x] is None:
                x += 1; continue
            x0 = x
            while x < N and part[y][x] == part[y][x0]:
                x += 1
            x1 = x - 1
            name = part[y][x0]
            w = x1 - x0 + 1
            for xx in range(x0, x1 + 1):
                pos = xx - x0
                shade = 0
                if w >= 3 and pos >= w - (w // 3):
                    shade = 1
                if w >= 2 and pos == w - 1:
                    shade = 2 if w >= 4 else 1
                if at(xx, y + 1) != name and name in SKIN_PARTS:
                    shade = max(shade, 1)
                if name in HAIR_PARTS:
                    c = HAIR[min(2, shade + (1 if y >= hair_dark_from else 0))]
                elif name in CLOTH_PARTS:
                    c = CLOTH[1 if shade else 0]
                elif name == "belt":
                    c = BELT[0]
                else:
                    c = SKIN[shade]
                px[y][xx] = c
    for x, y, c in details:
        px[y][x] = c

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


def row(y, x0, x1, c):
    return [(x, y, c) for x in range(x0, x1 + 1)]


def waistband(y, x0, x1):
    return [(x, y, CLOTH[1] if x > 16 else CLOTH[0]) for x in range(x0, x1 + 1)]


# ── Halfling ──────────────────────────────────────────────────────
def halfling(female=False):
    p = [
        ("hair", 13, 10, 18, 11), ("hair", 12, 11, 19, 13),
        ("head", 13, 13, 18, 16),
        ("torso", 12, 17, 19, 18),
        ("torso", 13, 19, 18, 20) if female else ("torso", 12, 19, 19, 20),
        ("shorts", 12, 21, 19, 22),
        ("arm", 10, 18, 11, 20), ("arm", 20, 18, 21, 20),
        ("arm", 10, 21, 11, 22), ("arm", 20, 21, 21, 22),
        ("hand", 10, 23, 11, 23), ("hand", 20, 23, 21, 23),
        ("leg", 12, 23, 13, 25), ("leg", 18, 23, 19, 25),
        ("foot", 10, 26, 13, 27), ("foot", 18, 26, 21, 27),   # big feet
    ]
    if female:
        p += [("hair", 12, 13, 12, 18), ("hair", 19, 13, 19, 18),
              ("top", 12, 17, 19, 18)]
    d = [(14, 10, HAIR[0]), (13, 11, HAIR[0]), (16, 11, HAIR[0]),   # curls
         (18, 12, HAIR[0]), (15, 12, HAIR[2]), (17, 11, HAIR[2]),
         (14, 14, EYE), (17, 14, EYE),
         (15, 16, LIPS if female else SKIN[1]), (16, 16, LIPS if female else SKIN[1]),
         (11, 26, HAIR[1]), (12, 26, HAIR[1]), (19, 26, HAIR[1]), (20, 26, HAIR[1])]  # hairy feet
    d += waistband(21, 12, 19)
    if female:
        d += [(x, 18, CLOTH[1] if x > 16 else CLOTH[0]) for x in range(12, 20)]
    else:
        d += [(13, 18, SKIN[1]), (14, 18, SKIN[1]), (17, 18, SKIN[1]), (18, 18, SKIN[1])]
    return render(p, trims=[(12, 11), (19, 11)], details=d,
                  hair_dark_from=13, shadow=(18, 52, 45, 60))


# ── Dwarf ─────────────────────────────────────────────────────────
def dwarf(female=False):
    p = [
        ("hair", 12, 8, 19, 10),
        ("head", 12, 11, 19, 14),
        ("torso", 9, 15, 22, 16),           # very broad shoulders
        ("torso", 10, 17, 21, 19),
        ("belt", 10, 20, 21, 20),
        ("shorts", 10, 21, 21, 23),
        ("arm", 7, 16, 8, 19), ("arm", 23, 16, 24, 19),
        ("arm", 6, 20, 8, 22), ("arm", 23, 20, 25, 22),     # thick forearms
        ("hand", 6, 23, 8, 23), ("hand", 23, 23, 25, 23),
        ("leg", 10, 24, 13, 26), ("leg", 18, 24, 21, 26),   # short thick legs
        ("foot", 9, 27, 13, 27), ("foot", 18, 27, 22, 27),
    ]
    trims = [(12, 8), (19, 8), (9, 15), (22, 15)]
    d = [(13, 8, HAIR[0]), (14, 8, HAIR[0]), (13, 9, HAIR[0]),
         (14, 12, EYE), (17, 12, EYE), (13, 11, HAIR[2]), (14, 11, HAIR[2]),
         (17, 11, HAIR[2]), (18, 11, HAIR[2])]                      # heavy brows
    d += [(15, 20, BELT[1]), (16, 20, BELT[1])]                      # buckle
    d += waistband(21, 10, 21)
    if female:
        p += [("hair", 11, 10, 11, 20), ("hair", 20, 10, 20, 20),   # braids
              ("top", 10, 17, 21, 19)]
        d += [(11, 13, HAIR[2]), (11, 16, HAIR[2]), (11, 19, HAIR[2]),
              (20, 13, HAIR[2]), (20, 16, HAIR[2]), (20, 19, HAIR[2]),
              (11, 21, BELT[1]), (20, 21, BELT[1]),                  # braid clasps
              (15, 14, LIPS), (16, 14, LIPS)]
        d += [(x, 19, CLOTH[1] if x > 16 else CLOTH[0]) for x in range(10, 22)]
    else:
        p += [("beard", 12, 13, 19, 16), ("beard", 13, 17, 18, 18),
              ("beard", 14, 19, 17, 19)]
        d += [(13, 13, SKIN[1]), (18, 13, SKIN[1]),                  # cheeks
              (15, 14, HAIR[2]), (16, 14, HAIR[2]),                  # mouth in beard
              (14, 16, HAIR[0]), (16, 17, HAIR[0]), (15, 18, HAIR[0])]  # beard strands
    return render(p, trims=trims, details=d, hair_dark_from=12,
                  shadow=(13, 52, 50, 61))


# ── Gnome ─────────────────────────────────────────────────────────
def gnome(female=False):
    p = [
        ("hair", 11, 11, 20, 13),
        ("hair", 10, 13, 10, 15), ("hair", 21, 13, 21, 15),    # wild tufts
        ("head", 12, 13, 19, 18),                               # big head
        ("torso", 13, 19, 18, 21),
        ("shorts", 13, 22, 18, 23),
        ("arm", 11, 19, 12, 22), ("arm", 19, 19, 20, 22),
        ("hand", 11, 23, 12, 23), ("hand", 19, 23, 20, 23),
        ("leg", 12, 24, 13, 26), ("leg", 18, 24, 19, 26),
        ("foot", 11, 27, 13, 27), ("foot", 18, 27, 20, 27),
    ]
    trims = [(11, 11), (20, 11), (12, 18), (19, 18)]
    d = [(12, 11, HAIR[0]), (13, 11, HAIR[0]), (12, 12, HAIR[0]),
         (15, 11, HAIR[0]), (18, 12, HAIR[2]),
         (14, 15, EYE), (17, 15, EYE),
         (15, 16, SKIN[1]), (16, 16, SKIN[2]), (15, 17, SKIN[1]), (16, 17, SKIN[2]),  # big nose
         (14, 18, SKIN[1]), (17, 18, SKIN[1])]
    d += waistband(22, 13, 18)
    if female:
        p += [("hair", 9, 14, 10, 17), ("hair", 21, 14, 22, 17),    # pigtail puffs
              ("top", 13, 19, 18, 20)]
        d += [(15, 18, LIPS), (16, 18, LIPS),
              (9, 14, HAIR[0]), (21, 14, HAIR[0])]
        d += [(x, 20, CLOTH[1] if x > 16 else CLOTH[0]) for x in range(13, 19)]
    else:
        d += [(15, 18, SKIN[1]), (16, 18, SKIN[1])]
    return render(p, trims=trims, details=d, hair_dark_from=14,
                  shadow=(19, 52, 44, 60))


BUILDS = {
    "halfling_male": lambda: halfling(False),
    "halfling_female": lambda: halfling(True),
    "dwarf_male": lambda: dwarf(False),
    "dwarf_female": lambda: dwarf(True),
    "gnome_male": lambda: gnome(False),
    "gnome_female": lambda: gnome(True),
}

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    for name, fn in BUILDS.items():
        fn().save(os.path.join(out, f"{name}.png"))
    print(len(BUILDS), "sprites ->", out)
