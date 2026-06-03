#!/usr/bin/env python3
"""Process raw monster sprites for the game.

Pipeline per sprite:
  1. Make the magenta key (255,0,255) transparent.
  2. Crop to the content bounding box (trim dead border).
  3. Scale content to FILL a 32x32 frame (preserve aspect, nearest-neighbor).
  4. Center on a 32x32 transparent RGBA canvas.

Output filenames are snake_case (AngelBlue.PNG -> angel_blue.png), matching
the game's sprite-library convention. Trailing/internal digits stay attached
(Dragon3Headed -> dragon3headed) to match existing names like daemon1.

Usage:
  python3 process_sprites.py FILE.PNG [FILE2.PNG ...]   # named files
  python3 process_sprites.py --all                       # whole folder
"""
import re, sys, os, glob
from PIL import Image

TARGET = 32
SRCDIR = "resources/free_to_use_sprites_org/Monsters"
OUTDIR = "resources/processed_sprites"


def snake(name: str) -> str:
    stem = re.sub(r"\.[Pp][Nn][Gg]$", "", name)
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", stem)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", s)  # ABCWord -> ABC_Word
    return s.lower() + ".png"


def is_key(r, g, b):
    # robust magenta detector (won't catch pure blue/purple sprite pixels)
    return r >= 200 and g <= 60 and b >= 200


def process(src, out):
    """Returns a dict of stats, or None when the sprite is empty."""
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    total = w * h
    keyed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_key(r, g, b):
                px[x, y] = (0, 0, 0, 0)
                keyed += 1
    bbox = im.getbbox()
    if bbox is None:
        return None
    content = im.crop(bbox)
    cw, ch = content.size
    scale = min(TARGET / cw, TARGET / ch)
    nw, nh = max(1, round(cw * scale)), max(1, round(ch * scale))
    content = content.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
    canvas.paste(content, ((TARGET - nw) // 2, (TARGET - nh) // 2), content)
    canvas.save(out)
    return {
        "size": (w, h),
        "keyed_frac": keyed / total,
        "content": (cw, ch),
        "aspect": cw / ch if ch else 0,
    }


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    args = sys.argv[1:]
    if args == ["--all"]:
        files = sorted(
            os.path.basename(p)
            for p in glob.glob(os.path.join(SRCDIR, "*"))
            if p.lower().endswith(".png")
        )
    else:
        files = args

    ok = 0
    empty = []          # fully transparent / nothing to crop
    no_key = []         # almost nothing keyed -> background probably not magenta
    tiny = []           # content < 10px in a dimension (will upscale a lot)
    wide = []           # aspect far from square (possible multi-frame)
    name_clash = {}     # snake name -> [sources]

    for f in files:
        out_name = snake(f)
        name_clash.setdefault(out_name, []).append(f)
        out = os.path.join(OUTDIR, out_name)
        stats = process(os.path.join(SRCDIR, f), out)
        if stats is None:
            empty.append(f)
            continue
        ok += 1
        if stats["keyed_frac"] < 0.02:
            no_key.append((f, round(stats["keyed_frac"], 3)))
        cw, ch = stats["content"]
        if min(cw, ch) < 10:
            tiny.append((f, stats["content"]))
        if stats["aspect"] > 2.2 or stats["aspect"] < 0.45:
            wide.append((f, stats["content"]))

    clashes = {k: v for k, v in name_clash.items() if len(v) > 1}

    print(f"processed OK : {ok}")
    print(f"empty/skipped: {len(empty)}  {empty[:10]}")
    print(f"bg-not-keyed : {len(no_key)}  {no_key[:12]}")
    print(f"tiny content : {len(tiny)}  {tiny[:12]}")
    print(f"odd aspect   : {len(wide)}  {wide[:12]}")
    print(f"name clashes : {len(clashes)}  "
          f"{dict(list(clashes.items())[:8])}")
    print(f"output files : {len(glob.glob(os.path.join(OUTDIR, '*.png')))}")


if __name__ == "__main__":
    main()
