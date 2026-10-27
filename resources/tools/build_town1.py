"""Lay out town_1 with the Town tile set.

Usage: python3 build_town1.py MODULES_DIR

Rewrites the grid of default/maps.json -> town_1 (20x20). Arrival
points used by other maps are kept walkable:
  overview_1 / overview_island -> (9, 19)  the south gate
  shop_4                       -> (15, 6)  street below the shop door
  dungeon_1                    -> (4, 6)   street below the tower door
"""
import copy, json, os, sys

MODS = sys.argv[1]
PAL = {t["id"]: t for t in json.load(open(os.path.join(MODS, "default", "map_tiles.json")))["map_tiles"]}
W, H = 20, 20


def cell(pid, **over):
    c = copy.deepcopy(PAL[pid])
    c.update(over)
    return c


grid = [[cell("grass") for _ in range(W)] for _ in range(H)]


def put(x, y, pid, **over):
    grid[y][x] = cell(pid, **over)


def piece(x, y, name, cols, rows, door=None, **door_over):
    """Multi-tile town piece with its top-left at (x, y). `door` =
    (col, row) inside the piece that gets door_over (link etc.)."""
    for r in range(rows):
        for c in range(cols):
            over = door_over if door == (c, r) else {}
            put(x + c, y + r, f"town_{name}_r{r}c{c}", **over)


def road(x0, y0, x1, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, "town_cobble_01" if (x + y) % 2 else "town_cobble_02")


# ── Streets ──────────────────────────────────────────────────────
road(1, 6, 18, 6)          # north street (shop + tower doors open onto it)
road(9, 7, 10, 18)         # main street from the gate
road(1, 14, 18, 14)        # south street (houses)
road(8, 9, 11, 10)         # plaza across the main street

# ── Wall around the town, gate at the south ──────────────────────
put(0, 0, "town_wall_corner_tl"); put(W - 1, 0, "town_wall_corner_tr")
put(0, H - 1, "town_wall_corner_bl"); put(W - 1, H - 1, "town_wall_corner_br")
for y in range(1, H - 1):
    put(0, y, "town_wall_v"); put(W - 1, y, "town_wall_v")
for y in (0, H - 1):
    x = 1
    while x < W - 1:
        if y == H - 1 and x == 9:
            gate = dict(walkable=True, obstructs=False,
                        link={"map_id": "overview_1", "x": 3, "y": 12})
            put(9, y, "town_gate_portcullis_r0c0", **gate)
            put(10, y, "town_gate_portcullis_r0c1", **gate)
            x = 11
            continue
        if x + 1 < W - 1:
            part = "a" if (x // 2) % 2 else "b"
            put(x, y, f"town_wall_stone_{part}_r0c0"); put(x + 1, y, f"town_wall_stone_{part}_r0c1")
            x += 2
        else:
            put(x, y, "town_wall_low"); x += 1

# ── North row: tower (dungeon), houses, chapel, shop ─────────────
piece(4, 4, "tower", 1, 2, door=(0, 1), walkable=True, obstructs=True,
      link={"map_id": "dungeon_1", "x": 7, "y": 10})
put(3, 5, "object_signpost", text="The Old Tower — beware what lies below.")
piece(6, 4, "house_stone_1", 2, 2)
piece(9, 1, "chapel", 2, 2)
piece(12, 4, "house_timber_shop", 2, 2)
piece(15, 4, "house_timber_shop", 2, 2, door=(0, 1), walkable=True, obstructs=True,
      link={"map_id": "shop_4", "x": 1, "y": 6})
put(17, 5, "object_signpost", text="General Store")
# north greenery
for x, y, t in ((1, 1, "tree_large_1"), (2, 2, "tree_small_1"), (3, 1, "tree_large_2"),
                (6, 1, "tree_small_2"), (13, 1, "tree_large_3"), (16, 1, "tree_large_1"),
                (18, 2, "tree_small_1"), (17, 2, "tree_small_2")):
    put(x, y, f"town_{t}")
for x, y in ((7, 2), (12, 2)):
    put(x, y, "town_flower_1")
put(8, 2, "town_bush_1"); put(11, 2, "town_bush_2")

# ── Market around the plaza ──────────────────────────────────────
piece(2, 8, "market_stall_1", 2, 2)
piece(15, 8, "market_stall_2", 2, 2)
put(4, 9, "object_barrel_1"); put(1, 9, "object_crate"); put(5, 9, "object_barrel_small")
put(17, 9, "object_crates_double"); put(14, 9, "object_barrel_2")
piece(12, 9, "well", 1, 2)
piece(7, 9, "statue", 1, 2)
put(8, 11, "object_bench_1"); put(11, 11, "object_bench_2")
put(6, 11, "town_flower_2"); put(13, 11, "town_flower_3")

# ── South row of houses ──────────────────────────────────────────
piece(2, 12, "house_stone_1", 2, 2)
piece(5, 12, "house_timber_shop", 2, 2)
piece(12, 12, "house_stone_1", 2, 2)
piece(15, 12, "house_timber_shop", 2, 2)
put(17, 13, "object_flower_box"); put(14, 13, "object_flower_pot_1"); put(4, 13, "object_flower_pot_2")

# ── Fenced garden (south-west) ───────────────────────────────────
put(1, 15, "town_fence_rail_corner_tl")
for x in range(2, 6):
    put(x, 15, "town_fence_rail")
put(6, 15, "town_fence_rail_corner_tr")
for y in (16, 17):
    put(1, y, "town_fence_rail_v"); put(6, y, "town_fence_rail_v")
put(1, 18, "town_fence_rail_corner_bl")
put(2, 18, "town_fence_rail"); put(3, 18, "town_fence_rail_gate")
put(4, 18, "town_fence_rail"); put(5, 18, "town_fence_rail")
put(6, 18, "town_fence_rail_corner_br")
for x, y, f in ((2, 16, 1), (3, 16, 2), (4, 16, 3), (5, 16, 4), (2, 17, 3), (4, 17, 1), (5, 17, 2)):
    put(x, y, f"town_flower_{f}")
put(3, 17, "town_bush_small")

# ── Pond with a bridge (south-east) ──────────────────────────────
piece(14, 16, "pond", 2, 2)
for x, y in ((16, 16), (16, 17), (13, 16), (13, 17)):
    put(x, y, "town_water_1" if (x + y) % 2 else "town_water_2")
put(13, 15, "town_bush_2"); put(14, 15, "town_flower_2")
put(17, 16, "town_tree_large_2"); put(18, 17, "town_tree_small_2"); put(17, 18, "town_bush_3")
put(12, 17, "town_bush_1"); put(15, 15, "town_flower_4")

# ── Gate approach: lamps, welcome sign ───────────────────────────
for x in (8, 11):
    put(x, 16, "object_lamp_post_r0c0"); put(x, 17, "object_lamp_post_r1c0")
put(11, 18, "object_signpost", text="Welcome to town!")
put(8, 18, "town_flower_1")
put(7, 7, "object_notice_board", text="Notices: the old tower has been sealed for your safety.")
put(12, 7, "object_banner_double"); put(6, 7, "object_banner_pennant")

# keep the arrival cells clear
for x, y in ((15, 6), (4, 6)):
    assert grid[y][x]["walkable"], (x, y, grid[y][x]["id"])

path = os.path.join(MODS, "default", "maps.json")
data = json.load(open(path))
maps = data if isinstance(data, list) else next(v for v in data.values() if isinstance(v, list))
m = next(mm for mm in maps if mm["id"] == "town_1")
m["width"], m["height"], m["grid"] = W, H, grid
with open(path, "w") as fh:
    fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print("town_1 rebuilt", W, "x", H)
