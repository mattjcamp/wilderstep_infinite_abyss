"""Recolour the town tiles from their teal/gold originals.

Usage: python3 recolor_town.py SRC_DIR OUT_DIR [scheme]

SRC_DIR holds the original tiles + manifest.json (from split_town.py).
Each piece keeps three colours (dark / main / light) but they are picked
per kind of piece, and buildings use a roof colour above their roofline
and a wall colour below it. Small see-through gaps inside a piece
(mortar, plank gaps, windows) become its dark colour; real openings
(between fence pickets, under arches) stay transparent. Water uses the
Overview water's blue waves on transparent.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
SCHEME = sys.argv[3] if len(sys.argv) > 3 else "classic"

GOLD = (250, 200, 64)
CREAM = (255, 244, 214)
TEAL = (0, 138, 128)

# dark, main, light
STONE = [(52, 48, 46), (160, 154, 142), (222, 216, 204)]
COBBLE = [(58, 54, 50), (140, 136, 126), (200, 196, 186)]
DIRT = [(84, 62, 40), (186, 156, 108), (226, 204, 160)]
WOOD = [(58, 36, 20), (146, 98, 56), (212, 170, 110)]
LEAF = [(22, 50, 28), (66, 132, 60), (140, 196, 86)]
TRUNK = [(40, 26, 16), (108, 72, 44), (150, 108, 70)]
PETAL = [(40, 80, 36), (232, 112, 150), (255, 236, 200)]
POT = [(70, 36, 22), (182, 96, 60), (226, 150, 110)]
AWNING = [(90, 20, 20), (196, 56, 48), (250, 238, 218)]
BANNER = [(70, 14, 20), (176, 38, 48), (236, 196, 96)]
IRON = [(18, 18, 24), (66, 68, 80), (255, 214, 120)]     # light = lamp glow
BRICK = [(64, 28, 22), (166, 80, 58), (214, 150, 120)]
WATER = [None, (0, 119, 255), (110, 176, 255)]           # dark unused: transparent

SCHEMES = {
    # roof, wall (stone houses), plaster (timber houses)
    "classic": {"roof": [(70, 24, 18), (168, 64, 48), (220, 120, 92)],
                "wall": STONE,
                "plaster": [(70, 46, 30), (226, 210, 172), (250, 240, 214)]},
    "slate": {"roof": [(30, 34, 46), (84, 96, 120), (150, 164, 188)],
              "wall": [(60, 50, 40), (184, 168, 140), (230, 218, 190)],
              "plaster": [(54, 40, 32), (214, 200, 168), (244, 236, 214)]},
    "thatch": {"roof": [(80, 56, 20), (196, 160, 84), (236, 210, 140)],
               "wall": [(66, 58, 50), (210, 202, 186), (244, 240, 230)],
               "plaster": [(76, 52, 34), (236, 226, 204), (252, 248, 236)]},
}
S = SCHEMES[SCHEME]

# name -> (palette above split, palette below split, split fraction of height)
def plan(name):
    roof, wall, plaster = S["roof"], S["wall"], S["plaster"]
    if name.startswith("water"):
        return ("water", WATER, None, None)
    if name == "pond":
        return ("pond", WATER, None, None)
    if name.startswith("cobble") or name == "plaza":
        return ("solid", COBBLE, None, None)
    if name.startswith("path"):
        return ("solid", DIRT, None, None)
    if name.startswith("tree"):
        return ("obj", LEAF, TRUNK, 0.74)
    if name == "bush_small":
        return ("obj", LEAF, TRUNK, 0.80)
    if name.startswith("bush"):
        return ("obj", LEAF, None, None)
    if name.startswith("flower_pot") or name == "flower_box":
        return ("obj", PETAL, POT, 0.55)
    if name.startswith("flower"):
        return ("obj", PETAL, None, None)
    if name.startswith("house_stone"):
        return ("obj", roof, wall, 0.52)
    if name.startswith("house_timber"):
        return ("obj", roof, plaster, 0.48)
    if name == "chapel":
        return ("obj", roof, wall, 0.42)
    if name == "tower":
        return ("obj", roof, wall, 0.33)
    if name == "tower_small":
        return ("obj", roof, wall, 0.24)
    if name.startswith("roof"):
        return ("obj", roof, None, None)
    if name in ("house_wall_brick", "house_wall_gable"):
        return ("obj", BRICK, None, None)
    if name.startswith("house_wall"):
        return ("obj", plaster, None, None)
    if name.startswith("market_stall"):
        return ("obj", AWNING, WOOD, 0.42)
    if name.startswith("banner"):
        return ("obj", BANNER, None, None)
    if name == "lamp_post":
        return ("obj", IRON, None, None)
    if name.startswith(("fence_picket", "fence_rail", "signpost", "notice", "barrel",
                        "crate", "cart", "workbench", "bench", "trough", "dock")):
        return ("obj", WOOD, None, None)
    # walls, gates, iron fences, bridge, well, statue
    return ("obj", STONE, None, None)


def classify(a):
    """Index image: 0 teal/clear, 1 gold, 2 cream (from snapped originals)."""
    rgb = a[:, :, :3].astype(int)
    idx = np.zeros(a.shape[:2], np.uint8)
    idx[(np.abs(rgb - GOLD).sum(-1) < 60)] = 1
    idx[(np.abs(rgb - CREAM).sum(-1) < 60)] = 2
    idx[a[:, :, 3] == 0] = 0
    return idx


def inner_gaps(solid):
    """Clear pixels enclosed by the piece once 1-2 px gaps are bridged."""
    closed = ndimage.binary_closing(solid, structure=np.ones((5, 5)), iterations=1)
    return ndimage.binary_fill_holes(closed) & ~solid


def recolor(big, name):
    kind, top, bottom, split = plan(name)
    a = np.array(big)
    idx = classify(a)
    H, W = idx.shape
    out = np.zeros((H, W, 4), np.uint8)
    gold, cream = idx == 1, idx == 2
    if kind == "water":
        out[gold] = WATER[1] + (255,)
        out[cream] = WATER[2] + (255,)
        return out
    if kind == "pond":
        dens = ndimage.uniform_filter(gold.astype(float), size=7)
        bank = gold & (dens > 0.55)
        wave = gold & ~bank
        out[wave] = WATER[1] + (255,)
        out[cream] = WATER[2] + (255,)
        out[bank] = DIRT[1] + (255,)
        edge = ndimage.binary_dilation(bank, iterations=1) & ~bank & ~gold
        out[edge] = DIRT[0] + (255,)
        return out
    solid = gold | cream
    gaps = inner_gaps(solid)
    ys = np.arange(H)[:, None] * np.ones((1, W))
    if split is not None:
        rows = np.where(solid.any(1))[0]
        y0, y1 = (rows[0], rows[-1]) if len(rows) else (0, H)
        cut = y0 + split * (y1 - y0)
        upper = ys < cut
    else:
        upper = np.ones((H, W), bool)
    for region, pal in ((upper, top), (~upper, bottom or top)):
        out[gold & region] = pal[1] + (255,)
        out[cream & region] = pal[2] + (255,)
        out[gaps & region] = pal[0] + (255,)
    return out


# Town tiles that were moved to the Objects sprite folder
# (town_<file> -> "objects/<new>.png"); they are written there instead.
_MOVED_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_moved_to_objects.json")
MOVED = {}
if os.path.exists(_MOVED_JSON):
    for old_id, new_sprite in json.load(open(_MOVED_JSON)).items():
        MOVED[old_id[len("town_"):]] = new_sprite


def out_path(file):
    if file in MOVED:
        # OUT is the town sprite folder; objects/ sits beside it.
        path = os.path.join(OUT, "..", MOVED[file])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path
    return os.path.join(OUT, file + ".png")


def main():
    man = json.load(open(os.path.join(SRC, "manifest.json")))
    os.makedirs(OUT, exist_ok=True)
    n = 0
    for it in man:
        cols, rows = it["footprint"]
        parts = [p for p in it["parts"] if os.path.exists(os.path.join(SRC, p["file"] + ".png"))]
        # grass and the sheet's paths were removed (paths are now
        # path_straight_* / path_bend_* from make_path_corners.py, and the
        # plaza became brick_path_* from make_brick_path.py)
        if not parts or it["name"].startswith(("grass", "path", "plaza", "house_wall", "roof", "cobble", "fence",
                                               "wall_stone", "wall_battlement", "wall_low", "wall_ruined", "wall_v", "wall_corner",
                                               "wall_archway", "gate_portcullis")) \
                or it["name"] in ("house_stone_2", "house_timber_1", "market_stall_1", "market_stall_2",
                                   "tree_large_2", "tree_large_3", "tree_small_2"):
            continue
        big = Image.new("RGBA", (cols * 64, rows * 64), (0, 0, 0, 0))
        for p in parts:
            big.alpha_composite(Image.open(os.path.join(SRC, p["file"] + ".png")).convert("RGBA"),
                                (p["col"] * 64, p["row"] * 64))
        rec = Image.fromarray(recolor(big, it["name"]))
        for p in parts:
            tile = rec.crop((p["col"] * 64, p["row"] * 64, p["col"] * 64 + 64, p["row"] * 64 + 64))
            tile.save(out_path(p["file"]))
            n += 1
    print(n, "tiles recoloured ->", OUT, f"({SCHEME})")


if __name__ == "__main__":
    main()
