#!/usr/bin/env python3
"""Regenerate the manual's Races + Abilities tables from module data,
so they stay in lockstep with races.json / abilities.json the same way
the Class Gallery, Spells, Items and Monsters sections already do.

Three generated blocks, each fenced by HTML-comment markers in
manual.md (only the text between the markers is rewritten):

  * races          — the Race · STR · DEX · CON · INT · WIS · Abilities
                     table (stat modifiers + innate ability names).
  * class-abilities — Ability · Description · Where · Duration for every
                     ability whose `type` is "class".
  * race-abilities  — same columns, for `type` == "race".

Single source of truth:
  - web/public/modules/default/races.json
      `stat_modifiers` (str/dex/con/int/wis), `abilities` (ability ids).
  - web/public/modules/default/abilities.json
      `name`, `description`, `type`, `usable_in`, `duration`; plus the
      id -> display-name map the races table uses for its ability column.

Run:  python3 docs/manual/build_races_abilities.py
Idempotent — running twice in a row produces no diff.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent          # docs/manual
ROOT = HERE.parents[1]                           # repo root
DATA = ROOT / "web" / "public" / "modules" / "default"
RACES_PATH = DATA / "races.json"
ABILITIES_PATH = DATA / "abilities.json"
MANUAL_PATH = HERE / "manual.md"

RACES_BEGIN = (
    "<!-- BEGIN GENERATED: races — "
    "run `python3 docs/manual/build_races_abilities.py` to refresh -->"
)
RACES_END = "<!-- END GENERATED: races -->"

CLASS_ABIL_BEGIN = (
    "<!-- BEGIN GENERATED: class-abilities — "
    "run `python3 docs/manual/build_races_abilities.py` to refresh -->"
)
CLASS_ABIL_END = "<!-- END GENERATED: class-abilities -->"

RACE_ABIL_BEGIN = (
    "<!-- BEGIN GENERATED: race-abilities — "
    "run `python3 docs/manual/build_races_abilities.py` to refresh -->"
)
RACE_ABIL_END = "<!-- END GENERATED: race-abilities -->"

# Stat-modifier columns in display order, mapped to their data keys.
STAT_COLUMNS = [
    ("STR", "strength"),
    ("DEX", "dexterity"),
    ("CON", "constitution"),
    ("INT", "intelligence"),
    ("WIS", "wisdom"),
]


def _esc(s: str) -> str:
    """Escape a value for a Markdown table cell (pipes only)."""
    return str(s).replace("|", r"\|")


def _signed(v: object) -> str:
    """Format a stat modifier as a signed integer ("+2", "0", "-1").
    Non-numeric / missing values render as "0" so the grid stays full."""
    try:
        n = int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "0"
    return f"+{n}" if n > 0 else str(n)


def where_label(ability: dict) -> str:
    """Where the ability is triggered — mirrors the manual's legend:
    battle (combat menu), party (character-sheet Use button), or
    passive (always-on / auto-triggered)."""
    usable = ability.get("usable_in") or []
    if "battle" in usable:
        return "battle"
    if "party" in usable:
        return "party"
    return "passive"


def duration_cell(ability: dict) -> str:
    """Duration as a display string. Absent / null renders blank, which
    is how the hand-authored table left non-durational abilities."""
    dur = ability.get("duration")
    if dur is None:
        return ""
    return _esc(str(dur))


def ability_name_map(abilities: list[dict]) -> dict[str, str]:
    return {a["id"]: a.get("name", a["id"]) for a in abilities}


def races_table(races: list[dict], names: dict[str, str]) -> str:
    header = "| Race | " + " | ".join(label for label, _ in STAT_COLUMNS) + " | Abilities |"
    align = "|---|" + "---:|" * len(STAT_COLUMNS) + "---|"
    rows = [header, align]
    for r in sorted(races, key=lambda r: r.get("name", r.get("id", "")).lower()):
        name = r.get("name", r["id"])
        mods = r.get("stat_modifiers", {}) or {}
        cells = [_signed(mods.get(key)) for _, key in STAT_COLUMNS]
        abil_ids = r.get("abilities", []) or []
        abil = ", ".join(_esc(names.get(a, a)) for a in abil_ids) or "—"
        rows.append(f"| **{_esc(name)}** | " + " | ".join(cells) + f" | {abil} |")
    return "\n".join(rows)


def abilities_table(abilities: list[dict], ability_type: str) -> str:
    rows = [
        "| Ability | Description | Where | Duration |",
        "|---|---|---|---|",
    ]
    chosen = [a for a in abilities if a.get("type") == ability_type]
    for a in sorted(chosen, key=lambda a: a.get("name", a.get("id", "")).lower()):
        name = _esc(a.get("name", a["id"]))
        desc = _esc((a.get("description") or "").strip())
        rows.append(
            f"| **{name}** | {desc} | {where_label(a)} | {duration_cell(a)} |"
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
    races = json.loads(RACES_PATH.read_text())["races"]
    abilities = json.loads(ABILITIES_PATH.read_text())["abilities"]
    names = ability_name_map(abilities)

    md = MANUAL_PATH.read_text()
    new = md
    skipped: list[str] = []

    blocks = [
        ("races", RACES_BEGIN, RACES_END, races_table(races, names)),
        ("class-abilities", CLASS_ABIL_BEGIN, CLASS_ABIL_END,
         abilities_table(abilities, "class")),
        ("race-abilities", RACE_ABIL_BEGIN, RACE_ABIL_END,
         abilities_table(abilities, "race")),
    ]
    for label, begin, end, content in blocks:
        replaced = _replace_block(new, begin, end, content)
        if replaced is not None:
            new = replaced
        else:
            skipped.append(label)

    if skipped:
        print(
            "build-races-abilities: NOTE — markers not found for: "
            + ", ".join(skipped)
            + ". Add them once around the matching table to enable it."
        )

    if new != md:
        MANUAL_PATH.write_text(new)
        print(
            f"build-races-abilities: wrote {len(races)} races + "
            f"{len(abilities)} abilities to manual.md"
        )
    else:
        print("build-races-abilities: manual.md already up to date.")


if __name__ == "__main__":
    main()
