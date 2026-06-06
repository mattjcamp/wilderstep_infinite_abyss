#!/usr/bin/env python3
"""Regenerate the "Items" section of docs/manual/manual.md from module data.

Single source of truth:
  - web/public/modules/default/items.json

Items are bucketed by `item_type`, the groups ordered weapons → armors →
general (alphabetical within each), and each group rendered as a table.
Crucially, the player-meaningful *derived* stats are shown rather than the
raw authoring fields:

  - Weapons show **Base Damage** — the dice the weapon actually rolls —
    instead of the abstract `power` number. Melee power maps onto a rising
    dice ladder; ranged weapons fire `1d6 + power`.
  - Armor shows **Base AC** — the Armor Class a typical (10-DEX) wearer has
    in it: `10 + floor((evasion - 50) / 2) + ac_bonus` — instead of the raw
    `evasion` scale.

These derivations are the Python twin of `web/src/data_model/itemStats.ts`
(and mirror the combat math in `battle/combat/CombatBridge.ts` +
`CombatActions.ts`). Keep the two in lockstep.

The section lives between two HTML-comment markers in manual.md:

    <!-- BEGIN GENERATED: items ... -->
    ...everything here is owned by this script...
    <!-- END GENERATED: items -->

Only the text between the markers is rewritten; the rest of the manual is
left untouched. On the first run (markers absent) the script splices itself
in over the existing hand-written "## Items" section, up to the next
top-level heading.

    python3 docs/manual/build_items.py

Idempotent — running twice in a row produces no diff.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent              # docs/manual
ROOT = HERE.parents[1]                              # repo root
ITEMS_PATH = ROOT / "web" / "public" / "modules" / "default" / "items.json"
MANUAL_PATH = HERE / "manual.md"

BEGIN = (
    "<!-- BEGIN GENERATED: items — "
    "run `python3 docs/manual/build_items.py` to refresh -->"
)
END = "<!-- END GENERATED: items -->"


# ── Derivations (mirror web/src/data_model/itemStats.ts) ─────────────

def base_damage(item: dict) -> str:
    """The weapon's base damage dice ('1d8', '2d8', '1d6+9'). Empty for
    non-weapons. Melee power → dice ladder; ranged → 1d6 + power."""
    if item.get("category") != "weapons":
        return ""
    p = item.get("power")
    p = p if isinstance(p, (int, float)) else 0
    if item.get("ranged"):
        return f"1d6+{int(p)}" if p > 0 else "1d6"
    if p <= 0:
        return "1"
    if p == 1:
        return "1d4-1"
    if p <= 3:
        return "1d4"
    if p <= 5:
        return "1d6"
    if p <= 8:
        return "1d8"
    if p <= 11:
        return "1d10"
    if p <= 14:
        return "1d12"
    if p <= 19:
        return "2d6"
    return "2d8"


def base_ac(item: dict) -> str:
    """Absolute AC for a 10-DEX wearer: 10 + floor((evasion-50)/2) +
    ac_bonus. Empty for non-armor."""
    if item.get("category") != "armors":
        return ""
    evasion = item.get("evasion")
    evasion = evasion if isinstance(evasion, (int, float)) else 50
    ac_bonus = item.get("ac_bonus")
    ac_bonus = ac_bonus if isinstance(ac_bonus, (int, float)) else 0
    return str(int(10 + math.floor((evasion - 50) / 2) + ac_bonus))


# ── Cell helpers ─────────────────────────────────────────────────────

def num(v) -> str:
    """Render a numeric field, blank when absent/None."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "✓" if v else ""
    return str(v)


def cell(v) -> str:
    """Escape a free-text cell so pipes / newlines don't break the table."""
    if v is None:
        return ""
    return str(v).replace("|", r"\|").replace("\n", " ").strip()


def special_label(item: dict) -> str:
    """Derive the weapon 'Special' column — ranged / ammo / throwable."""
    parts: list[str] = []
    if item.get("ranged"):
        ammo = item.get("ammo")
        parts.append(f"ranged, uses {ammo}" if ammo else "ranged")
    if item.get("throwable"):
        parts.append("throwable")
    if item.get("ignite"):
        lr = item.get("light_range", 3)
        parts.append(f"ignites (light {lr})")
    return ", ".join(parts)


def type_label(item_type: str) -> str:
    return (item_type or "misc").replace("_", " ").title()


# Sprite path relative to docs/manual/manual.md → repo web assets.
SPRITE_REL = "../../web/public/sprites/item"


def icon_img(item: dict) -> str:
    """An <img> tag for the item's sprite, or blank when it has no icon.
    Width-capped so the pixel-art reads as a small inline glyph."""
    icon = item.get("icon")
    if not icon:
        return ""
    name = cell(item.get("name", item.get("id", "")))
    return f'<img src="{SPRITE_REL}/{icon}.png" width="28" alt="{name}">'


# ── Table builders, one per category schema ──────────────────────────

def weapon_table(items: list[dict]) -> str:
    """All weapons in one table. The `Type` column keeps the weapon kind
    visible now that swords / bows / maces share a single table."""
    rows = ["| Icon | Item | Type | Base Damage | Durability | Damage Bonus | Damage Type | Special | Buy |",
            "|:---:|---|---|---:|---:|---|---|---|---:|"]
    # Group by reach (all melee first, then all ranged), and within each
    # group order weakest → strongest by power. `bool(ranged)` puts melee
    # (False → 0) ahead of ranged (True → 1).
    items = sorted(items, key=lambda it: (bool(it.get("ranged")),
                                          it.get("power") or 0,
                                          it.get("name", "")))
    for it in items:
        rows.append(
            f"| {icon_img(it)} | **{cell(it.get('name', it.get('id')))}** "
            f"| {type_label(it.get('item_type'))} "
            f"| {base_damage(it)} | {num(it.get('durability'))} "
            f"| {cell(it.get('bonus_damage'))} | {cell(it.get('damage_type'))} "
            f"| {cell(special_label(it))} | {num(it.get('buy'))} |"
        )
    return "\n".join(rows)


def armor_table(items: list[dict]) -> str:
    """All armor in one table, sorted by protection (Base AC) ascending —
    least to most protective."""
    rows = ["| Icon | Item | Type | Base AC | Durability | Buy | Sell |",
            "|:---:|---|---|---:|---:|---:|---:|"]
    items = sorted(items, key=lambda it: (it.get("evasion") or 0,
                                          it.get("name", "")))
    for it in items:
        rows.append(
            f"| {icon_img(it)} | **{cell(it.get('name', it.get('id')))}** "
            f"| {type_label(it.get('item_type'))} "
            f"| {base_ac(it)} | {num(it.get('durability'))} "
            f"| {num(it.get('buy'))} | {num(it.get('sell'))} |"
        )
    return "\n".join(rows)


def general_table(items: list[dict]) -> str:
    """All general items in one table. Sorted by Type then name so
    potions, reagents, keys, ammo, etc. still cluster together."""
    rows = ["| Icon | Item | Type | Power | Effect | Charges | Stackable | Buy | Description |",
            "|:---:|---|---|---:|---|---:|:---:|---:|---|"]
    items = sorted(items, key=lambda it: (type_label(it.get("item_type")),
                                          it.get("name", "")))
    for it in items:
        rows.append(
            f"| {icon_img(it)} | **{cell(it.get('name', it.get('id')))}** "
            f"| {type_label(it.get('item_type'))} "
            f"| {num(it.get('power'))} | {cell(it.get('effect'))} "
            f"| {num(it.get('charges'))} | {num(bool(it.get('stackable')))} "
            f"| {num(it.get('buy'))} | {cell(it.get('description'))} |"
        )
    return "\n".join(rows)


TABLE_FOR = {"weapons": weapon_table, "armors": armor_table, "general": general_table}


# ── Assemble the section ─────────────────────────────────────────────

def build_section(items: list[dict]) -> str:
    # One table per category — all weapons together, all armor together,
    # everything else under General. The per-row `Type` column preserves
    # the item-kind detail the old per-item_type tables carried.
    buckets: dict[str, list[dict]] = {}
    for it in items:
        # Normalise case so a stray "General" buckets with "general".
        cat = (it.get("category") or "general").lower()
        buckets.setdefault(cat, []).append(it)

    intro = (
        "Items are grouped by category — every weapon in one table, all "
        "armor in another, and everything else under General. The **Type** "
        "column names the item kind. **Weapons** list their **Base Damage** — "
        "the dice the weapon rolls before the wielder's Strength/Dexterity "
        "modifier and any magical Damage Bonus — with all melee weapons "
        "first, then all ranged weapons, each ordered weakest to strongest. "
        "**Armor** lists **Base AC**, the Armor Class a typical adventurer "
        "has while wearing it, ordered least to most protective."
    )

    out = [f"## Items\n\n{intro}\n"]
    # Fixed, readable order: weapons, then armor, then general. Any
    # unexpected category falls in after these.
    headings = [("weapons", "Weapons"), ("armors", "Armor"),
                ("general", "General Items")]
    seen = {c for c, _ in headings}
    for cat, label in headings:
        group = buckets.get(cat)
        if not group:
            continue
        builder = TABLE_FOR.get(cat, general_table)
        out.append(f"\n### {label}\n")
        out.append(builder(group))
        out.append("")
    for cat in sorted(buckets):
        if cat in seen:
            continue
        out.append(f"\n### {cat.title()}\n")
        out.append(general_table(buckets[cat]))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    items = json.loads(ITEMS_PATH.read_text())["items"]
    section = build_section(items)
    block = f"{BEGIN}\n\n{section}\n{END}"

    md = MANUAL_PATH.read_text()
    if BEGIN in md and END in md:
        pre = md[: md.index(BEGIN)]
        post = md[md.index(END) + len(END):]
        new = f"{pre}{block}{post}"
    else:
        # First run: replace the hand-written "## Items" section, from its
        # heading up to the next top-level "## " heading (## Monsters).
        m = re.search(r"^## Items\b", md, flags=re.MULTILINE)
        if not m:
            raise SystemExit(
                "Could not find item markers or a '## Items' heading in "
                "manual.md — add the markers manually once."
            )
        start = m.start()
        nxt = re.search(r"^## ", md[m.end():], flags=re.MULTILINE)
        end = m.end() + nxt.start() if nxt else len(md)
        new = f"{md[:start]}{block}\n\n{md[end:]}"

    if new != md:
        MANUAL_PATH.write_text(new)
        n = len(items)
        print(f"build-items: wrote {n} items to manual.md")
    else:
        print("build-items: manual.md already up to date.")


if __name__ == "__main__":
    main()
