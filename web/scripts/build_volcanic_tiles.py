#!/usr/bin/env python3
"""
Build the "Volcanic Tubes" dungeon tile set.

Takes the Cave set's shapes (so walls, pit rims and corners line up the
same way in generated layouts), recolours the stone to dark basalt /
obsidian, and paints lava, embers and flames on top. Art is drawn at the
set's native 32x32 and written 2x (64x64), like every other dungeon set.

Writes:
  public/modules/default/sprites/dungeons/volcanic_tubes/<group>/<file>.png
  public/modules/default/map_tiles.json  (adds / refreshes the
      `volcanic_*` entries under tag "Dungeons:volcanic tubes:<group>")

The sprites shipped now are hand-made replacements (Nov 2026), so by
default this only (re)writes the tile entries in map_tiles.json and
leaves the PNGs alone. Pass --draw-art to regenerate the original
procedural art over them.

Usage:  python3 scripts/build_volcanic_tiles.py [--draw-art]
"""

import json
import math
import os
import random
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "modules", "default")
CAVE = os.path.join(ROOT, "sprites", "dungeons", "cave")
OUT = os.path.join(ROOT, "sprites", "dungeons", "volcanic_tubes")
TILES_JSON = os.path.join(ROOT, "map_tiles.json")
SPRITE_PREFIX = "dungeons/volcanic_tubes"
TAG = "Dungeons:volcanic tubes"
N = 32  # logical art size

# ── Palettes ────────────────────────────────────────────────────────
CLEAR = (0, 0, 0, 0)
# Basalt, darkest → lightest (cool charcoal with a faint warm cast).
B0, B1, B2, B3, B4, B5, B6 = (
    (10, 8, 10, 255),
    (24, 20, 23, 255),
    (34, 28, 31, 255),
    (42, 35, 37, 255),
    (52, 43, 44, 255),
    (64, 53, 52, 255),
    (86, 72, 66, 255),
)
# Obsidian — glassy blue-black with violet sheen.
O0, O1, O2, O3 = (8, 6, 12, 255), (20, 16, 30, 255), (38, 30, 56, 255), (86, 72, 118, 255)
# Lava ramp, coolest crust → white-hot.
L0, L1, L2, L3, L4, L5 = (
    (70, 14, 10, 255),
    (128, 26, 12, 255),
    (186, 48, 14, 255),
    (232, 100, 22, 255),
    (255, 172, 48, 255),
    (255, 234, 150, 255),
)
IRON0, IRON1, IRON2 = (22, 20, 24, 255), (44, 42, 48, 255), (78, 74, 82, 255)
CHAR0, CHAR1, CHAR2 = (20, 13, 11, 255), (40, 26, 20, 255), (62, 40, 30, 255)

# Cave stone colours → basalt.
STONE = {
    (20, 14, 12, 255): B0,
    (11, 9, 8, 255): B0,
    (54, 44, 37, 255): B2,
    (58, 44, 36, 255): B2,
    (76, 62, 52, 255): B3,
    (98, 78, 62, 255): B4,
    (104, 86, 70, 255): B4,
    (120, 98, 78, 255): B5,
    (146, 122, 88, 255): B5,
    (170, 146, 108, 255): B5,
    (184, 160, 128, 255): B6,
    (196, 174, 136, 255): B6,
    (10, 10, 16, 255): (6, 5, 8, 255),
    (20, 14, 12, 110): (8, 4, 4, 120),
    (0, 0, 0, 110): (8, 4, 4, 120),
}


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def ramp(c, stops):
    """Map a colour onto `stops` by luminance (0..200 → first..last)."""
    t = max(0.0, min(1.0, lum(c) / 200))
    return stops[min(len(stops) - 1, int(t * len(stops)))]


def load(rel):
    im = Image.open(os.path.join(CAVE, rel)).convert("RGBA")
    return im.resize((N, N), Image.NEAREST)


def recolor(im, extra=None, fallback=None):
    """Swap cave stone for basalt; `extra` maps specific colours,
    `fallback(c)` handles anything left (default: keep)."""
    extra = extra or {}
    px = im.load()
    for y in range(N):
        for x in range(N):
            c = px[x, y]
            if c[3] == 0:
                continue
            if c in extra:
                px[x, y] = extra[c]
            elif c in STONE:
                px[x, y] = STONE[c]
            elif fallback:
                px[x, y] = fallback(c)
    return im


def blank():
    return Image.new("RGBA", (N, N), CLEAR)


def hash2(x, y, s=0):
    h = (x * 374761393 + y * 668265263 + s * 2246822519) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 0xFFFFFFFF


def vnoise(x, y, period, s=0):
    """Tileable value noise on a `period`-cell lattice over 32 px."""
    cell = N / period
    gx, gy = x / cell, y / cell
    x0, y0 = int(gx), int(gy)
    fx, fy = gx - x0, gy - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def v(i, j):
        return hash2(i % period, j % period, s)

    a = v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx
    b = v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx
    return a * (1 - fy) + b * fy


def lava_color(x, y):
    """Molten surface: crust plates over orange, bright hot seams.
    Tileable, so lava pools / chasms run seamlessly across cells."""
    n = 0.6 * vnoise(x, y, 4, 1) + 0.4 * vnoise(x, y, 8, 2)
    if n < 0.30:
        return L1
    if n < 0.40:
        return L2
    if n < 0.66:
        return L3
    if n < 0.78:
        return L4
    return L5 if hash2(x, y, 9) > 0.55 else L4


def paint_lava(im, mask):
    px = im.load()
    for y in range(N):
        for x in range(N):
            if mask(x, y, px[x, y]):
                px[x, y] = lava_color(x, y)
    return im


def flame(im, cx, base, h, w, seed=0):
    """Layered pixel flame: red rim → orange → yellow → white core."""
    px = im.load()
    rnd = random.Random(seed)
    layers = [(0.0, L2), (1.0, L3), (2.0, L4), (3.2, L5)]
    for inset, col in layers:
        for dy in range(h):
            t = dy / max(1, h - 1)  # 0 at base → 1 at tip
            half = (w / 2) * (math.sin(math.pi * (0.15 + 0.85 * (1 - t))) ** 0.7) * (1 - 0.55 * t)
            half -= inset * (0.6 + 0.4 * (1 - t))
            if half <= 0.2:
                continue
            sway = 1.2 * math.sin(t * 5 + seed) * t
            y = base - dy
            x0 = int(round(cx - half + sway))
            x1 = int(round(cx + half + sway))
            for x in range(x0, x1 + 1):
                if 0 <= x < N and 0 <= y < N:
                    px[x, y] = col
    # A few loose sparks above the tip.
    for _ in range(3):
        sx = cx + rnd.randint(-w // 2, w // 2)
        sy = base - h - rnd.randint(0, 4)
        if 0 <= sx < N and 0 <= sy < N:
            px[sx, sy] = L4 if rnd.random() < 0.6 else L3
    return im


def shadow(im, cx, cy, rx, ry):
    px = im.load()
    for y in range(N):
        for x in range(N):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 and px[x, y][3] == 0:
                px[x, y] = (8, 4, 4, 120)


def embers(im, count, seed, cols=(L4, L3, L2)):
    px = im.load()
    rnd = random.Random(seed)
    for _ in range(count):
        x, y = rnd.randrange(1, N - 1), rnd.randrange(1, N - 1)
        if px[x, y][3] == 0:
            continue
        px[x, y] = rnd.choice(cols)
    return im


DRAW_ART = "--draw-art" in sys.argv


def save(im, rel):
    if not DRAW_ART:
        return
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.resize((N * 2, N * 2), Image.NEAREST).save(path)


# Pit interior (the cave chasm's near-black) → lava.
PIT_DARK = (10, 10, 16, 255)


def char_wood(c):
    return ramp(c, [CHAR0, CHAR1, CHAR2, CHAR2])


def basalt_any(c):
    # Daylight in the exit opening stays bright; the rest goes basalt.
    if lum(c) > 205 or (c[2] > c[0] + 8):
        return c
    return ramp(c, [B0, B1, B2, B3, B4, B5, B6])


def build():
    tiles = []

    def add(id_, name, rel, group, **kw):
        t = {
            "boat": False,
            "id": f"volcanic_{id_}",
            "name": name,
            "walkable": kw.pop("walkable", False),
            "obstructs": kw.pop("obstructs", False),
            "locked": False,
            "light_source": kw.pop("light_source", False),
            "light_range": kw.pop("light_range", 0),
            "animation": kw.pop("animation", "none"),
            "counter": None,
            "encounter": None,
            "spawn": None,
            "sprite": f"{SPRITE_PREFIX}/{rel}",
            "tag": f"{TAG}:{group}",
        }
        t.update(kw)
        tiles.append(t)

    ASH = f"{SPRITE_PREFIX}/floors/floor_ash.png"

    # ── Floors ──────────────────────────────────────────────────────
    save(recolor(load("floors/floor_rock.png")), "floors/floor_basalt.png")
    add("floor_basalt", "Volcanic Floor, Basalt", "floors/floor_basalt.png", "floors", walkable=True)

    save(recolor(load("floors/floor_slab.png")), "floors/floor_slab.png")
    add("floor_slab", "Volcanic Floor, Slab", "floors/floor_slab.png", "floors", walkable=True)

    ash_map = {
        (76, 62, 52, 255): (40, 36, 38, 255),
        (54, 44, 37, 255): (30, 27, 30, 255),
        (104, 86, 70, 255): (72, 66, 66, 255),
    }
    save(recolor(load("floors/floor_dirt.png"), ash_map), "floors/floor_ash.png")
    add("floor_ash", "Volcanic Floor, Ash", "floors/floor_ash.png", "floors", walkable=True)

    save(embers(recolor(load("floors/floor_gravel.png")), 7, 11), "floors/floor_cinders.png")
    add("floor_cinders", "Volcanic Floor, Cinders", "floors/floor_cinders.png", "floors", walkable=True)

    # Cooling lava crust: the rock's plate seams glow.
    crust = load("floors/floor_rock.png")
    cp = crust.load()
    for y in range(N):
        for x in range(N):
            c = cp[x, y]
            if c == (20, 14, 12, 255):
                n = vnoise(x, y, 4, 7)
                cp[x, y] = L4 if n > 0.74 else L3 if n > 0.56 else L2 if n > 0.40 else L1
            else:
                cp[x, y] = {(104, 86, 70, 255): B4, (76, 62, 52, 255): B3, (54, 44, 37, 255): B2}.get(c, c)
    save(crust, "floors/floor_lava_cracks.png")
    add(
        "floor_lava_cracks", "Volcanic Floor, Glowing Crust", "floors/floor_lava_cracks.png",
        "floors", walkable=True, light_source=True, light_range=1,
        description="Cooling lava plates with molten seams. Walkable; gives off a faint glow.",
    )

    obs = recolor(
        load("floors/floor_slab.png"),
        fallback=None,
    )
    op = obs.load()
    for y in range(N):
        for x in range(N):
            c = op[x, y]
            if c[3] == 0:
                continue
            op[x, y] = ramp(c, [O0, O1, O1, O2, O2, O3])
    for i in range(6):  # glassy diagonal glints
        x, y = 4 + i * 5, 3 + (i * 11) % 26
        for k in range(3):
            if 0 <= x + k < N and 0 <= y - k < N:
                op[x + k, y - k] = O3
    save(obs, "floors/floor_obsidian.png")
    add("floor_obsidian", "Volcanic Floor, Obsidian", "floors/floor_obsidian.png", "floors", walkable=True)

    ember_floor = recolor(
        load("floors/floor_crystal.png"),
        {(220, 250, 255, 255): L5, (120, 220, 236, 255): L4, (60, 140, 170, 255): L2},
    )
    save(ember_floor, "floors/floor_embers.png")
    add("floor_embers", "Volcanic Floor, Embers", "floors/floor_embers.png", "floors", walkable=True)

    # ── Walls ───────────────────────────────────────────────────────
    for rel, id_, name in [
        ("walls/wall_top.png", "wall_top", "Volcanic Wall, Top"),
        ("walls/wall_left.png", "wall_left", "Volcanic Wall, Left"),
        ("walls/wall_right.png", "wall_right", "Volcanic Wall, Right"),
        ("walls/wall_corner_tl.png", "wall_corner_tl", "Volcanic Wall, Corner Top Left"),
        ("walls/wall_corner_tr.png", "wall_corner_tr", "Volcanic Wall, Corner Top Right"),
    ]:
        save(recolor(load(rel)), rel)
        add(id_, name, rel, "walls", obstructs=True)

    crack = recolor(load("walls/wall_crack.png"), {(150, 230, 110, 255): L4, (70, 150, 60, 255): L2})
    # Widen the glow: seam pixels next to the vein turn deep red.
    cpx = crack.load()
    hot = [(x, y) for y in range(N) for x in range(N) if cpx[x, y] in (L4, L2)]
    for x, y in hot:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if 0 <= x + dx < N and 0 <= y + dy < N and cpx[x + dx, y + dy] == B0:
                cpx[x + dx, y + dy] = L1
    save(crack, "walls/wall_magma_crack.png")
    add("wall_magma_crack", "Volcanic Wall, Magma Crack", "walls/wall_magma_crack.png", "walls",
        obstructs=True, light_source=True, light_range=2)

    vent = recolor(
        load("walls/wall_crystals.png"),
        {(220, 250, 255, 255): L5, (120, 220, 236, 255): L4, (60, 140, 170, 255): L2},
    )
    save(vent, "walls/wall_fire_vent.png")
    add("wall_fire_vent", "Volcanic Wall, Fire Vent", "walls/wall_fire_vent.png", "walls",
        obstructs=True, light_source=True, light_range=3, animation="fire",
        description="Flames jet from a fissure in the rock.")

    # Lava seep: a molten stream running down the wall face.
    seep = recolor(load("walls/wall_top.png"))
    spx = seep.load()
    for y in range(6, N):
        wob = int(round(1.2 * math.sin(y * 0.55)))
        width = 2 if y < 12 else 3
        for x in range(15 + wob - width // 2, 15 + wob - width // 2 + width + 1):
            spx[x, y] = lava_color(x, y) if y > 7 else L2
        spx[15 + wob - width // 2 - 1, y] = L1
        spx[15 + wob - width // 2 + width + 1, y] = L1
    save(seep, "walls/wall_lava_seep.png")
    add("wall_lava_seep", "Volcanic Wall, Lava Seep", "walls/wall_lava_seep.png", "walls",
        obstructs=True, light_source=True, light_range=2)

    save(recolor(load("walls/wall_exit.png"), fallback=basalt_any), "walls/wall_exit.png")
    add("wall_exit", "Volcanic Wall Opening, Way Out", "walls/wall_exit.png", "walls",
        walkable=True, light_source=True, light_range=3, animation="fire",
        description="A fire-lit archway leading out of the lava tubes — the way out of the dungeon. Placed by the generator as the bottom floor's exit.")

    # ── Doors & stairs ──────────────────────────────────────────────
    save(recolor(load("doors_and_stairs/wall_tunnel.png")), "doors_and_stairs/wall_tunnel.png")
    add("wall_tunnel", "Volcanic Wall, Tunnel", "doors_and_stairs/wall_tunnel.png", "doors & stairs",
        walkable=True, obstructs=True)

    port = recolor(
        load("doors_and_stairs/wall_portcullis.png"),
        {(84, 79, 86, 255): IRON1, (182, 172, 166, 255): L3},
    )
    save(port, "doors_and_stairs/wall_portcullis.png")
    add("wall_portcullis", "Volcanic Portcullis", "doors_and_stairs/wall_portcullis.png", "doors & stairs")

    door = recolor(
        load("doors_and_stairs/door.png"),
        {
            (140, 92, 52, 255): IRON1,
            (120, 78, 44, 255): IRON1,
            (70, 40, 22, 255): IRON0,
            (60, 60, 66, 255): L2,
            (230, 190, 90, 255): L4,
        },
    )
    save(door, "doors_and_stairs/door.png")
    add("door", "Volcanic Door, Scorched Iron", "doors_and_stairs/door.png", "doors & stairs",
        walkable=True, obstructs=True)

    for rel, id_, name in [
        ("doors_and_stairs/stairs.png", "stairs", "Volcanic Steps, Down"),
        ("doors_and_stairs/stairs_up.png", "stairs_up", "Volcanic Steps, Up"),
        ("doors_and_stairs/ladder_down.png", "ladder_down", "Volcanic Ladder, Down"),
        ("doors_and_stairs/ladder_up.png", "ladder_up", "Volcanic Ladder, Up"),
    ]:
        save(recolor(load(rel), fallback=char_wood), rel)
        add(id_, name, rel, "doors & stairs", walkable=True)

    # ── Lava & pits ─────────────────────────────────────────────────
    is_dark = lambda x, y, c: c == PIT_DARK
    for rel, id_, name in [
        ("water_and_pits/pit.png", "pit", "Lava Chasm"),
        ("water_and_pits/pit_centre.png", "pit_fill", "Lava Chasm, Fill"),
        ("water_and_pits/pit_top.png", "pit_top", "Lava Chasm, Top Edge"),
        ("water_and_pits/pit_bottom.png", "pit_bottom", "Lava Chasm, Bottom Edge"),
        ("water_and_pits/pit_left.png", "pit_left", "Lava Chasm, Left Edge"),
        ("water_and_pits/pit_right.png", "pit_right", "Lava Chasm, Right Edge"),
        ("water_and_pits/pit_corner_tl.png", "pit_corner_tl", "Lava Chasm, Corner Top Left"),
        ("water_and_pits/pit_corner_tr.png", "pit_corner_tr", "Lava Chasm, Corner Top Right"),
        ("water_and_pits/pit_corner_bl.png", "pit_corner_bl", "Lava Chasm, Corner Bottom Left"),
        ("water_and_pits/pit_corner_br.png", "pit_corner_br", "Lava Chasm, Corner Bottom Right"),
    ]:
        im = paint_lava(load(rel), is_dark)
        im = recolor(im)
        # Crust where lava meets rock.
        px = im.load()
        lava = {L1, L2, L3, L4, L5}
        for y in range(N):
            for x in range(N):
                if px[x, y] in lava:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < N and 0 <= ny < N and px[nx, ny] not in lava and px[nx, ny][3] > 0:
                            px[x, y] = L1
                            break
        out = rel.replace("water_and_pits/pit", "lava/lava_chasm")
        save(im, out)
        extra = {}
        if rel not in ("water_and_pits/pit.png", "water_and_pits/pit_centre.png"):
            extra["background_sprite"] = ASH
        add(id_, name, out, "lava & pits", light_source=True, light_range=2, **extra)

    # Solid rock: what the generator paints between tunnels (and behind
    # doors) — `volcanic_pit_centre` by convention. Chasm interiors use
    # `volcanic_pit_fill` (the lava) instead.
    rock = blank()
    rp = rock.load()
    rnd = random.Random(21)
    for y in range(N):
        for x in range(N):
            rp[x, y] = (14, 10, 11, 255)
    for _ in range(70):
        x, y = rnd.randrange(N), rnd.randrange(N)
        rp[x, y] = rnd.choice([(22, 16, 17, 255), (26, 19, 19, 255), (9, 6, 7, 255)])
    for _ in range(4):
        x, y = rnd.randrange(N), rnd.randrange(N)
        rp[x, y] = (70, 18, 10, 255)
    rock.resize((N * 2, N * 2), Image.NEAREST).save(os.path.join(OUT, "lava", "solid_rock.png")) if not os.path.exists(os.path.join(OUT, "lava", "solid_rock.png")) or DRAW_ART else None
    add("pit_centre", "Volcanic Solid Rock", "lava/solid_rock.png", "lava & pits",
        description="Unbroken basalt — what the generator paints between the tubes.")

    pool = paint_lava(blank(), lambda x, y, c: True)
    save(pool, "lava/lava_pool.png")
    add("lava_pool", "Lava Pool, Bubbling", "lava/lava_pool.png", "lava & pits",
        light_source=True, light_range=3, animation="fire",
        description="Open molten rock. Impassable; lights the tube around it.")

    # ── Features ────────────────────────────────────────────────────
    spire = load("features/stalagmite.png")
    sp = spire.load()
    for y in range(N):
        for x in range(N):
            c = sp[x, y]
            if c[3] == 255:
                sp[x, y] = ramp(c, [O0, O1, O2, O2, O3])
            elif c[3] > 0:
                sp[x, y] = (8, 4, 4, 120)
    save(spire, "features/obsidian_spire.png")
    add("obsidian_spire", "Obsidian Spire", "features/obsidian_spire.png", "features",
        obstructs=True, background_sprite=ASH)

    save(recolor(load("features/rubble.png")), "features/rubble.png")
    add("rubble", "Volcanic Rubble", "features/rubble.png", "features", background_sprite=ASH)

    throne = load("features/throne.png")
    tp = throne.load()
    for y in range(N):
        for x in range(N):
            c = tp[x, y]
            if c[3] == 0:
                continue
            if c in ((140, 28, 40, 255), (196, 52, 62, 255), (90, 16, 28, 255)):
                tp[x, y] = {(140, 28, 40, 255): L1, (196, 52, 62, 255): L2, (90, 16, 28, 255): L0}[c]
            elif c in ((226, 184, 72, 255), (150, 106, 36, 255), (255, 232, 140, 255)):
                tp[x, y] = {(226, 184, 72, 255): L3, (150, 106, 36, 255): L2, (255, 232, 140, 255): L5}[c]
            elif c[3] < 255:
                tp[x, y] = (8, 4, 4, 120)
            else:
                tp[x, y] = ramp(c, [O0, O1, O2, O3])
    save(throne, "features/throne.png")
    add("throne", "Obsidian Throne", "features/throne.png", "features", background_sprite=ASH)

    # Brazier: iron bowl on legs with a tall fire.
    br = blank()
    shadow(br, 16, 29, 9, 2)
    bp = br.load()
    for x in (10, 21):
        for y in range(22, 29):
            bp[x, y] = IRON0
    for x in range(11, 21):
        bp[x, 28] = IRON0
    for y in range(17, 23):
        half = 8 - (y - 17)
        for x in range(16 - half, 16 + half):
            bp[x, y] = IRON0 if x in (16 - half, 16 + half - 1) or y == 22 else (IRON2 if y == 17 else IRON1)
    for x in range(9, 23):
        bp[x, 17] = IRON2
        bp[x, 16] = L1
    flame(br, 16, 16, 14, 12, seed=3)
    save(br, "features/brazier.png")
    add("brazier", "Volcanic Brazier", "features/brazier.png", "features",
        obstructs=False, light_source=True, light_range=3, animation="fire", background_sprite=ASH)

    # Flame vent: a fissure in the floor with a jet of fire.
    fv = blank()
    shadow(fv, 16, 27, 8, 3)
    fp = fv.load()
    for x in range(9, 24):
        y = 27 + int(round(math.sin(x * 0.9)))
        fp[x, y] = B0
        fp[x, y - 1] = L1 if 11 <= x <= 21 else B1
    for x in range(12, 21):
        fp[x, 27] = L3 if (x % 3) else L4
    flame(fv, 16, 26, 20, 11, seed=8)
    save(fv, "features/flame_vent.png")
    add("flame_vent", "Flame Vent", "features/flame_vent.png", "features",
        light_source=True, light_range=3, animation="fire", background_sprite=ASH,
        description="A fissure venting fire. Impassable.")

    # Steam vent: a smaller fissure with a wisp (engine smoke anim).
    sv = blank()
    vp = sv.load()
    for x in range(11, 22):
        y = 22 + int(round(0.8 * math.sin(x * 1.3)))
        vp[x, y] = B0
        if 13 <= x <= 19:
            vp[x, y - 1] = L1
    for (x, y) in ((15, 19), (16, 18), (16, 17), (17, 16), (17, 15), (16, 14),
                   (15, 13), (15, 12), (16, 11), (17, 10), (17, 9), (16, 7)):
        vp[x, y] = (170, 160, 158, 190)
    for (x, y) in ((14, 16), (18, 13), (14, 10), (18, 8)):
        vp[x, y] = (120, 112, 112, 130)
    save(sv, "features/steam_vent.png")
    add("steam_vent", "Steam Vent", "features/steam_vent.png", "features",
        walkable=True, animation="smoke", background_sprite=ASH)

    return tiles


def main():
    tiles = build()
    with open(TILES_JSON) as f:
        data = json.load(f)
    ids = {t["id"] for t in tiles}
    kept = [t for t in data["map_tiles"] if t["id"] not in ids]
    data["map_tiles"] = kept + tiles
    with open(TILES_JSON, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(tiles)} volcanic tiles")


if __name__ == "__main__":
    main()
