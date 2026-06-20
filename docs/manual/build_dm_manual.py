#!/usr/bin/env python3
"""Regenerate docs/manual/dm_manual.pdf from dm_manual.md.

The Dungeon Master's Manual is the authoring-side companion to the
Player's Manual. Unlike the player's manual it is fully hand-written —
there are no data-driven generators feeding it — so this builder just
renders the markdown to a styled PDF and syncs a copy into the web app's
static folder (web/public/dm_manual.pdf) for the landing page.

It deliberately reuses every rendering helper from build_manual.py (the
ornate page frame, the markdown tokenizer/renderer, the palette and
styles) so the two manuals are visually identical siblings. Only the
title page text and the input/output paths differ. build_manual.py does
no work on import (everything runs under its ``__main__`` guard), so
importing it here is safe and keeps the player-manual build untouched.

Run:  python3 docs/manual/build_dm_manual.py
  (or via build_all.py / build-manual.sh, which chain it in)
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageTemplate,
    Paragraph,
    Spacer,
)

import build_manual as bm

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MD_PATH = HERE / "dm_manual.md"
OUT_PATH = HERE / "dm_manual.pdf"


def _title_page(story):
    """DM's-Manual cover — same layout as the player manual's title page,
    with its own handbook name + subtitle."""
    story.append(Spacer(0, 50))
    story.append(Paragraph("WILDERSTEP: INFINITE ABYSS", bm.H1))
    story.append(Spacer(0, 2))
    story.append(bm.OrnateRule(bm.TEXT_WIDTH * 0.7, color=bm.ACCENT, size=3,
                               gap=6, thickness=1.0))
    story.append(Spacer(0, 18))

    cover = bm.ASSETS / "cover_art.png"
    if cover.exists():
        img_w = 5.5 * inch
        img_h = img_w * (640 / 1668)
        img = Image(str(cover), width=img_w, height=img_h)
        img.hAlign = "CENTER"
        story.append(img)

    story.append(Spacer(0, 18))
    story.append(bm.OrnateRule(bm.TEXT_WIDTH * 0.7, color=bm.ACCENT, size=3,
                               gap=6, thickness=1.0))
    story.append(Spacer(0, 16))
    story.append(Paragraph(
        "DUNGEON MASTER'S MANUAL",
        bm._para_style("TitleSub", fontName=bm.BOLD_FONT, fontSize=26,
                       leading=30, textColor=bm.ACCENT, alignment=1,
                       spaceAfter=10)))
    story.append(Spacer(0, 4))
    story.append(Paragraph(
        "<i>A Guide to Building Adventures in Wilderstep</i>",
        bm._para_style("TitleMeta", fontName=bm.ITAL_FONT, fontSize=12,
                       leading=16, textColor=bm.ACCENT_SOFT, alignment=1,
                       spaceAfter=2)))
    story.append(Paragraph(
        "<i>The Author's Companion to the Player's Manual</i>",
        bm._para_style("TitleMeta2", fontName=bm.ITAL_FONT, fontSize=12,
                       leading=16, textColor=bm.ACCENT_SOFT, alignment=1)))


def build():
    md = MD_PATH.read_text(encoding="utf-8")
    # Strip editor-only HTML comments, drop layout-only wrapper tags so
    # inline images embed properly — same preprocessing the player build
    # uses (the class-gallery extraction is player-specific and simply
    # finds nothing here, so it's skipped).
    import re
    md = re.sub(r"<!--.*?-->", "", md, flags=re.DOTALL)
    md = bm._strip_structural_html(md)
    blocks = bm._tokenize(md)

    doc = BaseDocTemplate(
        str(OUT_PATH),
        pagesize=letter,
        leftMargin=bm.TEXT_LEFT, rightMargin=bm.PAGE_W - bm.TEXT_RIGHT,
        topMargin=bm.PAGE_H - bm.TEXT_TOP, bottomMargin=bm.TEXT_BOTTOM,
        title="Wilderstep: Infinite Abyss — Dungeon Master's Manual",
        author="Matt Campbell",
        subject="Dungeon Master's Manual",
        creator="docs/manual/build_dm_manual.py",
    )
    frame = Frame(bm.TEXT_LEFT, bm.TEXT_BOTTOM,
                  bm.TEXT_WIDTH, bm.TEXT_HEIGHT,
                  leftPadding=0, rightPadding=0,
                  topPadding=0, bottomPadding=0,
                  id="normal", showBoundary=0)
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame],
                                       onPage=bm._on_page)])

    story = []
    _title_page(story)
    bm._render_blocks(story, blocks)

    doc.build(story)
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB, "
          f"{len(blocks)} blocks)")

    # Sync a copy into the web app so the landing page can serve it at
    # /dm_manual.pdf. Skipped silently in a docs-only checkout.
    public_copy = REPO / "web" / "public" / "dm_manual.pdf"
    if public_copy.parent.is_dir():
        import shutil
        shutil.copyfile(OUT_PATH, public_copy)
        print(f"Synced {public_copy} "
              f"({public_copy.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
