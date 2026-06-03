#!/usr/bin/env python3
"""Guess a category for each processed sprite from its filename.

Heuristic (it's a guess — meant for human review, not ground truth):

  category = "character"  -> a humanoid adventurer: a playable-style RACE
             (human / elf / gnome / halfling / "race" placeholder / people /
             female / barbarian) usually paired with a CLASS word. These are
             the best candidates for character-class / party / NPC sprites.

  category = "npc"        -> a humanoid in a CIVILIAN role (farmer, beggar,
             smithy, guard, jester, king, child, ...). Townsfolk, not fighters.

  category = "monster"    -> everything else: creatures (dragon, skeleton,
             eagle, ...) AND the classic monster-humanoids (orc, kobold,
             troll, ogre, goblin) even when they carry a class word.

Also emits, per sprite: family (base creature/race), guessed class, guessed
race, and the colour/variant tokens.
"""
import glob, os, re, csv
from collections import defaultdict, Counter

CLASS = {
    "fighter", "figher", "mage", "priest", "thief", "ranger", "paladin",
    "druid", "ninja", "archer", "assasin", "assassin", "barbarian",
    "warrior", "monk", "cleric", "wizard", "knight",
}
CIVILIAN = {
    "beggar", "farmer", "smithy", "jester", "guard", "drunk", "bodybuilder",
    "child", "hunchback", "primitive", "old", "man", "blond", "caped",
    "clothed", "beast", "king", "lord", "smith", "stick",
}
PLAYABLE_RACES = {
    "race", "human", "elf", "gnome", "halfling", "half", "people",
    "female", "dwarf", "barbarian",
}
MONSTER_HUMANOIDS = {"orc", "kobold", "troll", "ogre", "goblin", "gnoll"}
COLORS = {
    "blue", "brown", "grey", "gray", "red", "green", "silver", "orange",
    "purple", "pink", "white", "black", "gold", "yellow", "yello", "teal",
    "bronze", "stone", "magenta", "rainbow", "dark", "light",
}

def base(tok):  # strip trailing digits ("fighter33" -> "fighter")
    return re.sub(r"\d+$", "", tok)

def categorize(name):
    toks = [base(t) for t in name.split("_") if t]
    first = toks[0] if toks else name
    cls = next((t for t in toks if t in CLASS), "")
    civ = next((t for t in toks if t in CIVILIAN), "")
    variant = "_".join(t for t in toks if t in COLORS)

    if first in PLAYABLE_RACES:
        if cls:
            cat = "character"
        elif civ:
            cat = "npc"
        else:
            cat = "npc"          # generic person (human_blond, female_clothed)
        race = first
    elif first in MONSTER_HUMANOIDS:
        cat = "monster"          # enemy humanoid, even if it has a class
        race = first
    else:
        cat = "monster"
        race = ""
    return cat, first, race, cls, variant

def main():
    files = sorted(os.path.basename(p)[:-4]
                   for p in glob.glob("resources/processed_sprites/*.png"))
    rows = []
    by_cat = Counter()
    fam_by_cat = defaultdict(Counter)
    for n in files:
        cat, fam, race, cls, variant = categorize(n)
        rows.append([n, cat, fam, race, cls, variant])
        by_cat[cat] += 1
        fam_by_cat[cat][fam] += 1

    out_csv = "resources/sprite_categories.csv"
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sprite", "category", "family", "race", "class", "variant"])
        w.writerows(rows)

    print("=== category totals ===")
    for c, n in by_cat.most_common():
        print(f"{n:5d}  {c}")
    print()
    for cat in ("character", "npc", "monster"):
        fams = fam_by_cat[cat]
        print(f"=== {cat}: {sum(fams.values())} sprites, "
              f"{len(fams)} families ===")
        for fam, n in fams.most_common(30):
            print(f"  {n:4d}  {fam}")
        print()
    # class breakdown within characters
    cls_counts = Counter(r[4] for r in rows if r[1] == "character" and r[4])
    print("=== character class breakdown ===")
    for c, n in cls_counts.most_common():
        print(f"  {n:4d}  {c}")
    print(f"\nwrote {out_csv} ({len(rows)} rows)")

if __name__ == "__main__":
    main()
