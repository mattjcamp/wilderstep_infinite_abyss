#!/usr/bin/env python3
"""Regenerate the "Spells" section of docs/manual/manual.md from module data.

Single source of truth:
  - web/public/modules/default/spells.json

Spells are bucketed by `casting_type` (Priest first, then Sorcerer, then any
other catalog alphabetically) and, within each bucket, ordered by minimum
level then MP cost so the table reads as a progression a player levels into.
Each row shows the player-facing fields straight from the data — MP cost,
minimum level, range, targeting, where it can be cast, and the flavour
description — so the manual stays in lockstep with spells.json (adding a
spell there shows up here on the next run).

The `Where` column maps the spell's `usable_in` list: `battle`, `party`, or —
when the list is empty — `context` (contextual surfaces like the locked-door
dialog Knock is cast from).

The section lives between two HTML-comment markers in manual.md:

    <!-- BEGIN GENERATED: spells ... -->
    ...everything here is owned by this script...
    <!-- END GENERATED: spells -->

Only the text between the markers is rewritten; the rest of the manual is
left untouched. On the first run (markers absent) the script splices itself
in over the existing hand-written "## Spells" section, up to the next
top-level heading.

    python3 docs/manual/build_spells.py

Idempotent — running twice in a row produces no diff.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent              # docs/manual
ROOT = HERE.parents[1]                              # repo root
SPELLS_PATH = ROOT / "web" / "public" / "modules" / "default" / "spells.json"
MANUAL_PATH = HERE / "manual.md"

BEGIN = (
    "<!-- BEGIN GENERATED: spells — "
    "run `python3 docs/manual/build_spells.py` to refresh -->"
)
END = "<!-- END GENERATED: spells -->"


# ── Cell helpers ─────────────────────────────────────────────────────

def num(v) -> str:
    """Render a numeric field, blank when absent/None."""
    if v is None:
        return ""
    return str(v)


def cell(v) -> str:
    """Escape a free-text cell so pipes / newlines don't break the table."""
    if v is None:
        return ""
    return str(v).replace("|", r"\|").replace("\n", " ").strip()


def where_label(spell: dict) -> str:
    """Map `usable_in` to the player-facing Where column. An empty list
    means the spell is only castable from a contextual surface (Knock from
    the locked-door dialog), shown as `context`."""
    usable = spell.get("usable_in") or []
    if isinstance(usable, str):
        usable = [usable]
    usable = [u for u in usable if u]
    return ", ".join(usable) if usable else "context"


# ── Bucketing + ordering ─────────────────────────────────────────────

# Display labels + the order the casting catalogs appear in. A casting_type
# not listed here still renders (after these, alphabetically) so adding a new
# catalog to spells.json shows up automatically.
CASTING_LABELS = {
    "priest": "Priest Spells",
    "sorcerer": "Sorcerer Spells",
}
CASTING_ORDER = ["priest", "sorcerer"]


def spell_table(spells: list[dict]) -> str:
    """One casting catalog's spells as a table, ordered by min level then
    MP cost so the list reads as a level-up progression."""
    rows = [
        "| Spell | MP | Min Lvl | Range | Targeting | Where | Description |",
        "|---|---:|---:|---:|---|---|---|",
    ]
    spells = sorted(
        spells,
        key=lambda s: (
            s.get("min_level") or 0,
            s.get("mp_cost") or 0,
            s.get("name", ""),
        ),
    )
    for s in spells:
        rows.append(
            f"| **{cell(s.get('name', s.get('id')))}** "
            f"| {num(s.get('mp_cost'))} | {num(s.get('min_level'))} "
            f"| {num(s.get('range'))} | {cell(s.get('targeting'))} "
            f"| {cell(where_label(s))} | {cell(s.get('description'))} |"
        )
    return "\n".join(rows)


# ── Assemble the section ─────────────────────────────────────────────

def build_section(spells: list[dict]) -> str:
    buckets: dict[str, list[dict]] = {}
    for s in spells:
        cat = (s.get("casting_type") or "other").lower()
        buckets.setdefault(cat, []).append(s)

    intro = (
        "Spells are MP-cost actions castable by classes that have a matching "
        "`casting_type`. The `Where` column tells you where the spell can be "
        "cast — `battle`, `party`, or `context` (contextual surfaces like the "
        "locked-door dialog). _(This section is generated from "
        "`spells.json`; edit the data, not the prose here.)_"
    )

    out = [f"## Spells\n\n{intro}\n"]

    # Declared order first, then any unlisted catalogs alphabetically.
    ordered = [c for c in CASTING_ORDER if c in buckets]
    ordered += sorted(c for c in buckets if c not in CASTING_ORDER)
    for cat in ordered:
        group = buckets.get(cat)
        if not group:
            continue
        label = CASTING_LABELS.get(cat, f"{cat.replace('_', ' ').title()} Spells")
        out.append(f"\n### {label}\n")
        out.append(spell_table(group))
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    spells = json.loads(SPELLS_PATH.read_text())["spells"]
    section = build_section(spells)
    block = f"{BEGIN}\n\n{section}\n{END}"

    md = MANUAL_PATH.read_text()
    if BEGIN in md and END in md:
        pre = md[: md.index(BEGIN)]
        post = md[md.index(END) + len(END):]
        new = f"{pre}{block}{post}"
    else:
        # First run: replace the hand-written "## Spells" section, from its
        # heading up to the next top-level "## " heading.
        m = re.search(r"^## Spells\b", md, flags=re.MULTILINE)
        if not m:
            raise SystemExit(
                "Could not find spell markers or a '## Spells' heading in "
                "manual.md — add the markers manually once."
            )
        start = m.start()
        nxt = re.search(r"^## ", md[m.end():], flags=re.MULTILINE)
        end = m.end() + nxt.start() if nxt else len(md)
        new = f"{md[:start]}{block}\n\n{md[end:]}"

    if new != md:
        MANUAL_PATH.write_text(new)
        print(f"build-spells: wrote {len(spells)} spells to manual.md")
    else:
        print("build-spells: manual.md already up to date.")


if __name__ == "__main__":
    main()
