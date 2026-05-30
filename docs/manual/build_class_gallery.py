#!/usr/bin/env python3
"""Regenerate the "Class Gallery" section of docs/manual/manual.md from the
module data, so the prose + stats stay in lockstep with the game.

Single source of truth:
  - web/public/modules/default/character_classes.json
      `description` (prose blurb), `range`, `casting_type`,
      `allowable_item_types`, and `abilities[]` ({ability_id, min_level}).
  - web/public/modules/default/abilities.json  (ability id -> display name)
  - docs/manual/assets/portrait_<id>.png       (the cut-out portraits)

The gallery lives between two HTML-comment markers in manual.md:

    <!-- BEGIN GENERATED: class-gallery ... -->
    ...everything here is owned by this script...
    <!-- END GENERATED: class-gallery -->

Only the text between the markers is rewritten; the rest of the manual is
left untouched. Run it whenever a class changes:

    python3 docs/manual/build_class_gallery.py

Idempotent — running twice in a row produces no diff.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent          # docs/manual
ROOT = HERE.parents[1]                           # repo root
DATA = ROOT / "web" / "public" / "modules" / "default"
CLASSES_PATH = DATA / "character_classes.json"
ABILITIES_PATH = DATA / "abilities.json"
MANUAL_PATH = HERE / "manual.md"

BEGIN = (
    "<!-- BEGIN GENERATED: class-gallery — "
    "run `python3 docs/manual/build_class_gallery.py` to refresh -->"
)
END = "<!-- END GENERATED: class-gallery -->"

# Armor item_types in ascending protection order (per the data dictionary).
ARMOR_TIERS = ["cloth", "leather", "chain", "plate", "exotic"]
ARMOR_SET = set(ARMOR_TIERS)

PORTRAIT_W = 150   # rendered portrait width in the manual
CELL_W = 170       # image table-cell width


def casting_label(casting_type: list[str]) -> str:
    cats = [c for c in (casting_type or []) if c and c != "none"]
    if not cats:
        return "No spells"
    pretty = {"sorcerer": "Sorcerer", "priest": "Priest"}
    # Stable, readable order: sorcerer before priest.
    order = [c for c in ("sorcerer", "priest") if c in cats]
    order += [c for c in cats if c not in ("sorcerer", "priest")]
    return " + ".join(pretty.get(c, c.title()) for c in order)


def gear_label(item_types: list[str]) -> str:
    items = item_types or []
    weapons = [t for t in items if t not in ARMOR_SET]
    armors = [t for t in items if t in ARMOR_SET]
    top = max((ARMOR_TIERS.index(a) for a in armors), default=-1)
    # "All weapons & armor" shortcut when a class can use the full armory.
    if top == len(ARMOR_TIERS) - 1 and len(weapons) >= 12:
        return "All weapons & armor"
    armor_phrase = (
        f"up to {ARMOR_TIERS[top]} armor" if top >= 0 else "no armor"
    )
    n = len(weapons)
    weap_phrase = f"{n} weapon type{'s' if n != 1 else ''}"
    return f"{weap_phrase} · {armor_phrase}"


def abilities_label(abilities: list[dict], names: dict[str, str]) -> str:
    if not abilities:
        return "—"
    # Sort by unlock level, then by display name, for a stable readout.
    rows = sorted(
        abilities,
        key=lambda a: (a.get("min_level", 1), names.get(a.get("ability_id", ""), "")),
    )
    parts = []
    for a in rows:
        aid = a.get("ability_id", "")
        lvl = a.get("min_level", 1)
        parts.append(f"{names.get(aid, aid)} (L{lvl})")
    return ", ".join(parts)


def stat_line(cls: dict, names: dict[str, str]) -> str:
    chips = [
        f"Move {cls.get('range', '?')}",
        casting_label(cls.get("casting_type", [])),
        gear_label(cls.get("allowable_item_types", [])),
        abilities_label(cls.get("abilities", []), names),
    ]
    return " · ".join(f"`{c}`" if c != "—" else "`—`" for c in chips)


def class_block(cls: dict, names: dict[str, str], image_left: bool) -> str:
    cid = cls["id"]
    name = cls.get("name", cid.title())
    desc = (cls.get("description") or "").strip()
    img = (
        f'<td width="{CELL_W}">'
        f'<img src="assets/portrait_{cid}.png" width="{PORTRAIT_W}" alt="{name}"></td>'
    )
    text = "<td>\n\n" f"{desc}\n\n" f"{stat_line(cls, names)}\n\n" "</td>"
    cells = f"{img}\n{text}" if image_left else f"{text}\n{img}"
    return f"#### {name}\n\n<table><tr>\n{cells}\n</tr></table>"


def build_gallery(classes: list[dict], names: dict[str, str]) -> str:
    # Alphabetical by display name to match the comparison table above it.
    ordered = sorted(classes, key=lambda c: c.get("name", c["id"]).lower())
    out = [
        "### Class Gallery",
        "",
        "A closer look at each class — how it plays, and what it brings to "
        "the party. _(This section is generated from "
        "`character_classes.json`; edit the data, not the prose here.)_",
        "",
    ]
    for i, cls in enumerate(ordered):
        out.append(class_block(cls, names, image_left=(i % 2 == 0)))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    classes = json.loads(CLASSES_PATH.read_text())["character_classes"]
    names = {
        a["id"]: a.get("name", a["id"])
        for a in json.loads(ABILITIES_PATH.read_text())["abilities"]
    }
    gallery = build_gallery(classes, names)

    md = MANUAL_PATH.read_text()
    block = f"{BEGIN}\n\n{gallery}\n{END}"

    if BEGIN in md and END in md:
        pre = md[: md.index(BEGIN)]
        post = md[md.index(END) + len(END):]
        new = f"{pre}{block}{post}"
    else:
        # First run / markers missing: splice the block in just before the
        # "## Abilities" section, which follows the gallery in the manual.
        anchor = "\n## Abilities"
        if anchor not in md:
            raise SystemExit(
                "Could not find gallery markers or the '## Abilities' anchor "
                "in manual.md — add the markers manually once."
            )
        idx = md.index(anchor)
        new = f"{md[:idx]}\n{block}\n{md[idx + 1:]}"

    if new != md:
        MANUAL_PATH.write_text(new)
        print(f"build-class-gallery: wrote {len(classes)} classes to manual.md")
    else:
        print("build-class-gallery: manual.md already up to date.")


if __name__ == "__main__":
    main()
