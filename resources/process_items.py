#!/usr/bin/env python3
"""Process raw item sprites (weapons, armor, shields, potions, …) for the game.

The source tiles in `free_to_use_sprites_org/Items` are already authored at
the game's 32x32 item-sprite size, on a solid magenta (255,0,255) key. So,
unlike the monster pipeline, we do NOT crop + rescale (that would blow a
small dagger up to fill the frame and break its relative size). We simply:

  1. Key the magenta background to transparent. The key is a flat,
     un-antialiased (255,0,255), so we match it with a TIGHT threshold and
     remove it GLOBALLY — clearing magenta that's fully enclosed by sprite
     pixels (the gap inside a bow's curve, a crossbow frame, a ring loop)
     as well as the open border. The tight threshold leaves genuine blue /
     purple / pink art (gems, magic glows) untouched.
  2. Keep the original 32x32 frame so each item keeps the artist's intended
     size and position within the tile.
  3. Save as 32x32 RGBA PNG with a snake_case name (ArmorChainMail ->
     armor_chain_mail.png), matching the game's sprite-library convention,
     filed under a per-category subfolder named for the sprite's first word
     (armor_chain_mail.png -> item/armor/armor_chain_mail.png) so the set
     is scannable by item type.

Usage:
  python3 process_items.py            # process the whole Items folder
  python3 process_items.py FILE ...   # named files (basenames in Items/)
"""
import re
import sys
import os
import glob
import collections
from PIL import Image

TARGET = 32
HERE = os.path.dirname(os.path.abspath(__file__))
SRCDIR = os.path.join(HERE, "free_to_use_sprites_org", "Items")
OUTDIR = os.path.join(HERE, "processed_sprites", "item")


def snake(name: str) -> str:
    stem = re.sub(r"\.[Pp][Nn][Gg]$", "", name)
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", stem)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", s)  # ABCWord -> ABC_Word
    return s.lower() + ".png"


def category(snake_name: str) -> str:
    """Category folder for a sprite = the meaningful first word of its name.
    That's the token before the first underscore (armor_chain_mail -> armor),
    with any trailing digits trimmed so an un-underscored, numbered variant
    lands in the same bucket (mace06 -> mace, alongside mace_war)."""
    stem = re.sub(r"\.png$", "", snake_name)
    first = stem.split("_")[0]
    return re.sub(r"\d+$", "", first) or first


def is_key(r, g, b):
    """Near-exact magenta-key detector. The background key is a flat,
    un-antialiased (255,0,255); a TIGHT threshold means we can key it
    GLOBALLY (everywhere, not just from the border) to clear magenta that's
    fully enclosed by sprite pixels — the gap inside a bow's curve, a
    crossbow frame, a ring/necklace loop — without touching genuine blue /
    purple / pink art (a vivid purple gem like (200,0,255) fails r>=235)."""
    return r >= 235 and g <= 25 and b >= 235


def process(src, out):
    """Returns a stats dict, or None if the result is fully empty."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    # Global magenta key — every key-coloured pixel goes transparent, so
    # enclosed background pockets are cleared as well as the open border.
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

    # Normalise the frame to TARGET x TARGET. Source tiles are already 32x32
    # so this is usually a no-op; anything off-size is centered (never
    # upscaled past native) onto a transparent canvas.
    if (w, h) != (TARGET, TARGET):
        content = im.crop(bbox)
        cw, ch = content.size
        if cw > TARGET or ch > TARGET:
            scale = min(TARGET / cw, TARGET / ch)
            content = content.resize(
                (max(1, round(cw * scale)), max(1, round(ch * scale))),
                Image.NEAREST,
            )
            cw, ch = content.size
        canvas = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
        canvas.paste(content, ((TARGET - cw) // 2, (TARGET - ch) // 2), content)
        im = canvas

    im.save(out)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return {"size": (w, h), "keyed": keyed, "content": (bw, bh)}


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    args = sys.argv[1:]
    if args:
        files = args
    else:
        files = sorted(
            os.path.basename(p)
            for p in glob.glob(os.path.join(SRCDIR, "*"))
            if p.lower().endswith(".png")
        )

    ok = 0
    empty = []
    no_key = []          # almost nothing removed -> bg might not be magenta
    name_clash = {}
    by_cat = collections.Counter()
    for f in files:
        out_name = snake(f)
        name_clash.setdefault(out_name, []).append(f)
        cat = category(out_name)
        cat_dir = os.path.join(OUTDIR, cat)
        os.makedirs(cat_dir, exist_ok=True)
        stats = process(os.path.join(SRCDIR, f), os.path.join(cat_dir, out_name))
        if stats is None:
            empty.append(f)
            continue
        ok += 1
        by_cat[cat] += 1
        if stats["keyed"] < 4:
            no_key.append(f)

    clashes = {k: v for k, v in name_clash.items() if len(v) > 1}
    total_out = len(glob.glob(os.path.join(OUTDIR, "*", "*.png")))
    print(f"source files : {len(files)}")
    print(f"processed OK : {ok}")
    print(f"empty/skipped: {len(empty)}  {empty[:10]}")
    print(f"bg-not-keyed : {len(no_key)}  {no_key[:12]}")
    print(f"name clashes : {len(clashes)}  {dict(list(clashes.items())[:8])}")
    print(f"categories   : {len(by_cat)}")
    print(f"output files : {total_out}")
    print(f"output dir   : {OUTDIR}/<category>/")
    print("\nby category:")
    for k, v in sorted(by_cat.items()):
        print(f"  {k:16} {v}")


if __name__ == "__main__":
    main()
