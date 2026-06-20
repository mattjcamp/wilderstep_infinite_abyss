#!/usr/bin/env python3
"""Rebuild the manuals in one command.

Runs every generator in order:

  1. build_class_gallery.py    — refreshes the Class Gallery + comparison
  2. build_races_abilities.py  — refreshes the Races + Abilities tables
  3. build_items.py            — refreshes the Items section
  4. build_monsters.py         — refreshes the Monsters section
  5. build_spells.py           — refreshes the Spells section
     (1–5 each rewrite only their own marked block(s) in manual.md)
  6. build_manual.py           — renders manual.md → manual.pdf
  7. build_dm_manual.py        — renders dm_manual.md → dm_manual.pdf
     (the Dungeon Master's Manual is hand-written — no generators feed
     it, so it's just a render step)

Run:  python3 docs/manual/build_all.py

Each step is its own script (still runnable on its own); this just chains
them so a full refresh is a single command. Stops on the first failure.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

STEPS = [
    "build_class_gallery.py",
    "build_races_abilities.py",
    "build_items.py",
    "build_monsters.py",
    "build_spells.py",
    "build_manual.py",
    "build_dm_manual.py",
]


def main() -> None:
    for script in STEPS:
        print(f"\n── {script} " + "─" * (40 - len(script)))
        subprocess.run([sys.executable, str(HERE / script)], check=True)
    print("\nmanual: full rebuild complete "
          "(manual.md + manual.pdf, dm_manual.md + dm_manual.pdf).")


if __name__ == "__main__":
    main()
