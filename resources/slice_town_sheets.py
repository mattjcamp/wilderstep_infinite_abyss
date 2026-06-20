#!/usr/bin/env python3
"""Slice the AngbandTk town tilesheets into individual 32x32 map tiles.

Source: free_to_use_sprites_org/AngbandTk/dg_town0..9_32.gif — ten
288x128 GIF sheets laid out as a clean 9x4 grid of 32x32 tiles (no
gutters). They're full-cell town tiles (building facades, shop-sign
fronts, doors, temples, wells), which is how the game's own town/building
map sprites work too — fully OPAQUE, no transparency. So we slice them as
opaque tiles and do NOT colour-key (keying the dark recess behind a shop
sign would punch a hole through the tile).

  - Skip near-uniform "blank/filler" cells (one colour >= 98.5%).
  - Dedupe tiles that repeat across sheets (the shared shop-sign row
    appears in several sheets) — keep the first occurrence.
  - Name by first-occurrence position: town{sheet}_r{row}c{col}.png.

Output: processed_sprites/town/ , plus a labelled town_index.png contact
sheet so each tile can be identified at a glance.

Usage:  python3 slice_town_sheets.py
"""
import os
import glob
import collections
from PIL import Image, ImageDraw

TILE = 32
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_GLOB = os.path.join(HERE, "free_to_use_sprites_org", "AngbandTk", "dg_town*32.gif")
OUTDIR = os.path.join(HERE, "processed_sprites", "town")


def dominant_frac(cell):
    data = list(cell.getdata())
    c = collections.Counter(data)
    return c.most_common(1)[0][1] / len(data)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    sheets = sorted(glob.glob(SRC_GLOB))
    seen = {}            # tile bytes -> name (dedupe)
    saved = []           # (name, PIL image)
    blank = dup = 0

    for sheet in sheets:
        # sheet index from filename dg_town{N}32.gif
        base = os.path.basename(sheet)
        sidx = "".join(ch for ch in base if ch.isdigit())[:-2] or base
        im = Image.open(sheet).convert("RGBA")
        w, h = im.size
        cols, rows = w // TILE, h // TILE
        for r in range(rows):
            for c in range(cols):
                cell = im.crop((c * TILE, r * TILE, c * TILE + TILE, r * TILE + TILE))
                if dominant_frac(cell) >= 0.985:   # blank / solid filler
                    blank += 1
                    continue
                key = cell.tobytes()
                if key in seen:                    # repeated across sheets
                    dup += 1
                    continue
                name = f"town{sidx}_r{r}c{c}.png"
                seen[key] = name
                cell.save(os.path.join(OUTDIR, name))
                saved.append((name, cell))

    print(f"sheets        : {len(sheets)}")
    print(f"blank skipped : {blank}")
    print(f"dup skipped   : {dup}")
    print(f"unique tiles  : {len(saved)}")
    print(f"output dir    : {OUTDIR}")

    # ── labelled contact sheet ───────────────────────────────────────
    scale = 2
    pcell = TILE * scale
    label_h = 12
    cellw, cellh = pcell + 8, pcell + label_h + 8
    ncol = 10
    nrow = (len(saved) + ncol - 1) // ncol
    sheet_img = Image.new("RGBA", (ncol * cellw, nrow * cellh), (40, 40, 46, 255))
    draw = ImageDraw.Draw(sheet_img)
    for i, (name, img) in enumerate(saved):
        gx, gy = (i % ncol) * cellw, (i // ncol) * cellh
        big = img.resize((pcell, pcell), Image.NEAREST)
        sheet_img.alpha_composite(big, (gx + 4, gy + 4))
        short = name.replace("town", "").replace(".png", "")  # e.g. 0_r1c3
        draw.text((gx + 4, gy + pcell + 5), short, fill=(210, 210, 215, 255))
    idx_path = os.path.join(OUTDIR, "town_index.png")
    sheet_img.convert("RGB").save(idx_path)
    print(f"index image   : {idx_path}")


if __name__ == "__main__":
    main()
