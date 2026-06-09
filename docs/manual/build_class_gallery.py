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

# Second generated block: the HP/MP-per-level table in the
# "Experience & Leveling" subsection. Driven by each class's
# `hp_per_level` / `mp_per_level` fields (now authoritative in
# character_classes.json) so the manual stays in lockstep with the
# leveling math.
LEVEL_BEGIN = (
    "<!-- BEGIN GENERATED: leveling-table — "
    "run `python3 docs/manual/build_class_gallery.py` to refresh -->"
)
LEVEL_END = "<!-- END GENERATED: leveling-table -->"

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


def _esc_cell(s: str) -> str:
    """Escape a value for a Markdown table cell (pipes only — these
    blurbs/labels never contain newlines)."""
    return s.replace("|", r"\|")


def stat_table(cls: dict, names: dict[str, str]) -> str:
    """A tidy one-row Markdown table of the class's at-a-glance stats —
    replaces the old `·`-separated backtick line so it renders as a real
    table in both the Markdown and the PDF."""
    move = str(cls.get("range", "?"))
    casting = casting_label(cls.get("casting_type", []))
    gear = gear_label(cls.get("allowable_item_types", []))
    abil = abilities_label(cls.get("abilities", []), names)
    return (
        "| Move | Casting | Weapons & Armor | Abilities |\n"
        "|:--:|:--|:--|:--|\n"
        f"| {move} | {_esc_cell(casting)} | {_esc_cell(gear)} | {_esc_cell(abil)} |"
    )


def class_block(cls: dict, names: dict[str, str], image_left: bool) -> str:
    cid = cls["id"]
    name = cls.get("name", cid.title())
    desc = (cls.get("description") or "").strip()
    img = (
        f'<td width="{CELL_W}">'
        f'<img src="assets/portrait_{cid}.png" width="{PORTRAIT_W}" alt="{name}"></td>'
    )
    # Portrait + blurb live in a two-cell HTML row so they sit side by
    # side (alternating which side the portrait is on). The at-a-glance
    # stats follow as a tidy Markdown table BELOW the row — kept out of
    # the HTML cell so it parses as a real table everywhere.
    text = "<td>\n\n" f"{desc}\n\n" "</td>"
    cells = f"{img}\n{text}" if image_left else f"{text}\n{img}"
    table = f"<table><tr>\n{cells}\n</tr></table>"
    return f"#### {name}\n\n{table}\n\n{stat_table(cls, names)}"


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


def is_caster(casting_type: list[str]) -> bool:
    return any(c and c != "none" for c in (casting_type or []))


def casting_stat_label(casting_type: list[str]) -> str:
    """The ability score a caster's MP gain keys off — derived from the
    casting catalog(s) the class draws on. Mirrors the mp_source defaults
    in battle/world/Classes.ts (priest → Wisdom, sorcerer → Intelligence,
    both → the average of the two)."""
    cats = [c for c in (casting_type or []) if c and c != "none"]
    has_priest = "priest" in cats
    has_sorc = "sorcerer" in cats
    if has_priest and has_sorc:
        return "Int & Wis (avg)"
    if has_sorc:
        return "Intelligence"
    if has_priest:
        return "Wisdom"
    return "—"


def leveling_table(classes: list[dict]) -> str:
    """The per-class HP/MP-per-level table. Values come straight from the
    class data; non-casters show '—' for MP and casting stat."""
    rows = [
        "| Class | HP / level (base) | MP / level (base) | Casting stat |",
        "|---|---:|---:|---|",
    ]
    for c in sorted(classes, key=lambda c: c.get("name", c.get("id", ""))):
        hp = c.get("hp_per_level")
        mp = c.get("mp_per_level")
        caster = is_caster(c.get("casting_type"))
        hp_cell = "" if hp is None else str(hp)
        mp_cell = (str(mp) if mp is not None else "") if caster else "—"
        stat = casting_stat_label(c.get("casting_type"))
        rows.append(
            f"| **{c.get('name', c['id'])}** | {hp_cell} | {mp_cell} | {stat} |"
        )
    return "\n".join(rows)


def _replace_block(md: str, begin: str, end: str, content: str) -> str | None:
    """Swap the text between `begin`/`end` markers for `content`. Returns
    the new markdown, or None when the markers aren't both present."""
    if begin in md and end in md:
        block = f"{begin}\n\n{content}\n{end}"
        return md[: md.index(begin)] + block + md[md.index(end) + len(end):]
    return None


def main() -> None:
    classes = json.loads(CLASSES_PATH.read_text())["character_classes"]
    names = {
        a["id"]: a.get("name", a["id"])
        for a in json.loads(ABILITIES_PATH.read_text())["abilities"]
    }
    gallery = build_gallery(classes, names)

    md = MANUAL_PATH.read_text()
    new = md

    # ── Class gallery block ──────────────────────────────────────────
    replaced = _replace_block(new, BEGIN, END, gallery)
    if replaced is not None:
        new = replaced
    else:
        # First run / markers missing: splice the block in just before the
        # "## Abilities" section, which follows the gallery in the manual.
        anchor = "\n## Abilities"
        if anchor not in new:
            raise SystemExit(
                "Could not find gallery markers or the '## Abilities' anchor "
                "in manual.md — add the markers manually once."
            )
        idx = new.index(anchor)
        block = f"{BEGIN}\n\n{gallery}\n{END}"
        new = f"{new[:idx]}\n{block}\n{new[idx + 1:]}"

    # ── Leveling (HP/MP per level) table block ───────────────────────
    replaced = _replace_block(new, LEVEL_BEGIN, LEVEL_END, leveling_table(classes))
    if replaced is not None:
        new = replaced
    else:
        print(
            "build-class-gallery: NOTE — leveling-table markers not found; "
            "skipped that block. Add them once in the Experience & Leveling "
            "section to enable it."
        )

    if new != md:
        MANUAL_PATH.write_text(new)
        print(f"build-class-gallery: wrote {len(classes)} classes to manual.md")
    else:
        print("build-class-gallery: manual.md already up to date.")


if __name__ == "__main__":
    main()
