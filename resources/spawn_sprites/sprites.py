"""Monster-lair map sprites for Spawns (sprites/map/spawns/)."""
import math

from px import *  # noqa: F401,F403


def tent(c, x0, x1, base, peak_x, peak_y, colors=HIDE, door=True):
    c.poly([(x0, base), (peak_x, peak_y), (x1, base)], colors, bias=0.05)
    # seam / pole
    c.line(peak_x, peak_y, peak_x, base, colors[0])
    if door:
        w = max(2, (x1 - x0) // 5)
        c.poly([(peak_x - w, base), (peak_x, base - (base - peak_y) * 0.55), (peak_x + w, base)],
               [(20, 14, 12), (42, 26, 20)], noise=0.3)
    # poles sticking out the top
    c.line(peak_x - 1, peak_y - 2, peak_x, peak_y, WOOD[1])
    c.line(peak_x + 2, peak_y - 2, peak_x + 1, peak_y, WOOD[2])


def campfire(c, x, y):
    for dx in (-3, -1, 1, 3):
        c.put(x + dx, y, STONE[3])
        c.put(x + dx, y - 1, STONE[1])
    c.line(x - 3, y - 1, x + 3, y - 2, WOOD[2])
    c.line(x - 3, y - 2, x + 3, y - 1, WOOD[3])
    flame = c.poly([(x - 3, y - 2), (x - 1, y - 7), (x, y - 5), (x + 1, y - 9), (x + 3, y - 2)],
                   FIRE, light=None, noise=0.3, bias=0.35)
    return flame


def skull(c, x, y, colors=BONE):
    c.blob(x + 1.5, y + 1.5, 2.6, 2.3, colors, bias=0.25, noise=0.1)
    c.put(x, y + 2, (20, 14, 12))
    c.put(x + 2, y + 2, (20, 14, 12))
    c.put(x + 1, y + 4, colors[1])


def bones(c, x, y, n=3):
    for i in range(n):
        dx = c.rng.randint(-1, 1)
        c.line(x + i * 3, y + dx, x + i * 3 + 3, y - 1 + dx, BONE[3])
        c.put(x + i * 3, y + dx, BONE[4])


# ── 1. Goblin camp ────────────────────────────────────────────────
def goblin_camp():
    c = Canvas(11)
    tent(c, 4, 30, 57, 17, 28)
    tent(c, 30, 54, 58, 42, 34, colors=ramp("#2b4f28", "#486322", "#5b7d26", "#739127", "#93a729"))
    # crude banner pole with skull
    c.line(56, 22, 56, 57, WOOD[2])
    c.line(57, 22, 57, 57, WOOD[1])
    c.poly([(58, 24), (63, 26), (58, 31)], RED[2:5], noise=0.25)
    skull(c, 54, 17)
    c.glow(29, 55, 5, FIRE[:3], density=0.35)
    campfire(c, 29, 59)
    c.ground(2, 61, 61)
    c.outline()
    return c


# ── 2. Orc war totem ──────────────────────────────────────────────
def orc_war_camp():
    c = Canvas(12)
    tent(c, 2, 26, 58, 13, 36, colors=HIDE)
    # spiked palisade
    for x in range(36, 62, 4):
        top = 34 + c.rng.randint(0, 6)
        c.poly([(x, 58), (x, top + 3), (x + 1.5, top), (x + 3, top + 3), (x + 3, 58)], WOOD, noise=0.25)
    c.line(36, 46, 62, 46, WOOD[1])
    # totem pole with stacked skulls + horns
    c.box(28, 18, 33, 58, WOOD, noise=0.25)
    skull(c, 28, 22)
    skull(c, 28, 31)
    c.line(26, 20, 24, 14, BONE[3])
    c.line(35, 20, 37, 14, BONE[3])
    c.line(25, 19, 23, 15, BONE[2])
    c.line(36, 19, 38, 15, BONE[2])
    c.poly([(33, 40), (40, 42), (33, 47)], RED[2:5], noise=0.25)
    c.ground(2, 61, 61)
    c.outline()
    return c


# ── 3. Bandit hideout ─────────────────────────────────────────────
def bandit_hideout():
    c = Canvas(13)
    # shack body
    c.box(14, 34, 46, 57, WOOD, noise=0.25)
    for y in range(37, 57, 4):
        c.line(14, y, 46, y, WOOD[0])
    # slanted plank roof
    c.poly([(9, 36), (30, 20), (51, 36), (48, 38), (30, 25), (12, 38)], DIRT, noise=0.2, bias=0.15)
    c.poly([(12, 37), (30, 23), (48, 37)], ramp("#472d23", "#644d48", "#733c28", "#9e502f"), noise=0.25)
    # dark door + shuttered window with lantern glow
    c.box(25, 44, 32, 57, [(16, 10, 10), (34, 22, 18)], noise=0.3)
    c.box(37, 41, 42, 46, FIRE[1:4], noise=0.3)
    c.line(36, 40, 43, 40, WOOD[0])
    # sacks/crates
    c.box(48, 49, 56, 57, ramp("#733c28", "#9e502f", "#ac7944", "#d8b17e"), noise=0.25)
    c.line(48, 53, 56, 53, WOOD[1])
    c.blob(9, 54, 4, 3.5, ramp("#644d48", "#8a7c74", "#b49778", "#d8b17e"), bias=0.1)
    c.ground(2, 61, 61)
    c.outline()
    return c


# ── 4. Haunted graveyard ──────────────────────────────────────────
def haunted_graveyard():
    c = Canvas(14)
    def stone(x, y, w, h):
        c.box(x, y + 2, x + w, y + h, GREY[1:], noise=0.22)
        c.blob(x + w / 2 + 0.5, y + 2.5, w / 2 + 0.5, 2.5, GREY[1:], bias=0.2)
        c.line(x + 1, y + 5, x + w - 1, y + 5, GREY[1])
    stone(6, 38, 9, 19)
    stone(42, 40, 9, 17)
    # cross
    c.box(27, 30, 30, 57, GREY[1:], noise=0.2)
    c.box(22, 36, 35, 39, GREY[1:], noise=0.2)
    stone(17, 46, 6, 11)
    stone(35, 47, 6, 10)
    # dead tree
    c.line(55, 57, 56, 30, WOOD[1], w=2)
    c.line(56, 38, 61, 31, WOOD[1])
    c.line(56, 34, 51, 27, WOOD[1])
    # wisps
    for (wx, wy) in ((14, 22), (40, 24), (30, 14)):
        c.glow(wx, wy, 4.2, SPECTRAL, density=0.85)
        c.line(wx, wy + 3, wx - 1, wy + 7, SPECTRAL[1])
        c.put(wx - 1, wy - 1, (2, 2, 4))
        c.put(wx + 1, wy - 1, (2, 2, 4))
    c.ground(2, 61, 61, colors=ramp("#1f261d", "#2b4f28", "#397037", "#486322", "#5b7d26"), rock_colors=GREY)
    c.outline()
    return c


# ── 5. Crypt ──────────────────────────────────────────────────────
def crypt():
    c = Canvas(15)
    c.box(10, 30, 53, 57, SAND, noise=0.22)
    # pediment
    c.poly([(6, 31), (31.5, 14), (57, 31)], SAND, noise=0.2, bias=0.1)
    c.line(6, 31, 57, 31, SAND[0])
    # columns
    for x in (12, 21, 40, 49):
        c.box(x, 32, x + 3, 57, SAND[1:], noise=0.15, bias=0.2)
    # doorway with necrotic glow
    c.box(26, 36, 37, 57, [(4, 10, 10), (10, 30, 24)], noise=0.3)
    c.blob(31.5, 37, 5.5, 3.5, [(4, 10, 10), (10, 30, 24)], noise=0.2)
    c.glow(31.5, 47, 5.5, NECRO, density=0.7)
    # cracks + skull above door
    c.line(44, 34, 47, 40, SAND[0])
    c.line(15, 42, 17, 47, SAND[0])
    skull(c, 30, 21)
    # bones outside
    bones(c, 40, 59, 2)
    c.ground(2, 61, 61, colors=ramp("#1f261d", "#2b4f28", "#397037", "#486322", "#5b7d26"))
    c.outline()
    return c


# ── 6. Monster den (cave with glowing eyes) ───────────────────────
def monster_den():
    c = Canvas(16)
    # back mound
    c.blob(32, 46, 28, 20, STONE, bias=0.1, noise=0.25)
    for (x, y, r) in ((12, 46, 8), (22, 34, 9), (36, 30, 10), (49, 38, 9), (54, 50, 7), (8, 55, 6)):
        c.boulder(x, y, r, STONE, moss=0.45)
    # cave mouth
    m = c.ellipse_mask(32, 54, 11, 13) & (c.yy < 58)
    c.fill_mask(m, [(2, 2, 4), (10, 10, 18), (20, 20, 30)], c.sphere_light(32, 50, 11, 13, -0.2), 0.15)
    # eyes
    for ex, ey in ((27, 48), (33, 47), (30, 53), (36, 52)):
        c.put(ex, ey, (240, 239, 73))
        c.put(ex + 1, ey, (248, 188, 78))
    bones(c, 22, 59, 2)
    skull(c, 41, 55)
    c.ground(2, 61, 61)
    c.outline()
    return c


# ── 7. Wolf den ───────────────────────────────────────────────────
def wolf_den():
    c = Canvas(17)
    # earthen mound with roots
    c.blob(32, 50, 29, 16, DIRT, bias=0.05, noise=0.25)
    c.moss_on(32, 50, 29, 16, 0.55)
    # tree on top
    c.line(40, 38, 41, 22, WOOD[2], w=3)
    c.blob(40, 17, 11, 9, GREEN[1:6], bias=0.1)
    c.blob(33, 21, 7, 6, GREEN[1:6], bias=0.15)
    c.blob(48, 22, 7, 6, GREEN[1:6], bias=0.05)
    # roots hanging over the burrow
    m = c.ellipse_mask(26, 57, 10, 9) & (c.yy < 59)
    c.fill_mask(m, [(2, 2, 4), (14, 10, 10), (28, 20, 18)], c.sphere_light(26, 53, 10, 9, -0.2), 0.15)
    for x in (19, 23, 28, 32):
        c.line(x, 48, x + c.rng.randint(-1, 1), 52 + c.rng.randint(0, 3), WOOD[1])
    # eyes
    for ex, ey in ((23, 55), (28, 55)):
        c.put(ex, ey, (240, 239, 73))
    c.boulder(52, 54, 5, STONE, moss=0.5)
    bones(c, 36, 59, 2)
    c.ground(2, 61, 61)
    c.outline()
    return c


# ── 8. Bat roost (hollow dead tree / cave crag) ───────────────────
def bat_roost():
    c = Canvas(18)
    # crag
    c.poly([(6, 58), (14, 30), (22, 22), (30, 26), (38, 14), (46, 24), (54, 34), (60, 58)], DARKROCK, noise=0.25, bias=0.1)
    for (x, y, r) in ((14, 52, 6), (50, 51, 7)):
        c.boulder(x, y, r, STONE, moss=0.4)
    # dark hollows
    for (x, y, rx, ry) in ((31, 46, 7, 9), (42, 34, 3, 4), (21, 38, 2.5, 3)):
        m = c.ellipse_mask(x, y, rx, ry)
        c.fill_mask(m, [(2, 2, 4), (12, 12, 20)], None, 0.3)
    # bats
    def bat(x, y, s=1):
        c.poly([(x - 4 * s, y), (x - 2 * s, y - 2 * s), (x, y), (x + 2 * s, y - 2 * s), (x + 4 * s, y), (x, y + 2 * s)],
               [(52, 34, 60), (94, 66, 104), (130, 98, 140)], noise=0.3)
        c.put(x - 1, y, (240, 120, 60))
        c.put(x + 1, y, (240, 120, 60))
    bat(16, 14)
    bat(50, 10)
    bat(30, 6, 1)
    bat(56, 22)
    c.ground(2, 61, 61, colors=ramp("#1f261d", "#2b4f28", "#397037", "#486322", "#5b7d26"))
    c.outline()
    return c


# ── 9. Spider nest ────────────────────────────────────────────────
def spider_nest():
    c = Canvas(19)
    # gnarled dead stumps/rocks
    c.boulder(16, 48, 11, DARKROCK, squash=0.9)
    c.boulder(46, 48, 12, DARKROCK, squash=0.85)
    c.line(30, 58, 31, 22, WOOD[1], w=3)
    c.line(31, 30, 20, 18, WOOD[1], w=2)
    c.line(32, 27, 45, 16, WOOD[1], w=2)
    # web sheets (radial strands + rings)
    for (cx, cy, r, spokes) in ((31, 26, 15, 8), (15, 44, 8, 5), (47, 43, 8, 5)):
        for k in range(spokes):
            a = k * 2 * math.pi / spokes + 0.3
            c.line(cx, cy, cx + math.cos(a) * r, cy + math.sin(a) * r, WEB[0])
        for rr in (r * 0.45, r * 0.85):
            n = int(rr * 1.6)
            for k in range(n):
                a = k * 2 * math.pi / n
                if c.rng.random() < 0.75:
                    c.put(cx + math.cos(a) * rr, cy + math.sin(a) * rr, WEB[1])
    # egg sacs
    for (x, y) in ((10, 55), (13, 57), (52, 56), (55, 54), (24, 57)):
        c.blob(x, y, 2.4, 2.2, BONE[2:], bias=0.2)
    # spider
    c.blob(31, 30, 3.5, 3, [(20, 14, 26), (52, 34, 60), (90, 50, 80)], bias=0.1)
    c.blob(31, 25.5, 2.3, 2, [(20, 14, 26), (52, 34, 60)], bias=0.1)
    for s in (-1, 1):
        for k, (dy, ly) in enumerate(((-1, -4), (0, -1), (1, 2), (2, 5))):
            c.line(31 + 3 * s, 30 + dy, 31 + 7 * s, 30 + ly, (20, 14, 26))
    c.put(30, 25, (236, 90, 46))
    c.put(32, 25, (236, 90, 46))
    c.ground(2, 61, 61, colors=ramp("#1f261d", "#2b4f28", "#397037", "#486322", "#5b7d26"), rock_colors=GREY)
    c.outline()
    return c


# ── 10. Ritual circle (devil cult) ────────────────────────────────
def ritual_circle():
    c = Canvas(20)
    # glowing sigil ring on the ground (ellipse, perspective)
    m = c.ellipse_mask(32, 52, 26, 8)
    c.fill_mask(m, ramp("#2a1a14", "#472d23", "#644d48"), None, 0.3)
    for k in range(60):
        a = k * 2 * math.pi / 60
        c.put(32 + math.cos(a) * 20, 52 + math.sin(a) * 6, RED[4])
        if k % 3 == 0:
            c.put(32 + math.cos(a) * 15, 52 + math.sin(a) * 4.5, RED[3])
    # pentagram lines
    pts = [(32 + math.cos(-math.pi / 2 + i * 4 * math.pi / 5) * 14, 52 + math.sin(-math.pi / 2 + i * 4 * math.pi / 5) * 4.2) for i in range(6)]
    for i in range(5):
        c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], RED[5])
    c.glow(32, 50, 5, RED[2:], density=0.6)
    # standing stones (back row then front row)
    for (x, h) in ((14, 26), (32, 22), (50, 26)):
        c.poly([(x - 4, 50), (x - 3, 50 - h), (x, 50 - h - 3), (x + 3, 50 - h), (x + 4, 50)], GREY[1:], noise=0.22)
        c.put(x, 50 - h + 6, PURPLE[4])
        c.put(x - 1, 50 - h + 9, PURPLE[3])
    for (x, h) in ((6, 18), (58, 18)):
        c.poly([(x - 3, 59), (x - 3, 59 - h), (x, 59 - h - 2), (x + 3, 59 - h), (x + 3, 59)], GREY[1:], noise=0.22)
    # candles
    for x in (20, 44, 27, 37):
        c.line(x, 58, x, 55, BONE[3])
        c.put(x, 54, FIRE[4])
        c.put(x, 53, FIRE[3])
    c.ground(2, 61, 61, colors=DEADGRASS, rock_colors=GREY)
    c.outline()
    return c


# ── 11. Demon gate ────────────────────────────────────────────────
def demon_gate():
    c = Canvas(21)
    # fiery portal
    c.blob(32, 38, 13, 18, RED, bias=-0.15, noise=0.2)
    c.glow(32, 42, 8, RED[3:], density=0.8)
    # obsidian jagged arch
    left = [(6, 58), (8, 34), (5, 26), (11, 22), (13, 12), (18, 18), (24, 8), (28, 15), (32, 4), (36, 15), (40, 8), (46, 18), (51, 12), (53, 22), (59, 26), (56, 34), (58, 58),
            (46, 58), (45, 34), (40, 24), (32, 20), (24, 24), (19, 34), (18, 58)]
    c.poly(left, DARKROCK, noise=0.3, bias=0.05)
    # lava cracks on the arch
    for (x0, y0, x1, y1) in ((10, 30, 13, 44), (51, 28, 53, 46), (24, 12, 27, 18), (40, 12, 37, 18)):
        c.line(x0, y0, x1, y1, RED[4])
    # horns / skulls at base
    skull(c, 9, 52, BONE)
    skull(c, 51, 52, BONE)
    c.ground(2, 61, 61, colors=ramp("#2a0b0e", "#472d23", "#5a1418", "#644d48"), rock_colors=DARKROCK)
    c.outline()
    return c


# ── 12. Elemental rift ────────────────────────────────────────────
def elemental_rift():
    c = Canvas(22)
    def crystal(x, base, h, w, colors=CYAN):
        c.poly([(x - w, base), (x - w, base - h * 0.7), (x, base - h), (x + w, base - h * 0.7), (x + w, base)], colors, noise=0.15, bias=0.15)
        c.line(x, base - h + 1, x, base - 1, colors[-1])
    crystal(32, 58, 34, 5)
    crystal(22, 58, 22, 4)
    crystal(43, 58, 24, 4)
    crystal(14, 59, 12, 3)
    crystal(51, 59, 14, 3)
    # floating rocks
    for (x, y, r) in ((10, 26, 4), (54, 18, 3.5), (20, 10, 2.5), (46, 34, 2.5)):
        c.boulder(x, y, r, STONE)
        c.put(x, y + r * 0.8 + 2, CYAN[3])
    c.ground(2, 61, 61, colors=GREY[:4], rock_colors=STONE)
    c.outline()
    # sparks — after the outline so they float un-outlined
    for _ in range(10):
        x, y = c.rng.randint(8, 56), c.rng.randint(6, 30)
        if c.px[y, x, 3] == 0:
            c.put(x, y, c.rng.choice(CYAN[3:]))
    return c


# ── 13. Arcane portal ─────────────────────────────────────────────
def arcane_portal():
    c = Canvas(23)
    # swirling portal
    cx, cy = 32, 34
    for y in range(12, 58):
        for x in range(12, 53):
            dx, dy = (x + 0.5 - cx) / 15, (y + 0.5 - cy) / 21
            d = math.hypot(dx, dy)
            if d > 1:
                continue
            a = math.atan2(dy, dx)
            v = 0.5 + 0.5 * math.sin(a * 3 + d * 9)
            l = 0.25 + 0.55 * v * (1 - d * 0.5) + c.noise() * 0.1
            i = int(max(0, min(len(PURPLE) - 1, l * len(PURPLE))))
            c.put(x, y, PURPLE[i])
    # stone ring frame (ring of blocks)
    for k in range(22):
        a = k * 2 * math.pi / 22
        bx, by = cx + math.cos(a) * 17, cy + math.sin(a) * 23
        if by > 58:
            continue
        c.blob(bx, by, 3.2, 3.2, STONE, bias=0.15, noise=0.15)
        if k % 4 == 0:
            c.put(bx, by, CYAN[4])
    # plinth steps
    c.box(8, 55, 56, 58, SAND, noise=0.2)
    c.box(4, 58, 60, 60, SAND, noise=0.2)
    c.ground(2, 61, 61, rocks=False)
    c.outline()
    return c


ALL = {
    "goblin_camp": goblin_camp,
    "orc_war_camp": orc_war_camp,
    "bandit_hideout": bandit_hideout,
    "haunted_graveyard": haunted_graveyard,
    "crypt": crypt,
    "monster_den": monster_den,
    "wolf_den": wolf_den,
    "bat_roost": bat_roost,
    "spider_nest": spider_nest,
    "ritual_circle": ritual_circle,
    "demon_gate": demon_gate,
    "elemental_rift": elemental_rift,
    "arcane_portal": arcane_portal,
}
