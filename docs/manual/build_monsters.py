#!/usr/bin/env python3
"""Regenerate the "Monsters" section of docs/manual/manual.md from data.

Single source of truth:
  - web/public/modules/default/monsters.json

Lists EVERY monster, each with its sprite, sorted by difficulty (easy →
normal → hard → deadly → boss) and then by HP within a tier. Mirrors the
build_items.py / build_class_gallery.py pattern: the section lives between

    <!-- BEGIN GENERATED: monsters ... -->
    ...owned by this script...
    <!-- END GENERATED: monsters -->

and only the text between the markers is rewritten. On the first run
(markers absent) it splices over the hand-written "## Monsters" section up
to the next top-level heading.

    python3 docs/manual/build_monsters.py

Idempotent — running twice in a row produces no diff.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent              # docs/manual
ROOT = HERE.parents[1]                              # repo root
MONSTERS_PATH = ROOT / "web" / "public" / "modules" / "default" / "monsters.json"
MANUAL_PATH = HERE / "manual.md"

BEGIN = (
    "<!-- BEGIN GENERATED: monsters — "
    "run `python3 docs/manual/build_monsters.py` to refresh -->"
)
END = "<!-- END GENERATED: monsters -->"

# Sprite path relative to docs/manual/manual.md → repo web assets. The
# monster `sprite` field already includes the "monster/" subfolder.
SPRITE_REL = "../../web/public/sprites"

# Difficulty tiers in ascending challenge; boss is the apex. Anything
# unrecognised sorts last.
DIFF_ORDER = {"easy": 0, "normal": 1, "hard": 2, "deadly": 3, "boss": 4}


def cell(v) -> str:
    if v is None:
        return ""
    return str(v).replace("|", r"\|").replace("\n", " ").strip()


def num(v) -> str:
    return "" if v is None else str(v)


def sprite_img(m: dict) -> str:
    sprite = m.get("sprite")
    if not sprite:
        return ""
    return f'<img src="{SPRITE_REL}/{sprite}" width="36" alt="{cell(m.get("name", ""))}">'


def atk(m: dict) -> str:
    ab = m.get("attack_bonus")
    if not isinstance(ab, (int, float)):
        return ""
    return f"+{int(ab)}" if ab >= 0 else str(int(ab))


def damage(m: dict) -> str:
    dice = m.get("damage_dice") or 0
    sides = m.get("damage_sides") or 0
    bonus = m.get("damage_bonus") or 0
    if not dice or not sides:
        return ""
    s = f"{int(dice)}d{int(sides)}"
    if bonus > 0:
        s += f"+{int(bonus)}"
    elif bonus < 0:
        s += str(int(bonus))
    return s


def gold(m: dict) -> str:
    lo, hi = m.get("gold_min"), m.get("gold_max")
    if lo is None and hi is None:
        return ""
    return f"{int(lo or 0)}–{int(hi or 0)}"


def tags(m: dict) -> str:
    parts: list[str] = []
    if m.get("undead"):
        parts.append("undead")
    if m.get("humanoid"):
        parts.append("humanoid")
    par = m.get("post_attack_move") or 0
    if par > 0:
        parts.append(f"hit-and-run {int(par)}")
    return ", ".join(parts)


def diff_rank(m: dict) -> int:
    return DIFF_ORDER.get((m.get("difficulty") or "").lower(), 99)


def build_section(monsters: list[dict]) -> str:
    intro = (
        "Every monster in the game, sorted by difficulty (easy → normal → "
        "hard → deadly → boss), then by HP. **Damage** is the attack dice; "
        "**Move** is the tile budget per turn. The **Tags** column notes "
        "type (undead / humanoid — undead matters for Smite Undead and Turn "
        "Undead) and hit-and-run behaviour."
    )
    rows = [
        "| Sprite | Monster | Diff | HP | AC | Atk | Damage | Move | XP | Gold | Tags |",
        "|:---:|---|---|---:|---:|---:|---|---:|---:|---:|---|",
    ]
    ordered = sorted(monsters, key=lambda m: (diff_rank(m), m.get("hp") or 0,
                                              m.get("name", "")))
    for m in ordered:
        rows.append(
            f"| {sprite_img(m)} | **{cell(m.get('name', m.get('id')))}** "
            f"| {cell(m.get('difficulty'))} | {num(m.get('hp'))} "
            f"| {num(m.get('ac'))} | {atk(m)} | {damage(m)} "
            f"| {num(m.get('move_range'))} | {num(m.get('xp_reward'))} "
            f"| {gold(m)} | {cell(tags(m))} |"
        )
    return f"## Monsters\n\n{intro}\n\n" + "\n".join(rows) + "\n"


def main() -> None:
    monsters = json.loads(MONSTERS_PATH.read_text())["monsters"]
    block = f"{BEGIN}\n\n{build_section(monsters)}\n{END}"

    md = MANUAL_PATH.read_text()
    if BEGIN in md and END in md:
        pre = md[: md.index(BEGIN)]
        post = md[md.index(END) + len(END):]
        new = f"{pre}{block}{post}"
    else:
        m = re.search(r"^## Monsters\b", md, flags=re.MULTILINE)
        if not m:
            raise SystemExit(
                "Could not find monster markers or a '## Monsters' heading "
                "in manual.md — add the markers manually once."
            )
        start = m.start()
        nxt = re.search(r"^## ", md[m.end():], flags=re.MULTILINE)
        end = m.end() + nxt.start() if nxt else len(md)
        new = f"{md[:start]}{block}\n\n{md[end:]}"

    if new != md:
        MANUAL_PATH.write_text(new)
        print(f"build-monsters: wrote {len(monsters)} monsters to manual.md")
    else:
        print("build-monsters: manual.md already up to date.")


if __name__ == "__main__":
    main()
