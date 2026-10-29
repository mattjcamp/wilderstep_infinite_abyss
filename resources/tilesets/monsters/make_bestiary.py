"""The Default module's basic bestiary — monster sprites in the 3/4
character style, matching the hand-built Skeleton / Giant Rat / Goblin
/ Dire Wolf.

Usage: python3 make_bestiary.py PERSON_SPRITE_DIR MONSTER_SPRITE_DIR [name ...]
  PERSON_SPRITE_DIR  = web/public/modules/default/sprites/person
  MONSTER_SPRITE_DIR = web/public/modules/default/sprites/monster
  names              = only build these (default: all)

Creature monsters are drawn from parts with monster_kit.py. Humanoid
monsters (orc, zombie, vampire) are built on the base person sprites
via person_kit.py — same body, outline and lighting as the party and
the townsfolk — with skin, hair and kit repainted. Both kits, and
make_fighter.py / make_person*.py / make_small_folk.py which they
read, must sit in resources/tilesets/person (this script adds it to
the import path).
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PERSON_TOOLS = os.path.join(os.path.dirname(HERE), "person")
sys.path.insert(0, HERE)
sys.path.insert(0, PERSON_TOOLS)

from PIL import Image                                  # noqa: E402
from monster_kit import Canvas, N, CLEAR, alpha        # noqa: E402
import person_kit as pk                                # noqa: E402

PERSON_DIR = None

BONE = [(240, 230, 202, 255), (196, 182, 152, 255), (138, 124, 104, 255)]
IRON = [(186, 186, 196, 255), (132, 132, 146, 255), (88, 88, 102, 255)]
WOOD = [(150, 104, 62, 255), (108, 72, 44, 255), (76, 50, 32, 255)]
GOLD = [(240, 200, 96, 255), (186, 140, 58, 255), (130, 94, 40, 255)]
DARK = (22, 14, 20, 255)
WHITE = (246, 242, 230, 255)
RED_EYE = (232, 56, 48, 255)


def person(base):
    img = Image.open(os.path.join(PERSON_DIR, f"{base}.png")).convert("RGBA")
    return pk.Figure(base, img)


def reskin(f, skin, hair=None):
    """Swap the base's skin (and hair) palette for a creature's."""
    for y in range(N):
        for x in range(N):
            c = f.px[y][x]
            if c in pk.SKIN:
                f.px[y][x] = skin[pk.SKIN.index(c)]
            elif hair and c in pk.HAIR:
                f.px[y][x] = hair[pk.HAIR.index(c)]


# ── Giant Bat ────────────────────────────────────────────────────
def giant_bat():
    c = Canvas()
    FUR = [(132, 98, 84, 255), (98, 70, 62, 255), (68, 48, 44, 255)]
    WING = [(104, 74, 92, 255), (80, 56, 74, 255), (58, 40, 56, 255)]
    c.palette("fur", FUR); c.palette("wing", WING)
    c.spans("wing", {
        8: [(2, 3)], 9: [(2, 6)], 10: [(2, 9)], 11: [(3, 12)], 12: [(3, 12)],
        13: [(4, 12)], 14: [(4, 12)], 15: [(5, 12)], 16: [(7, 9), (10, 12)],
        17: [(8, 8), (11, 12)], 18: [(12, 12)],
    }, mirror=True)
    for x in (4, 27):                                  # scalloped trailing edge
        c.erase(x, 14)
    c.erase(6, 15); c.erase(25, 15)
    c.spans("fur", {
        6: [(13, 13), (18, 18)], 7: [(13, 14), (17, 18)],      # ears
        8: [(13, 18)], 9: [(13, 18)], 10: [(13, 18)], 11: [(13, 18)],
        12: [(13, 18)], 13: [(13, 18)], 14: [(13, 18)], 15: [(13, 18)],
        16: [(13, 18)], 17: [(14, 17)], 18: [(14, 17)],
        19: [(14, 14), (17, 17)],                               # feet
    })
    c.shade()
    BONE_LINE = (150, 118, 132, 255)
    c.dots([(x, 11) for x in range(4, 13)] + [(31 - x, 11) for x in range(4, 13)], BONE_LINE)
    c.dots([(9, 12), (8, 13), (7, 14), (11, 13), (10, 14), (9, 15),
            (22, 12), (23, 13), (24, 14), (20, 13), (21, 14), (22, 15)], BONE_LINE)
    c.dots([(14, 7), (17, 7)], (190, 130, 140, 255))            # inner ears
    c.dots([(14, 10), (17, 10)], RED_EYE)
    c.dots([(15, 12), (16, 12)], DARK)
    c.dots([(15, 13), (16, 13)], WHITE)                         # fangs
    c.dots([(15, 15), (16, 16)], FUR[0])                        # chest fur
    return c.render(shadow=(20, 54, 43, 60), shadow_alpha=60)


# ── Orc ──────────────────────────────────────────────────────────
def orc():
    f = person("person_male")
    SKIN = [(132, 150, 96, 255), (98, 116, 72, 255), (68, 82, 52, 255)]
    HAIRC = [(56, 48, 50, 255), (40, 34, 38, 255), (28, 24, 28, 255)]
    reskin(f, SKIN, HAIRC)
    p = f.part
    LEATH = [(108, 76, 54, 255), (80, 56, 40, 255), (56, 40, 30, 255)]
    LOIN = [(122, 52, 44, 255), (90, 38, 34, 255), (64, 28, 26, 255)]
    for y in range(N):
        for x in range(N):
            s = f.shade(x, y)
            if p[y][x] in ("torso",):
                f.px[y][x] = LEATH[min(2, s)]
            elif p[y][x] == "shorts":
                f.px[y][x] = LOIN[min(2, s)]
            elif p[y][x] == "foot":
                f.px[y][x] = LEATH[1 if s == 0 else 2]
    # topknot: shave the sides, keep a ridge of hair, add a tail of hair
    for y in range(N):
        for x in range(N):
            if p[y][x] == "hair" and not (14 <= x <= 17):
                f.px[y][x] = SKIN[1] if y < 6 else f.px[y][x]
                if y >= 6:
                    f.px[y][x] = SKIN[0] if x < 16 else SKIN[1]
    f.put(15, 2, HAIRC[0]); f.put(16, 2, HAIRC[1]); f.put(16, 1, HAIRC[1])
    # pointed ears, heavy brow, red eyes, tusks
    f.put(11, 7, SKIN[1]); f.put(20, 7, SKIN[2]); f.put(11, 6, SKIN[0]); f.put(20, 6, SKIN[1])
    for x in (13, 14, 17, 18):
        f.put(x, 6, HAIRC[1])
    f.put(14, 7, RED_EYE); f.put(17, 7, RED_EYE)
    f.put(15, 9, DARK); f.put(16, 9, DARK)
    f.put(14, 9, WHITE); f.put(17, 9, WHITE); f.put(14, 8, WHITE); f.put(17, 8, WHITE)
    # iron studs and a spiked pauldron
    for x, y in ((13, 13), (18, 13), (15, 15), (16, 15)):
        f.put(x, y, IRON[1])
    for x in range(21, 25):
        f.put(x, 11, IRON[0] if x < 23 else IRON[1])
        f.put(x, 12, IRON[1] if x < 23 else IRON[2])
    f.put(23, 10, IRON[0]); f.put(24, 9, IRON[1])
    # belt
    for x in range(11, 21):
        f.put(x, 17, LEATH[2])
    f.put(15, 17, IRON[0]); f.put(16, 17, IRON[1])
    # war axe in the viewer's-left hand
    x0, y0, x1, y1 = f.lhand
    hx = f.fist(f.lhand, -1) - 1
    for y in range(7, f.foot_y - 1):
        f.put(hx, y, WOOD[0] if y < y0 else WOOD[1])
    for y, xs in ((6, (hx - 2, hx)), (7, (hx - 3, hx - 1)), (8, (hx - 4, hx - 1)),
                  (9, (hx - 4, hx - 1)), (10, (hx - 4, hx - 1)), (11, (hx - 3, hx - 1)),
                  (12, (hx - 2, hx - 1))):
        for x in range(xs[0], xs[1] + 1):
            f.put(x, y, IRON[0] if x == xs[0] else IRON[1] if x < hx - 1 else IRON[2])
    return f.render()


# ── Slime Mold ───────────────────────────────────────────────────
def slime_mold():
    c = Canvas()
    MOLD = [(178, 196, 72, 255), (132, 154, 52, 255), (92, 112, 40, 255)]
    STALK = [(206, 214, 150, 255), (160, 168, 110, 255), (112, 118, 80, 255)]
    c.palette("mold", MOLD); c.palette("stalk", STALK)
    c.spans("mold", {
        15: [(10, 12), (19, 21)], 16: [(9, 13), (18, 22)], 17: [(8, 23)],
        18: [(7, 24)], 19: [(6, 25)], 20: [(5, 26)], 21: [(5, 26)],
        22: [(4, 27)], 23: [(4, 27)], 24: [(4, 27)], 25: [(4, 27)],
        26: [(5, 26)], 27: [(6, 25)],
    })
    c.spans("stalk", {                                          # three spore stalks
        11: [(10, 12)], 12: [(11, 11)], 13: [(11, 11)], 14: [(11, 11)],
    })
    c.spans("stalk", {12: [(19, 21)], 13: [(20, 20)], 14: [(20, 20)]})
    c.spans("stalk", {9: [(15, 16)], 10: [(15, 16)], 11: [(16, 16)], 12: [(16, 16)],
                      13: [(16, 16)], 14: [(16, 16)]})
    c.shade()
    SPORE = (238, 120, 70, 255)
    c.dots([(11, 10), (20, 11), (15, 8)], SPORE)                 # spore caps
    c.dots([(10, 11), (19, 12), (15, 9)], (250, 170, 110, 255))
    SPOT = (96, 120, 44, 255)
    c.dots([(9, 20), (10, 20), (17, 19), (22, 22), (13, 23), (14, 23), (20, 25),
            (7, 24), (25, 24), (18, 22)], SPOT)
    c.dots([(11, 18), (16, 21), (23, 20), (8, 22), (19, 24)], (214, 226, 118, 255))
    c.dots([(6, 27), (25, 27)], CLEAR)
    return c.render(shadow=(8, 52, 56, 61))


# ── Gelatinous Cube ──────────────────────────────────────────────
def gelatinous_cube():
    c = Canvas()
    FRONT = (112, 214, 170, 150)
    TOP = (168, 240, 206, 165)
    SIDE = (72, 168, 138, 165)
    EDGE = (214, 255, 236, 230)
    x0, x1, y0, y1, d = 3, 22, 9, 27, 4                 # front face, depth
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            c.dot(x, y, FRONT)
    for i in range(1, d + 1):                           # top face
        for x in range(x0 + i, x1 + i + 1):
            c.dot(x, y0 - i, TOP)
    for i in range(1, d + 1):                           # right side face
        for y in range(y0 - i, y1 - i + 1):
            c.dot(x1 + i, y, SIDE)
    for x in range(x0, x1 + 1):                         # bright edges
        c.dot(x, y0, EDGE)
    for y in range(y0, y1 + 1):
        c.dot(x1, y, EDGE)
    for i in range(1, d + 1):
        c.dot(x1 + i, y0 - i, EDGE)
    c.dot(x0 + 1, y0 + 1, (240, 255, 248, 240)); c.dot(x0 + 2, y0 + 1, (240, 255, 248, 200))
    # things it has swallowed: a skull, a sword, coins
    c.dots([(8, 18), (9, 18), (10, 18), (8, 19), (10, 19), (8, 20), (9, 20), (10, 20)], BONE[1])
    c.dots([(9, 19)], DARK); c.dot(8, 19, DARK); c.dot(10, 19, DARK); c.dot(9, 19, BONE[2])
    for i in range(7):
        c.dot(13 + i, 24 - i, IRON[0] if i % 2 == 0 else IRON[1])
    c.dots([(12, 25), (13, 26)], WOOD[1]); c.dot(14, 24, GOLD[1]); c.dot(12, 23, GOLD[1])
    c.dots([(6, 25), (17, 26), (19, 24)], GOLD[0])
    c.dots([(15, 13), (6, 14), (19, 16)], (230, 255, 244, 200))     # bubbles
    return c.render(shadow=(4, 52, 58, 61), shadow_alpha=80)


# ── Ghost ────────────────────────────────────────────────────────
def ghost():
    c = Canvas()
    G = [(214, 232, 246, 205), (166, 196, 222, 195), (122, 150, 186, 185)]
    c.palette("g", G)
    c.spans("g", {
        4: [(14, 17)], 5: [(13, 18)], 6: [(12, 19)], 7: [(12, 19)], 8: [(12, 19)],
        9: [(12, 19)], 10: [(12, 19)], 11: [(12, 19)], 12: [(11, 20)],
        13: [(7, 24)], 14: [(6, 25)], 15: [(6, 9), (11, 20), (22, 25)],
        16: [(11, 20)], 17: [(11, 20)], 18: [(11, 21)], 19: [(11, 21)],
        20: [(12, 21)], 21: [(12, 21)], 22: [(13, 21)], 23: [(14, 20)],
        24: [(15, 19)], 25: [(16, 18)], 26: [(17, 17)],
    })
    c.shade()
    for y, a in ((22, 160), (23, 130), (24, 100), (25, 70), (26, 50)):   # fading tail
        for x in range(N):
            px = c.px[y][x]
            if px[3]:
                c.dot(x, y, (px[0], px[1], px[2], a))
    c.dots([(13, 8), (14, 8), (13, 9), (14, 9), (17, 8), (18, 8), (17, 9), (18, 9)], (30, 34, 60, 255))
    c.dots([(14, 9), (17, 9)], (150, 240, 255, 255))                     # eye glints
    c.dots([(15, 11), (16, 11), (15, 12), (16, 12)], (30, 34, 60, 255))  # wailing mouth
    c.dots([(6, 16), (8, 16), (23, 16), (25, 16)], alpha(G[1], 170))      # wispy fingers
    c.dot(14, 5, (240, 250, 255, 230))
    return c.render(shadow=(20, 54, 43, 60), shadow_alpha=50, outline=(40, 52, 82, 200))


# ── Zombie ───────────────────────────────────────────────────────
def zombie():
    f = person("person_male")
    ROT = [(150, 168, 132, 255), (112, 128, 100, 255), (80, 92, 74, 255)]
    MATTED = [(84, 72, 60, 255), (62, 52, 46, 255), (44, 38, 34, 255)]
    reskin(f, ROT, MATTED)
    p = f.part
    RAG = [(136, 120, 100, 255), (104, 90, 76, 255), (76, 64, 56, 255)]
    TROU = [(88, 84, 98, 255), (66, 62, 74, 255), (48, 44, 54, 255)]
    for y in range(N):
        for x in range(N):
            s = f.shade(x, y)
            if p[y][x] == "torso" and y >= 12:
                f.px[y][x] = RAG[min(2, s)]
            elif p[y][x] == "shorts" or (p[y][x] == "leg" and y <= 23):
                f.px[y][x] = TROU[min(2, s)]
    # torn shirt: holes showing rotten skin and ribs
    for x, y in ((13, 13), (14, 14), (13, 15), (18, 16), (19, 15)):
        f.put(x, y, ROT[1])
    f.put(14, 13, BONE[1]); f.put(13, 14, BONE[1])
    # ragged trouser hems and a shirt tail
    f.put(12, 24, ROT[1]); f.put(19, 24, ROT[2]); f.put(11, 23, ROT[0])
    # face: sunken white eyes, slack jaw, wound
    f.put(14, 7, (236, 232, 200, 255)); f.put(17, 7, (236, 232, 200, 255))
    f.put(13, 7, ROT[2]); f.put(18, 7, ROT[2])
    f.put(15, 9, (70, 30, 34, 255)); f.put(16, 9, (70, 30, 34, 255)); f.put(15, 10, (70, 30, 34, 255))
    BLOOD = (128, 36, 40, 255)
    for x, y in ((18, 5), (19, 6), (8, 16), (23, 18), (12, 21)):
        f.put(x, y, BLOOD)
    # patchy, thinning hair: most of the scalp shows through
    for y in range(N):
        for x in range(N):
            if p[y][x] == "hair" and y < 6 and (x + y) % 3:
                f.px[y][x] = ROT[0] if x < 16 else ROT[1]
    return f.render()


# ── Lich ─────────────────────────────────────────────────────────
def lich():
    c = Canvas()
    ROBE = [(92, 62, 118, 255), (66, 42, 88, 255), (44, 28, 62, 255)]
    c.palette("bone", BONE); c.palette("robe", ROBE); c.palette("gold", GOLD)
    c.palette("wood", WOOD)
    # skull
    c.spans("bone", {4: [(13, 18)], 5: [(12, 19)], 6: [(12, 19)], 7: [(12, 19)],
                     8: [(12, 19)], 9: [(13, 18)], 10: [(14, 17)]})
    # crown
    c.spans("gold", {1: [(13, 13), (15, 16), (18, 18)], 2: [(13, 18)], 3: [(12, 19)]})
    # hooded robe, wide sleeves, tattered hem
    c.spans("robe", {
        8: [(10, 11), (20, 21)], 9: [(10, 12), (19, 21)], 10: [(9, 13), (18, 22)],
        11: [(8, 23)], 12: [(8, 23)], 13: [(7, 24)], 14: [(6, 25)], 15: [(6, 25)],
        16: [(6, 9), (11, 20), (22, 25)], 17: [(6, 9), (11, 20), (22, 25)],
        18: [(11, 20)], 19: [(11, 21)], 20: [(10, 21)], 21: [(10, 21)],
        22: [(10, 22)], 23: [(9, 22)], 24: [(9, 22)], 25: [(9, 23)], 26: [(9, 23)],
        27: [(9, 10), (12, 14), (16, 18), (20, 21)],
    })
    # bony hands out of the sleeves
    c.spans("bone", {18: [(6, 8), (23, 25)], 19: [(6, 6), (8, 8), (23, 23), (25, 25)]})
    # staff with a glowing gem
    for y in range(4, 28):
        c.set("wood", 4, y)
    c.spans("gold", {3: [(3, 5)], 2: [(3, 3), (5, 5)]})
    c.shade()
    GLOW = (110, 255, 140, 255)
    c.dots([(4, 2), (4, 1)], GLOW); c.dot(4, 3, (60, 200, 100, 255))
    c.dots([(5, 18), (5, 19)], BONE[1])                         # fingers round the staff
    # face
    for x, y in ((13, 6), (14, 6), (13, 7), (14, 7), (17, 6), (18, 6), (17, 7), (18, 7)):
        c.dot(x, y, DARK)
    c.dots([(14, 7), (17, 7)], GLOW)
    c.dots([(15, 8), (16, 8)], DARK)
    c.dots([(14, 10), (16, 10)], DARK)                           # teeth gaps
    c.dots([(14, 2), (17, 2)], (220, 60, 80, 255))               # crown gems
    c.dot(14, 4, (255, 248, 228, 255))
    # gold trim down the robe front and a pendant
    for y in range(12, 27):
        c.dot(15, y, GOLD[1] if y % 2 else GOLD[2])
    c.dots([(15, 12), (16, 12), (15, 13)], GOLD[0])
    c.dot(16, 13, GLOW)
    return c.render(shadow=(14, 53, 50, 61))


# ── Giant Spider ─────────────────────────────────────────────────
def giant_spider():
    c = Canvas()
    BODY = [(84, 70, 92, 255), (60, 50, 68, 255), (40, 34, 48, 255)]
    LEG = [(98, 82, 104, 255), (70, 58, 78, 255), (48, 40, 54, 255)]
    c.palette("body", BODY); c.palette("leg", LEG)
    # abdomen (back, raised) and head (front, lower)
    c.spans("body", {6: [(12, 19)], 7: [(10, 21)], 8: [(9, 22)], 9: [(9, 22)],
                     10: [(9, 22)], 11: [(9, 22)], 12: [(10, 21)], 13: [(11, 20)],
                     14: [(12, 19)], 15: [(12, 19)], 16: [(12, 19)], 17: [(12, 19)],
                     18: [(13, 18)], 19: [(13, 18)]})
    # 4 legs a side: up to a knee, then down to the ground
    legs = [((12, 14), (6, 9), (2, 18)), ((12, 15), (5, 12), (3, 24)),
            ((13, 16), (7, 15), (5, 27)), ((13, 17), (10, 18), (9, 27))]
    for (bx, by), (kx, ky), (fx, fy) in legs:
        c.line("leg", bx, by, kx, ky)
        c.line("leg", kx, ky, fx, fy)
        c.line("leg", 31 - bx, by, 31 - kx, ky)
        c.line("leg", 31 - kx, ky, 31 - fx, fy)
    c.shade()
    # red hourglass on the abdomen, hairy speckles
    c.dots([(15, 8), (16, 8), (15, 9), (16, 9), (15, 10), (16, 10)], (200, 40, 48, 255))
    c.dots([(14, 8), (17, 8), (14, 10), (17, 10)], (200, 40, 48, 255))
    c.dots([(15, 9), (16, 9)], (150, 24, 36, 255))
    c.dots([(11, 9), (20, 11), (12, 12), (19, 7)], BODY[0])
    # eight eyes and fangs
    c.dots([(14, 15), (17, 15), (15, 15), (16, 15)], RED_EYE)
    c.dots([(13, 16), (18, 16)], RED_EYE)
    c.dots([(15, 16), (16, 16)], (255, 140, 120, 255))
    c.dots([(14, 19), (17, 19), (14, 20), (17, 20)], WHITE)
    return c.render(shadow=(6, 52, 57, 61))


def depth_fill(c, name, cols):
    """Colour a part by how deep each pixel sits inside it (1 = edge):
    cols[0] at the rim, cols[-1] at the core. For glowing / fluid
    bodies (elementals) instead of the usual left-to-right shading."""
    from collections import deque
    dist = {}
    q = deque()
    for y in range(N):
        for x in range(N):
            if c.part[y][x] == name and any(
                not (0 <= x + dx < N and 0 <= y + dy < N) or c.part[y + dy][x + dx] != name
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                dist[(x, y)] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < N and 0 <= ny < N and c.part[ny][nx] == name and (nx, ny) not in dist:
                dist[(nx, ny)] = dist[(x, y)] + 1
                q.append((nx, ny))
    for (x, y), d in dist.items():
        c.dot(x, y, cols[min(d - 1, len(cols) - 1)])


# ── Troll ────────────────────────────────────────────────────────
def troll():
    c = Canvas()
    SKIN = [(126, 146, 108, 255), (94, 110, 82, 255), (66, 78, 60, 255)]
    HIDE = [(124, 96, 70, 255), (94, 72, 52, 255), (66, 50, 38, 255)]
    HAIRC = [(60, 72, 54, 255), (42, 52, 40, 255), (30, 36, 28, 255)]
    c.palette("skin", SKIN); c.palette("hide", HIDE); c.palette("hair", HAIRC)
    c.spans("hair", {1: [(11, 11), (14, 14), (17, 17)], 2: [(10, 18)], 3: [(10, 19)], 4: [(10, 19)]})
    c.spans("skin", {
        4: [(12, 18)], 5: [(11, 18)], 6: [(8, 18)], 7: [(7, 18)], 8: [(8, 18)],   # head + long nose
        9: [(11, 18)], 10: [(10, 20)],
        11: [(6, 25)], 12: [(5, 26)], 13: [(5, 26)],                               # huge shoulders
        14: [(5, 8), (10, 21), (23, 26)], 15: [(5, 8), (10, 21), (23, 26)],
        16: [(4, 7), (10, 21), (24, 27)], 17: [(4, 7), (10, 21), (24, 27)],
        18: [(4, 7), (10, 21), (24, 27)], 19: [(4, 7), (10, 21), (24, 27)],
        20: [(4, 7), (24, 27)], 21: [(4, 7), (24, 27)], 22: [(3, 7), (24, 28)],
        23: [(3, 7), (24, 28)],                                                     # long arms
    })
    c.spans("skin", {22: [(11, 14), (17, 20)], 23: [(11, 14), (17, 20)], 24: [(11, 14), (17, 20)],
                     25: [(11, 14), (17, 20)], 26: [(11, 14), (17, 20)], 27: [(9, 14), (17, 22)]})
    c.spans("hide", {20: [(10, 21)], 21: [(10, 21)]})
    c.shade()
    # face: small yellow eyes, heavy brow, underbite tusks, warts
    c.dots([(13, 6), (16, 6)], (240, 210, 70, 255))
    c.dots([(12, 5), (13, 5), (16, 5), (17, 5)], SKIN[2])
    c.dots([(11, 9), (12, 9), (13, 9), (14, 9), (15, 9)], (70, 34, 34, 255))
    c.dots([(12, 8), (15, 8)], WHITE)
    c.dots([(7, 7), (9, 8)], SKIN[2])
    c.dots([(12, 13), (19, 16), (8, 18), (25, 15), (14, 24)], SKIN[2])          # warts
    # claws
    c.dots([(3, 24), (5, 24), (7, 24), (24, 24), (26, 24), (28, 24)], WHITE)
    # hide loincloth: ragged hem and a rope
    for x in range(10, 22):
        c.dot(x, 20, (176, 150, 98, 255) if x % 2 == 0 else HIDE[2])
    c.dots([(11, 21), (15, 21), (19, 21)], CLEAR)
    return c.render(shadow=(8, 52, 58, 61))


# ── Vampire ──────────────────────────────────────────────────────
def vampire():
    f = person("person_male")
    PALE = [(232, 226, 236, 255), (196, 186, 204, 255), (150, 140, 164, 255)]
    BLACKH = [(56, 52, 66, 255), (38, 34, 46, 255), (24, 22, 30, 255)]
    reskin(f, PALE, BLACKH)
    p = f.part
    COAT = [(62, 56, 72, 255), (44, 40, 54, 255), (30, 28, 38, 255)]
    VEST = [(156, 30, 44, 255), (112, 22, 36, 255)]
    LINING = (176, 34, 48, 255)
    for y in range(N):
        for x in range(N):
            s = f.shade(x, y)
            if p[y][x] == "torso":
                f.px[y][x] = COAT[min(2, s)]
            elif p[y][x] == "arm" and y < f.arm_bot[x]:
                f.px[y][x] = COAT[min(2, s)]
            elif p[y][x] in ("shorts", "leg", "foot"):
                f.px[y][x] = COAT[min(2, s)] if p[y][x] != "foot" else BLACKH[2]
    # red waistcoat and a white cravat with a ruby pin
    for y in range(12, 17):
        for x in (14, 15, 16, 17):
            if p[y][x] == "torso":
                f.px[y][x] = VEST[0] if x < 16 else VEST[1]
    f.put(15, 11, WHITE); f.put(16, 11, WHITE); f.put(15, 12, WHITE); f.put(16, 12, (200, 196, 190, 255))
    f.put(15, 13, (220, 40, 60, 255))
    # widow's peak, red eyes, fangs
    f.put(15, 6, BLACKH[0]); f.put(16, 6, BLACKH[1])
    f.put(14, 7, RED_EYE); f.put(17, 7, RED_EYE)
    f.put(15, 9, (120, 30, 40, 255)); f.put(16, 9, (120, 30, 40, 255))
    f.put(15, 10, WHITE); f.put(16, 10, WHITE)
    # high collar standing up beside the head
    for y in (7, 8, 9, 10):
        f.put(11, y, LINING if y > 7 else COAT[0]); f.put(20, y, LINING if y > 7 else COAT[1])
    f.put(12, 10, COAT[0]); f.put(19, 10, COAT[1])
    # cape hanging behind: from the front you see its red lining
    # between the arms and legs, with the black outside at its edges,
    # flaring wider toward the hem
    LINING_D = (120, 22, 36, 255)
    for y in range(11, 27):
        flare = 0 if y < 18 else 1 if y < 23 else 2
        x0, x1 = 8 - flare, 23 + flare
        for x in range(x0, x1 + 1):
            if x in (x0, x1):
                c = COAT[1] if x == x0 else COAT[2]
            else:
                c = LINING if x < 16 else LINING_D
            f.put_behind(x, y, c)
    return f.render()


# ── Demon ────────────────────────────────────────────────────────
def demon():
    c = Canvas()
    RED = [(206, 70, 58, 255), (156, 46, 46, 255), (106, 30, 38, 255)]
    WING = [(110, 34, 48, 255), (82, 24, 38, 255), (58, 18, 30, 255)]
    HORN = [(226, 210, 176, 255), (170, 152, 124, 255), (110, 96, 80, 255)]
    HOOF = [(60, 46, 50, 255), (40, 30, 34, 255), (28, 20, 24, 255)]
    LOIN = [(70, 52, 56, 255), (50, 36, 40, 255), (36, 26, 30, 255)]
    for n, pal in (("red", RED), ("wing", WING), ("horn", HORN), ("hoof", HOOF), ("loin", LOIN)):
        c.palette(n, pal)
    c.spans("wing", {2: [(2, 3)], 3: [(2, 5)], 4: [(2, 7)], 5: [(2, 9)], 6: [(3, 9)],
                     7: [(3, 9)], 8: [(4, 9)], 9: [(4, 9)], 10: [(5, 6), (8, 9)], 11: [(9, 9)]},
            mirror=True)
    c.spans("horn", {1: [(10, 10), (21, 21)], 2: [(10, 11), (20, 21)], 3: [(11, 12), (19, 20)],
                     4: [(12, 12), (19, 19)]})
    c.spans("red", {
        4: [(13, 18)], 5: [(12, 19)], 6: [(12, 19)], 7: [(12, 19)], 8: [(12, 19)],
        9: [(13, 18)], 10: [(14, 17)],
        11: [(9, 22)], 12: [(8, 23)], 13: [(8, 23)], 14: [(9, 22)], 15: [(10, 21)],
        16: [(10, 21)], 17: [(11, 20)], 18: [(11, 20)],
    })
    c.spans("red", {13: [(6, 7), (24, 25)], 14: [(6, 7), (24, 25)], 15: [(6, 8), (23, 25)],
                    16: [(6, 8), (23, 25)], 17: [(6, 8), (23, 25)], 18: [(6, 8), (23, 25)],
                    19: [(6, 8), (23, 25)], 20: [(6, 8), (23, 25)]})
    c.spans("loin", {19: [(11, 20)], 20: [(11, 20)]})
    c.spans("red", {21: [(11, 14), (17, 20)], 22: [(11, 14), (17, 20)], 23: [(12, 14), (17, 19)],
                    24: [(13, 14), (17, 18)], 25: [(12, 13), (18, 19)], 26: [(11, 12), (19, 20)]})
    c.spans("hoof", {27: [(10, 12), (19, 21)]})
    # tail curling out to the right with an arrow tip
    for x, y in ((21, 21), (22, 22), (23, 23), (24, 23), (25, 22), (26, 21), (27, 20)):
        c.set("red", x, y)
    c.spans("red", {19: [(28, 28)], 20: [(27, 29)]})
    c.shade()
    c.dots([(14, 6), (17, 6)], (255, 220, 60, 255))                  # burning eyes
    c.dots([(13, 5), (14, 5), (17, 5), (18, 5)], RED[2])
    c.dots([(14, 8), (15, 8), (16, 8), (17, 8)], (60, 16, 20, 255))
    c.dots([(14, 8), (17, 8)], WHITE)
    c.dots([(15, 13), (16, 13), (15, 15), (16, 15), (15, 17), (16, 17)], RED[2])   # abs
    c.dots([(12, 12), (19, 12)], RED[0])
    c.dots([(6, 21), (8, 21), (23, 21), (25, 21)], HORN[0])          # claws
    c.dots([(4, 4), (5, 6), (7, 8), (27, 4), (26, 6), (24, 8)], WING[0])   # wing bones
    c.dot(15, 19, GOLD[0]); c.dot(16, 19, GOLD[1])
    return c.render(shadow=(10, 52, 54, 61))


# ── Elementals ───────────────────────────────────────────────────
def _elemental_body(c, name, head=True):
    """A shared hulking elemental silhouette: big head-and-shoulders mass
    that tapers into a swirling base, with two heavy arms."""
    rows = {
        3: [(13, 18)], 4: [(12, 19)], 5: [(11, 20)], 6: [(11, 20)], 7: [(11, 20)],
        8: [(11, 20)], 9: [(10, 21)], 10: [(8, 23)], 11: [(7, 24)], 12: [(6, 25)],
        13: [(6, 25)], 14: [(6, 9), (11, 20), (22, 25)], 15: [(5, 9), (11, 20), (22, 26)],
        16: [(5, 9), (11, 20), (22, 26)], 17: [(5, 9), (11, 20), (22, 26)],
        18: [(5, 8), (12, 19), (23, 26)], 19: [(5, 8), (12, 19), (23, 26)],
        20: [(12, 19)], 21: [(13, 19)], 22: [(13, 18)], 23: [(12, 18)],
        24: [(11, 19)], 25: [(10, 20)], 26: [(9, 21)], 27: [(9, 22)],
    }
    c.spans(name, rows)


def fire_elemental():
    c = Canvas()
    _elemental_body(c, "fire")
    # flame tongues licking up from the head and shoulders
    c.spans("fire", {0: [(16, 16)], 1: [(15, 16), (12, 12), (20, 20)], 2: [(12, 13), (15, 17), (19, 20)],
                     9: [(7, 7), (24, 24)], 8: [(7, 7)], 7: [(24, 24)], 13: [(4, 4)], 12: [(4, 4)]})
    depth_fill(c, "fire", [(196, 44, 32, 255), (240, 110, 40, 255), (250, 170, 60, 255),
                           (255, 226, 120, 255), (255, 248, 210, 255)])
    c.dots([(13, 7), (14, 7), (17, 7), (18, 7)], (90, 20, 14, 255))
    c.dots([(14, 7), (17, 7)], (255, 255, 230, 255))
    c.dots([(14, 10), (15, 10), (16, 10), (17, 10)], (110, 26, 16, 255))
    c.dots([(9, 21), (22, 22), (8, 25), (24, 26)], (240, 110, 40, 255))   # embers
    return c.render(shadow=(10, 53, 54, 61), outline=(84, 18, 14, 255))


def water_elemental():
    c = Canvas()
    _elemental_body(c, "water")
    c.spans("water", {2: [(14, 17)], 1: [(16, 18)], 0: [(18, 19)]})   # wave crest curling over
    depth_fill(c, "water", [(54, 98, 190, 230), (70, 132, 214, 225), (96, 168, 232, 220),
                            (128, 200, 244, 215)])
    FOAM = (232, 246, 255, 255)
    c.dots([(18, 0), (19, 0), (17, 1), (18, 1), (14, 2), (15, 2), (13, 3), (12, 4)], FOAM)
    c.dots([(6, 12), (7, 11), (8, 10), (25, 12), (24, 11), (23, 10)], FOAM)
    c.dots([(9, 27), (10, 26), (21, 27), (20, 26), (11, 25)], FOAM)
    c.dots([(13, 7), (14, 7), (17, 7), (18, 7)], (220, 250, 255, 255))   # glowing eyes
    for y in (14, 18, 22):                                              # current swirls
        c.dots([(13, y), (14, y + 1), (16, y + 1), (17, y)], (150, 214, 250, 225))
    return c.render(shadow=(10, 53, 54, 61), outline=(22, 34, 76, 255))


def earth_elemental():
    c = Canvas()
    ROCK = [(150, 128, 104, 255), (114, 96, 80, 255), (80, 68, 58, 255)]
    MOSS = (104, 140, 70, 255)
    c.palette("rock", ROCK)
    _elemental_body(c, "rock")
    # broaden into boulder legs instead of a swirl
    c.spans("rock", {22: [(11, 14), (17, 20)], 23: [(10, 14), (17, 21)], 24: [(10, 14), (17, 21)],
                     25: [(10, 14), (17, 21)], 26: [(9, 14), (17, 22)], 27: [(9, 14), (17, 22)]})
    for x in (15, 16):
        for y in range(23, 28):
            c.erase(x, y)
    c.shade()
    CRACK = (60, 50, 44, 255)
    for pts in ([(11, 11), (12, 12), (12, 13)], [(19, 12), (20, 13)], [(7, 15), (8, 16)],
                [(24, 16), (25, 17)], [(13, 17), (14, 18), (14, 19)], [(18, 15), (18, 16)],
                [(12, 25), (13, 26)], [(19, 24), (20, 25)]):
        c.dots(pts, CRACK)
    c.dots([(12, 10), (13, 10), (22, 11), (6, 13), (19, 21)], MOSS)
    c.dots([(13, 6), (14, 6), (17, 6), (18, 6)], (40, 30, 26, 255))
    c.dots([(14, 6), (17, 6)], (255, 190, 60, 255))                     # ember eyes
    c.dots([(15, 14), (16, 14), (16, 15)], (130, 220, 230, 255))        # crystal in the chest
    c.dot(15, 15, (70, 160, 190, 255))
    return c.render(shadow=(8, 52, 56, 61))


def air_elemental():
    c = Canvas()
    _elemental_body(c, "air")
    # narrow the base into a twisting funnel
    for y in range(20, 28):
        for x in range(N):
            c.erase(x, y)
    c.spans("air", {20: [(12, 19)], 21: [(13, 19)], 22: [(13, 18)], 23: [(14, 18)],
                    24: [(14, 17)], 25: [(15, 17)], 26: [(15, 16)], 27: [(16, 16)]})
    depth_fill(c, "air", [(170, 188, 210, 170), (204, 218, 234, 175), (230, 238, 248, 185)])
    STREAK = (140, 196, 236, 210)
    for y, xs in ((11, (8, 9, 10)), (13, (21, 22, 23)), (16, (12, 13, 14)), (19, (15, 16, 17)),
                  (22, (14, 15)), (25, (15, 16)), (8, (12, 13)), (5, (17, 18))):
        c.dots([(x, y) for x in xs], STREAK)
    c.dots([(13, 7), (14, 7), (17, 7), (18, 7)], (70, 96, 140, 255))
    c.dots([(14, 7), (17, 7)], (200, 240, 255, 255))
    c.dots([(15, 10), (16, 10)], (90, 116, 160, 220))
    return c.render(shadow=(18, 55, 46, 60), shadow_alpha=60, outline=(70, 86, 118, 200))


# ── Dragon ───────────────────────────────────────────────────────
def dragon():
    c = Canvas()
    SCALE = [(204, 64, 52, 255), (152, 42, 42, 255), (104, 28, 34, 255)]
    WING = [(160, 52, 50, 255), (118, 36, 40, 255), (82, 24, 32, 255)]
    BELLY = [(236, 186, 104, 255), (200, 144, 74, 255)]
    HORN = [(232, 220, 190, 255), (176, 160, 132, 255), (120, 106, 88, 255)]
    c.palette("scale", SCALE); c.palette("wing", WING); c.palette("horn", HORN)
    # raised wing behind the body
    c.spans("wing", {1: [(22, 23)], 2: [(19, 25)], 3: [(17, 27)], 4: [(16, 28)], 5: [(15, 29)],
                     6: [(15, 29)], 7: [(14, 29)], 8: [(14, 28)], 9: [(14, 27)], 10: [(15, 26)],
                     11: [(15, 25)], 12: [(16, 24)], 13: [(17, 23)]})
    for x, y in ((29, 8), (28, 9), (27, 10), (26, 11), (24, 12)):       # scalloped edge
        c.erase(x, y)
    # head (facing left), horns, neck
    c.spans("horn", {2: [(9, 9)], 3: [(8, 9)], 4: [(7, 8)]})
    c.spans("scale", {
        4: [(4, 6)], 5: [(2, 9)], 6: [(1, 10)], 7: [(1, 11)], 8: [(2, 11)],
        9: [(4, 12)], 10: [(8, 13)], 11: [(9, 13)], 12: [(9, 14)], 13: [(9, 15)],
        14: [(8, 22)], 15: [(8, 24)], 16: [(8, 25)], 17: [(8, 26)], 18: [(9, 26)],
        19: [(9, 26)], 20: [(10, 25)], 21: [(10, 13), (19, 24)], 22: [(10, 13), (19, 23)],
        23: [(10, 13), (20, 23)], 24: [(10, 13), (20, 22)], 25: [(10, 13), (20, 22)],
        26: [(10, 13), (20, 22)], 27: [(9, 14), (19, 23)],
    })
    # tail sweeping back and down to a spade
    c.spans("scale", {17: [(27, 28)], 18: [(27, 29)], 19: [(28, 29)], 20: [(28, 30)],
                      21: [(29, 30)], 22: [(29, 30)], 23: [(28, 30)], 24: [(27, 29)],
                      25: [(26, 28)], 26: [(25, 28)]})
    c.shade()
    for x, y in ((10, 12), (10, 13), (9, 14), (9, 15), (9, 16), (9, 17), (10, 18), (10, 19),
                 (11, 20), (12, 19), (12, 18), (13, 20), (14, 20), (15, 20), (16, 20)):
        c.dot(x, y, BELLY[0] if y < 18 else BELLY[1])                    # belly plates
    for x, y in ((18, 3), (17, 5), (16, 7), (16, 9), (20, 3), (21, 5), (22, 8), (24, 4), (26, 6)):
        c.dot(x, y, WING[2])                                            # wing bones
    c.dots([(16, 13), (19, 13), (22, 13), (14, 13)], SCALE[2])           # back ridge
    c.dots([(6, 6)], (255, 220, 60, 255)); c.dot(5, 6, DARK)             # eye
    c.dots([(1, 7), (2, 8), (3, 8), (4, 8)], (90, 20, 24, 255))          # mouth line
    c.dots([(2, 7), (4, 7)], WHITE)                                     # teeth
    c.dots([(3, 5)], DARK)                                              # nostril
    c.dots([(0, 9), (1, 10)], (255, 170, 60, 255)); c.dot(0, 10, (255, 230, 120, 255))  # embers
    c.dots([(9, 27), (11, 27), (13, 27), (19, 27), (21, 27), (23, 27)], HORN[1])  # claws
    c.dots([(26, 26), (25, 26)], HORN[1])
    return c.render(shadow=(6, 52, 60, 61))


BUILDERS = {
    "giant_bat": giant_bat,
    "orc": orc,
    "slime_mold": slime_mold,
    "gelatinous_cube": gelatinous_cube,
    "ghost": ghost,
    "zombie": zombie,
    "lich": lich,
    "giant_spider": giant_spider,
    "troll": troll,
    "vampire": vampire,
    "demon": demon,
    "fire_elemental": fire_elemental,
    "water_elemental": water_elemental,
    "earth_elemental": earth_elemental,
    "air_elemental": air_elemental,
    "red_dragon": dragon,
}


if __name__ == "__main__":
    PERSON_DIR = sys.argv[1]
    out_dir = sys.argv[2]
    only = sys.argv[3:] or list(BUILDERS)
    os.makedirs(out_dir, exist_ok=True)
    for name in only:
        BUILDERS[name]().save(os.path.join(out_dir, f"{name}.png"))
    print(len(only), "monsters ->", out_dir)
