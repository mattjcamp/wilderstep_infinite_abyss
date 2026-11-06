#!/usr/bin/env python3
"""Build the /play title screen's art from the manual cover illustration.

The manual's cover art (docs/manual/assets/cover_art.png) is black ink
line work on cream paper inside a drawn frame. The website is dark, so
a cream rectangle would sit on the page like a pasted-in photo. Instead
this script turns the ink into light: it crops inside the drawn frame
(keeping the artist's signature), maps ink darkness to alpha, and colors
every line parchment (#f6efd6, the site's text color) on a transparent
background. On the dark page the scene reads as an engraving glowing out
of the night.

Output: web/public/play-art/hero_lines.png

    python3 docs/manual/build_play_art.py

Re-run after updating the cover art. Idempotent.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "assets" / "cover_art.png"
OUT = HERE.parents[1] / "web" / "public" / "play-art" / "hero_lines.png"

# Just inside the drawn frame (a ~4px rule ~20px in from each edge);
# the "DBL'ND" signature at the bottom right stays in.
CROP = (27, 30, 1653, 614)
# Paper and ink luminance in the source scan.
PAPER, INK = 238, 47
PARCHMENT = (246, 239, 214)


def main() -> None:
    gray = Image.open(SRC).convert("L").crop(CROP)
    span = PAPER - INK
    alpha = gray.point(
        lambda v: 0 if v >= PAPER else min(255, round((PAPER - v) * 255 / span))
    )
    out = Image.new("RGBA", gray.size, PARCHMENT + (0,))
    out.putalpha(alpha)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f"Wrote {OUT} ({out.size[0]}x{out.size[1]}, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
