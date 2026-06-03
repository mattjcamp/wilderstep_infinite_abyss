#!/usr/bin/env python3
"""Process outdoor terrain tiles from the 'More' collection.

Same image pipeline as process_sprites.py (magenta key -> crop to content
-> scale-to-fill 32x32 -> center on transparent canvas), but routes each
file into a terrain category folder by filename:

  tree     <- L2_Tree*, L2_Forest*, L2_Jungle*, AppleTree, Berrybush
  mountain <- L2_Mountain*
  rock     <- standalone L2_Cliff*P## props (NOT the Slope autotiles / L1_)

Output: resources/processed_sprites/{tree,mountain,rock}/<snake_case>.png
The 'L2_'/'L1_' layer prefix is dropped from the output name.
"""
import os, re, glob
from PIL import Image

TARGET = 32
SRC = "resources/free_to_use_sprites_org/More"
OUTROOT = "resources/processed_sprites"


def category(stem: str):
    if "Mountain" in stem:
        return "mountain"
    if any(k in stem for k in ("Tree", "Forest", "Jungle", "AppleTree", "Berrybush")):
        return "tree"
    if "Cliff" in stem and "Slope" not in stem and not stem.startswith("L1_"):
        return "rock"
    return None


def snake(stem: str) -> str:
    stem = re.sub(r"^L[12]_", "", stem)            # drop layer prefix
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", stem)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", s)
    return s.lower() + ".png"


def is_key(r, g, b):
    return r >= 200 and g <= 60 and b >= 200


def process(path, out):
    im = Image.open(path).convert("RGBA")
    px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_key(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    bbox = im.getbbox()
    if bbox is None:
        return False
    c = im.crop(bbox); cw, ch = c.size
    s = min(TARGET / cw, TARGET / ch)
    nw, nh = max(1, round(cw * s)), max(1, round(ch * s))
    c = c.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
    canvas.paste(c, ((TARGET - nw) // 2, (TARGET - nh) // 2), c)
    canvas.save(out)
    return True


def main():
    counts = {"tree": 0, "mountain": 0, "rock": 0}
    for d in counts:
        os.makedirs(os.path.join(OUTROOT, d), exist_ok=True)
    for p in sorted(glob.glob(os.path.join(SRC, "*"))):
        if not p.lower().endswith(".png"):
            continue
        stem = os.path.basename(p)[:-4]
        cat = category(stem)
        if cat is None:
            continue
        out = os.path.join(OUTROOT, cat, snake(stem))
        if process(p, out):
            counts[cat] += 1
    for d, n in counts.items():
        print(f"{d}: {n}")
    print("total:", sum(counts.values()))


if __name__ == "__main__":
    main()
