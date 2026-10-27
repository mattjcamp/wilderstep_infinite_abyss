"""Split the town reference sheet into 64x64 tiles.

Usage: python3 split_town.py SHEET.png OUTDIR

Each entry crops a box from the sheet (source px), scales it so one
standard sheet tile (~85 px) becomes one 64 px game tile, snaps colours
to the sheet palette, and writes one PNG per 64x64 tile:

  ground  opaque, stretched to fill its footprint (grass, water, ...)
  object  teal becomes transparent so it sits on a ground tile; scaled
          uniformly (never enlarged) to fit its footprint, bottom-centred

Multi-tile objects are written as NAME_rRcC.png (row/col within the
footprint) and listed in manifest.json with their footprint.
"""
import json, os, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
TEAL = (0, 138, 128)
GOLD = (250, 200, 64)
CREAM = (255, 244, 214)
PAL = np.array([TEAL, GOLD, CREAM])
K = 64 / 85          # sheet px -> game px

G, O = "ground", "object"

# name, (x0, y0, x1, y1), kind, (cols, rows) footprint, label, flags
ITEMS = []


def add(name, box, kind, fp=(1, 1), label=None, **flags):
    ITEMS.append(dict(name=name, box=box, kind=kind, fp=fp,
                      label=label or name.replace("_", " ").title(), flags=flags))


WALK = dict(walkable=True, obstructs=False)
BLOCK = dict(walkable=False, obstructs=True)
LOW = dict(walkable=False, obstructs=False)          # blocks feet, not sight
WATER = dict(walkable=False, obstructs=False, water=True)

# ── Grass (4x4 grid, top-left). Row 0 tiles have a thin frame: inset.
gx = [(14, 96), (105, 187), (195, 277), (286, 368)]
gy = [(14, 96), (105, 187), (200, 278), (288, 362)]
n = 1
for r, (y0, y1) in enumerate(gy):
    for c, (x0, x1) in enumerate(gx):
        inset = 4 if (r == 0 or (r == 1 and c == 3)) else 0
        add(f"grass_{n:02d}", (x0 + inset, y0 + inset, x1 - inset, y1 - inset), G,
            label=f"Town Grass {n}", **WALK)
        n += 1

# ── Cobblestone (4x4 grid, top-middle). Gaps show the ground beneath.
bx0, by0, bw, bh = 381, 10, 94.25, 87.5
n = 1
for r in range(4):
    for c in range(4):
        x0 = int(bx0 + c * bw); y0 = int(by0 + r * bh)
        add(f"cobble_{n:02d}", (x0, y0, int(x0 + bw), int(y0 + bh)), O, stretch=True,
            label=f"Town Cobblestone {n}", **WALK)
        n += 1

# ── Walls, gates and fences (top-right block)
add("wall_stone_a", (776, 13, 958, 98), O, (2, 1), "Town Wall, Stone A", **BLOCK)
add("wall_stone_b", (983, 13, 1150, 98), O, (2, 1), "Town Wall, Stone B", **BLOCK)
add("wall_battlement", (776, 104, 891, 190), O, (1, 1), "Town Wall, Battlement", **BLOCK)
add("wall_archway", (895, 104, 1040, 190), O, (2, 1), "Town Wall, Archway", walkable=True, obstructs=True)
add("wall_low", (1042, 104, 1150, 190), O, (1, 1), "Town Wall, Low", **BLOCK)
add("fence_iron_a", (776, 199, 891, 272), O, (1, 1), "Town Fence, Iron A", **LOW)
add("fence_picket", (896, 199, 1040, 272), O, (2, 1), "Town Fence, Picket", **LOW)
add("fence_iron_b", (1042, 199, 1150, 272), O, (1, 1), "Town Fence, Iron B", **LOW)
add("wall_ruined", (776, 276, 891, 362), O, (1, 1), "Town Wall, Ruined", **BLOCK)
add("gate_portcullis", (894, 276, 1040, 364), O, (2, 1), "Town Gate, Portcullis", **LOW)
add("fence_iron_c", (1043, 276, 1150, 362), O, (1, 1), "Town Fence, Iron C", **LOW)

# ── Trees and plants
for i, x in enumerate((1187, 1298, 1410)):
    add(f"tree_large_{i+1}", (x, 12, x + 92, 132), O, (1, 1), f"Town Tree, Large {i+1}", **BLOCK)
add("tree_small_1", (1174, 140, 1241, 248), O, (1, 1), "Town Tree, Small 1", **BLOCK)
add("tree_small_2", (1260, 140, 1327, 248), O, (1, 1), "Town Tree, Small 2", **BLOCK)
add("flower_1", (1344, 156, 1384, 197), O, label="Town Flowers 1", **WALK)
add("flower_2", (1380, 125, 1426, 171), O, label="Town Flowers 2", **WALK)
add("flower_3", (1422, 155, 1465, 197), O, label="Town Flowers 3", **WALK)
add("flower_4", (1381, 173, 1424, 215), O, label="Town Flowers 4", **WALK)
add("bush_small", (1472, 132, 1526, 196), O, label="Town Bush, Small", **LOW)
add("bush_1", (1341, 206, 1388, 247), O, label="Town Bush 1", **LOW)
add("bush_2", (1419, 209, 1467, 247), O, label="Town Bush 2", **LOW)
add("bush_3", (1472, 206, 1525, 247), O, label="Town Bush 3", **LOW)

# ── Wooden fences + signpost
add("fence_rail_broken", (1171, 262, 1261, 310), O, label="Town Fence, Rail Broken", **LOW)
add("fence_rail", (1272, 262, 1363, 311), O, label="Town Fence, Rail", **LOW)
add("fence_rail_end", (1377, 262, 1467, 311), O, label="Town Fence, Rail End", **LOW)
add("fence_rail_low_broken", (1171, 320, 1263, 369), O, label="Town Fence, Low Broken", **LOW)
add("fence_rail_low", (1272, 320, 1364, 369), O, label="Town Fence, Low", **LOW)
add("fence_rail_gate", (1389, 319, 1468, 369), O, label="Town Fence, Gate", walkable=True, obstructs=False)
add("signpost", (1478, 259, 1526, 369), O, label="Town Signpost", **LOW)

# ── Houses
add("house_stone_1", (12, 377, 208, 587), O, (2, 2), "Town House, Stone 1", **BLOCK)
add("house_stone_2", (226, 377, 420, 587), O, (2, 2), "Town House, Stone 2", **BLOCK)
add("house_timber_1", (436, 373, 600, 587), O, (2, 2), "Town House, Timber 1", **BLOCK)
add("house_timber_shop", (614, 373, 802, 587), O, (2, 2), "Town House, Timber Shop", **BLOCK)
add("tower", (815, 374, 907, 588), O, (1, 2), "Town Tower", **BLOCK)

# ── Market
add("market_stall_1", (930, 384, 1072, 534), O, (2, 2), "Town Market Stall 1", **BLOCK)
add("market_stall_2", (1085, 384, 1228, 534), O, (2, 2), "Town Market Stall 2", **BLOCK)
add("notice_board", (1264, 384, 1350, 477), O, label="Town Notice Board", **LOW)
add("banner_pennant", (1366, 382, 1420, 478), O, label="Town Banner, Pennant", **LOW)
add("banner_double", (1435, 377, 1523, 476), O, label="Town Banner, Double", **LOW)
add("well", (1254, 491, 1360, 621), O, (1, 2), "Town Well", **LOW)
add("statue", (1401, 481, 1504, 618), O, (1, 2), "Town Statue", **BLOCK)
add("barrel_1", (930, 554, 992, 628), O, label="Town Barrel 1", **LOW)
add("barrel_2", (1006, 549, 1068, 621), O, label="Town Barrel 2", **LOW)
add("barrel_small", (1180, 545, 1229, 600), O, label="Town Barrel, Small", **LOW)
add("trough", (1085, 553, 1170, 607), O, label="Town Trough", **LOW)

# ── Roofs and walls for building your own houses (2 tiles wide)
add("roof_flat", (13, 603, 162, 684), O, (2, 1), "Town Roof, Flat", **BLOCK)
add("roof_gable", (161, 603, 323, 684), O, (2, 1), "Town Roof, Gable", **BLOCK)
add("house_wall_brick", (13, 693, 162, 782), O, (2, 1), "Town House Wall, Brick", **BLOCK)
add("house_wall_gable", (161, 693, 323, 782), O, (2, 1), "Town House Wall, Gable", **BLOCK)
add("roof_peak_1", (339, 601, 490, 683), O, (2, 1), "Town Roof, Peak 1", **BLOCK)
add("roof_peak_2", (495, 598, 642, 683), O, (2, 1), "Town Roof, Peak 2", **BLOCK)
add("house_wall_door", (338, 692, 490, 782), O, (2, 1), "Town House Wall, Door", walkable=True, obstructs=True)
add("house_wall_plain", (495, 692, 642, 782), O, (2, 1), "Town House Wall, Plain", **BLOCK)
add("tower_small", (666, 623, 736, 782), O, (1, 2), "Town Tower, Small", **BLOCK)
add("chapel", (753, 591, 917, 782), O, (2, 2), "Town Chapel", **BLOCK)

# ── Props
add("crate", (930, 645, 1005, 712), O, label="Town Crate", **LOW)
add("crates_double", (1018, 636, 1131, 702), O, label="Town Crates, Double", **LOW)
add("cart", (1156, 622, 1293, 704), O, (2, 1), "Town Cart", **LOW)
add("workbench", (1323, 634, 1443, 714), O, label="Town Workbench", **LOW)
add("lamp_post", (1463, 626, 1526, 789), O, (1, 2), "Town Lamp Post", walkable=False, obstructs=False, light_source=True, light_range=4)
add("bench_1", (931, 728, 1034, 791), O, label="Town Bench 1", **LOW)
add("bench_2", (1054, 729, 1144, 791), O, label="Town Bench 2", **LOW)
add("flower_pot_1", (1169, 710, 1232, 794), O, label="Town Flower Pot 1", **LOW)
add("flower_pot_2", (1265, 718, 1325, 794), O, label="Town Flower Pot 2", **LOW)
add("flower_box", (1349, 717, 1433, 794), O, label="Town Flower Box", **LOW)

# ── Bridge, water, dock
add("bridge_arch", (11, 798, 171, 871), O, (2, 1), "Town Bridge, Arch", walkable=True, obstructs=False, boat_passable=True)
add("bridge_rail", (180, 797, 318, 871), O, (2, 1), "Town Bridge, Rail", **LOW)
add("water_1", (20, 882, 164, 1000), G, label="Town Water 1", **WATER)
add("water_2", (188, 882, 312, 1000), G, label="Town Water 2", **WATER)
add("dock_gate", (328, 810, 456, 1008), O, (1, 2), "Town Dock Gate", **LOW)
add("pond", (459, 797, 671, 1007), G, (2, 2), "Town Pond", **WATER)

# ── Paths and plazas (bottom right): cut on a regular grid
add("path_1", (674, 798, 799, 885), O, (2, 1), "Town Path 1", stretch=True, **WALK)
add("path_2", (797, 798, 940, 885), O, (2, 1), "Town Path 2", stretch=True, **WALK)
add("path_3", (939, 798, 1080, 885), O, (2, 1), "Town Path 3", stretch=True, **WALK)
add("path_4", (1086, 798, 1158, 884), O, label="Town Path 4", stretch=True, **WALK)
add("path_corner", (676, 886, 970, 1007), O, (3, 1), "Town Path Corner", stretch=True, **WALK)
add("path_bend", (966, 886, 1082, 1007), O, (1, 1), "Town Path Bend", stretch=True, **WALK)
add("path_shore", (1086, 885, 1158, 1007), O, (1, 1), "Town Path Shore", stretch=True, **WALK)
add("plaza", (1169, 800, 1525, 1005), O, (4, 2), "Town Plaza", stretch=True, **WALK)


def snap(img, transparent):
    a = np.asarray(img.convert("RGB")).astype(int)
    d = ((a[:, :, None, :] - PAL[None, None]) ** 2).sum(-1)
    idx = d.argmin(-1)
    rgb = PAL[idx].astype(np.uint8)
    alpha = np.where((idx == 0) & transparent, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def main():
    sheet = Image.open(SRC).convert("RGB")
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for it in ITEMS:
        x0, y0, x1, y1 = it["box"]
        crop = sheet.crop((x0, y0, x1, y1))
        cols, rows = it["fp"]
        W, H = cols * 64, rows * 64
        if it["kind"] == G or it["flags"].pop("stretch", False):
            big = snap(crop.resize((W, H), Image.BOX), it["kind"] == O)
        else:
            s = min(K, W / crop.width, H / crop.height)
            w, h = max(1, round(crop.width * s)), max(1, round(crop.height * s))
            small = snap(crop.resize((w, h), Image.BOX), True)
            big = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            big.alpha_composite(small, ((W - w) // 2, H - h))
        parts = []
        for r in range(rows):
            for c in range(cols):
                tile = big.crop((c * 64, r * 64, c * 64 + 64, r * 64 + 64))
                if tile.getbbox() is None:
                    continue
                fname = it["name"] if cols * rows == 1 else f"{it['name']}_r{r}c{c}"
                tile.save(os.path.join(OUT, fname + ".png"))
                parts.append({"file": fname, "row": r, "col": c})
        manifest.append({"name": it["name"], "label": it["label"], "kind": it["kind"],
                         "footprint": [cols, rows], "flags": it["flags"], "parts": parts})
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(len(manifest), "items,", sum(len(m["parts"]) for m in manifest), "tiles ->", OUT)


main()
