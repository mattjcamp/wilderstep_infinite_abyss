"""Convert an old-style town map to the new Town tile set.

Usage: python3 convert_town.py MODULES_DIR SRC_MAP_ID NEW_MAP_ID "New name"

Reads <MODULES_DIR>/default/map_tiles.json (palette) and the module's
maps.json holding SRC_MAP_ID, writes a converted COPY as NEW_MAP_ID into
the same maps.json (the original map is left untouched).

  * wall blocks with a door link  -> a 2x2 town building whose door
    tile sits on the original door cell (link + walkability kept)
  * wall blocks without a door    -> wooden rail fences (plank) or
    stone walls, using horizontal, vertical, end and corner pieces
    chosen from each cell's neighbours
  * map border                    -> a stone town wall all the way
    round (corners at the ends, a portcullis on any exit)
  * tree / water / floor / sign   -> town tree / town water /
    cobblestone / signpost
Every cell keeps its gameplay fields (link, text, counter, npc, item,
quest, dungeon, encounter, spawn, trap...).
"""
import copy, glob, json, os, sys
from collections import deque

MODS, SRC_ID, NEW_ID, NEW_NAME = sys.argv[1:5]

PALETTE = {t["id"]: t for t in json.load(open(os.path.join(MODS, "default", "map_tiles.json")))["map_tiles"]}
KEEP = ("link", "text", "counter", "npc", "item", "quest", "dungeon", "encounter",
        "spawn", "trap", "trap_id", "show_link_placard", "pressure_plate", "locked", "lock_type")
WALLS = {"wall_planks_dark", "wall_stone", "door"}


def find_map():
    for f in glob.glob(os.path.join(MODS, "*", "maps.json")):
        d = json.load(open(f))
        maps = d if isinstance(d, list) else next(v for v in d.values() if isinstance(v, list))
        for m in maps:
            if m.get("id") == SRC_ID:
                return f, d, maps, m
    sys.exit(f"map {SRC_ID} not found")


def tile(pid, orig=None, keep_walk=False):
    """New cell from palette tile `pid`, carrying gameplay fields over."""
    cell = copy.deepcopy(PALETTE[pid])
    if orig:
        for k in KEEP:
            if orig.get(k) not in (None, "", False):
                cell[k] = copy.deepcopy(orig[k])
        if keep_walk:
            cell["walkable"] = orig.get("walkable", cell["walkable"])
            cell["obstructs"] = orig.get("obstructs", cell["obstructs"])
    return cell


def run_piece(cells, x, y, style):
    """Fence/wall piece for (x, y) from which neighbours are in the run."""
    n, s_, e, w = ((x, y - 1) in cells, (x, y + 1) in cells,
                   (x + 1, y) in cells, (x - 1, y) in cells)
    horiz = "town_fence_rail" if style == "fence" else "town_wall_low"
    pre = "town_fence_rail" if style == "fence" else "town_wall"
    vertical = n or s_
    sideways = e or w
    if vertical and sideways:
        if (e and w) or (n and s_):          # T or cross: keep the dominant run
            return horiz if (e and w) else f"{pre}_v"
        return f"{pre}_corner_" + ("t" if s_ else "b") + ("l" if e else "r")
    if vertical:
        if n and s_:
            return f"{pre}_v"
        return f"{pre}_v_top" if s_ else f"{pre}_v_bottom"
    return horiz


def building_kind(link_map, material):
    n = (link_map or "").lower()
    if "town_hall" in n:
        return "chapel"
    if "shrine" in n:
        return "house_stone_1"
    if any(k in n for k in ("armory", "inn", "dive", "shop", "tavern")):
        return "house_timber_shop"
    if "stone_house" in n:
        return "house_stone_1"
    if "wood_house" in n:
        return "house_stone_1" if material == "stone" else "house_timber_shop"
    return "house_stone_1" if material == "stone" else "house_timber_shop"


def main():
    f, data, maps, src = find_map()
    m = copy.deepcopy(src)
    m["id"], m["name"] = NEW_ID, NEW_NAME
    m["tags"] = list(dict.fromkeys((m.get("tags") or []) + ["new town style"]))
    g = m["grid"]
    H, W = len(g), len(g[0])
    orig = copy.deepcopy(g)
    grass = lambda o=None: tile("grass", o)
    border = lambda x, y: x in (0, W - 1) or y in (0, H - 1)
    report = {"buildings": [], "fences": 0, "walls": 0}

    # 1) wall components (not the border)
    seen = set()
    for y in range(H):
        for x in range(W):
            if (x, y) in seen or border(x, y) or orig[y][x].get("id") not in WALLS:
                continue
            comp, q = [], deque([(x, y)])
            seen.add((x, y))
            while q:
                cx, cy = q.popleft()
                comp.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen \
                            and not border(nx, ny) and orig[ny][nx].get("id") in WALLS:
                        seen.add((nx, ny)); q.append((nx, ny))
            ids = [orig[cy][cx]["id"] for cx, cy in comp]
            material = "stone" if ids.count("wall_stone") > ids.count("wall_planks_dark") else "wood"
            doors = [(cx, cy) for cx, cy in comp if orig[cy][cx].get("link")]
            if not doors:
                cs = set(comp)
                for cx, cy in comp:
                    piece = run_piece(cs, cx, cy, "fence" if material == "wood" else "wall")
                    g[cy][cx] = tile(piece, orig[cy][cx])
                    report["fences" if material == "wood" else "walls"] += 1
                continue
            for cx, cy in comp:                       # clear the old block
                g[cy][cx] = grass(None)
            # one building per door; the door row is the building's bottom row
            for lx, ly in doors:
                kind = building_kind(orig[ly][lx]["link"].get("map_id"), material)
                xs = [cx for cx, cy in comp]
                c0 = lx if lx + 1 <= max(xs) else lx - 1      # building cols c0, c0+1
                door_col = lx - c0                            # 0 = left, 1 = right
                for r in (0, 1):
                    for c in (0, 1):
                        X, Y = c0 + c, ly - 1 + r
                        if not (0 <= X < W and 0 <= Y < H) or border(X, Y):
                            continue
                        pid = f"town_{kind}_r{r}c{c}"
                        if r == 1 and c == door_col:
                            g[Y][X] = tile(pid, orig[ly][lx], keep_walk=True)
                        else:
                            g[Y][X] = tile(pid, orig[Y][X] if orig[Y][X].get("id") not in WALLS else None)
                report["buildings"].append((orig[ly][lx]["link"].get("map_id"), kind, (lx, ly)))

    # 2) single-cell features
    trees = ["town_tree_large_1", "town_tree_large_2", "town_tree_large_3", "town_tree_small_1", "town_tree_small_2"]
    for y in range(H):
        for x in range(W):
            o = orig[y][x]; oid = o.get("id")
            if border(x, y) or g[y][x] is not o and g[y][x].get("id") != oid:
                continue
            if oid == "tree":
                g[y][x] = tile(trees[(x * 7 + y * 3) % len(trees)], o)
            elif oid == "water":
                g[y][x] = tile("town_water_1" if (x + y) % 2 else "town_water_2", o, keep_walk=bool(o.get("link")))
            elif oid == "floor":
                g[y][x] = tile("town_cobble_02", o)
            elif oid == "counter":
                g[y][x] = tile("object_signpost", o, keep_walk=True)

    # 3) border: walls top/bottom (gate on exits), trees down the sides
    for y in (0, H - 1):
        x = 0
        while x < W:
            o = orig[y][x]
            if o.get("id") == "door" or o.get("link"):
                g[y][x] = tile("town_gate_portcullis_r0c0", o, keep_walk=True)
                if x + 1 < W:
                    g[y][x + 1] = tile("town_gate_portcullis_r0c1", orig[y][x + 1])
                x += 2
                continue
            if x + 1 < W and not (orig[y][x + 1].get("id") == "door" or orig[y][x + 1].get("link")):
                part = "a" if (x // 2) % 2 == 0 else "b"
                g[y][x] = tile(f"town_wall_stone_{part}_r0c0", o)
                g[y][x + 1] = tile(f"town_wall_stone_{part}_r0c1", orig[y][x + 1])
                x += 2
            else:
                g[y][x] = tile("town_wall_low", o)
                x += 1
    for y in range(1, H - 1):
        for x in (0, W - 1):
            o = orig[y][x]
            if o.get("id") in ("water",) or o.get("link"):
                continue
            g[y][x] = tile("town_wall_v", o)
    for (x, y), part in (((0, 0), "tl"), ((W - 1, 0), "tr"), ((0, H - 1), "bl"), ((W - 1, H - 1), "br")):
        if not orig[y][x].get("link"):
            g[y][x] = tile(f"town_wall_corner_{part}", orig[y][x])
    # a side wall that is cut by water or a link gets proper end pieces
    for x in (0, W - 1):
        for y in range(1, H - 1):
            if g[y][x].get("id") != "town_wall_v":
                continue
            up = g[y - 1][x].get("id", "").startswith("town_wall")
            down = g[y + 1][x].get("id", "").startswith("town_wall")
            if not up:
                g[y][x] = tile("town_wall_v_top", orig[y][x])
            elif not down:
                g[y][x] = tile("town_wall_v_bottom", orig[y][x])

    maps[:] = [mm for mm in maps if mm.get("id") != NEW_ID]
    maps.insert(maps.index(src) + 1, m)
    with open(f, "w") as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {NEW_ID} into {f}")
    print(f"{len(report['buildings'])} buildings, {report['fences']} fence cells, {report['walls']} wall cells")
    for b in report["buildings"]:
        print("  ", b)


main()
