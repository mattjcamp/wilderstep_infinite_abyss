#!/usr/bin/env python3
"""Turn large hand-/AI-drawn map-feature art into game-ready 32x32 tiles.

Map sprites in the game are 32x32 RGBA tiles on a transparent background
(see web/public/sprites/map). Source art here is a big illustration on a
solid (near-)black background — e.g. the dungeon-entrance renders. Per
sprite:

  1. High-quality downscale (LANCZOS) to 32x32.
  2. Border flood-fill the near-black background to transparent. Flooding
     from the EDGE (not a global key) is deliberate: it clears the outer
     background but PRESERVES dark pixels enclosed by the art — the black
     cave mouth of a dungeon entrance stays a solid opening rather than
     turning into a see-through hole onto the map below.

Output goes straight into web/public/sprites/map/ so the tiles are ready
to reference from a module (e.g. Default's map_tiles.json). Re-run
`node web/scripts/reindex-sprites.mjs` afterwards so the editor's sprite
picker catalogs the new files.

Usage:
  python3 process_map_art.py SRC.png OUT_NAME [SRC2.png OUT_NAME2 ...]
  python3 process_map_art.py            # process the bundled defaults
"""
import os
import sys
from collections import deque
from PIL import Image

TARGET = 32
BLACK_THRESH = 28  # max(r,g,b) <= this counts as background black
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MAP_DIR = os.path.join(REPO, "web", "public", "sprites", "map")

# Default jobs: (source file in resources/, output sprite name).
DEFAULT_JOBS = [
    ("dungeon_entrance_1.png", "dungeon_entrance_1"),
    ("dungeon_entrance_2.png", "dungeon_entrance_2"),
]


def process(src_path, out_path):
    im = Image.open(src_path).convert("RGB").resize((TARGET, TARGET), Image.LANCZOS)
    im = im.convert("RGBA")
    px = im.load()

    def near_black(p):
        return max(p[0], p[1], p[2]) <= BLACK_THRESH

    seen = [[False] * TARGET for _ in range(TARGET)]
    dq = deque()
    for x in range(TARGET):
        dq += [(x, 0), (x, TARGET - 1)]
    for y in range(TARGET):
        dq += [(0, y), (TARGET - 1, y)]
    removed = 0
    while dq:
        x, y = dq.popleft()
        if x < 0 or y < 0 or x >= TARGET or y >= TARGET or seen[y][x]:
            continue
        seen[y][x] = True
        if not near_black(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        removed += 1
        dq.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    im.save(out_path)
    return removed


def main():
    args = sys.argv[1:]
    if args:
        jobs = [(args[i], args[i + 1]) for i in range(0, len(args) - 1, 2)]
    else:
        jobs = DEFAULT_JOBS

    os.makedirs(MAP_DIR, exist_ok=True)
    for src, name in jobs:
        src_path = src if os.path.isabs(src) else os.path.join(HERE, src)
        out_path = os.path.join(MAP_DIR, name + ".png")
        removed = process(src_path, out_path)
        print(f"{name}.png  <- {os.path.basename(src)}  (bg px removed: {removed})")
    print(f"wrote {len(jobs)} tile(s) to {MAP_DIR}")
    print("next: run  node web/scripts/reindex-sprites.mjs")


if __name__ == "__main__":
    main()
