#!/usr/bin/env python3
"""Append draft monster records for the newly-wired monster sprites.

Stats are calibrated to the existing default catalog's difficulty tiers
(easy hp~6-15 ... boss hp~125). Each entry sets a sensible base from its
difficulty tier, then applies light per-creature flavor (bats are fast,
golems tanky, dragons hit hard). These are DRAFTS meant for tuning.

Fields match the existing schema exactly (see giant_rat / goblin).
"""
import json

PALPATH = "web/public/modules/default/monsters.json"

# Base stat block per difficulty tier.
TIER = {
    "easy":   dict(hp=10, ac=12, attack_bonus=2, dd=1, ds=4, db=0, xp=20,  gmin=2,  gmax=8,   move=8, s=9,  d=13, c=10, i=4,  w=10),
    "normal": dict(hp=22, ac=13, attack_bonus=3, dd=1, ds=8, db=1, xp=45,  gmin=5,  gmax=18,  move=7, s=12, d=12, c=12, i=8,  w=10),
    "hard":   dict(hp=45, ac=15, attack_bonus=4, dd=2, ds=6, db=2, xp=100, gmin=15, gmax=45,  move=6, s=16, d=11, c=15, i=9,  w=11),
    "deadly": dict(hp=80, ac=17, attack_bonus=6, dd=3, ds=8, db=0, xp=175, gmin=40, gmax=110, move=7, s=18, d=12, c=17, i=11, w=12),
    "boss":   dict(hp=125,ac=18, attack_bonus=6, dd=4, ds=8, db=0, xp=335, gmin=120,gmax=300, move=6, s=20, d=12, c=18, i=14, w=14),
}

# (sprite, id, name, difficulty, undead, humanoid, overrides)
M = [
    # ── easy ──
    ("bat_grey",      "cave_bat",        "Cave Bat",          "easy",  0,0, dict(move=12, d=16, hp=8)),
    ("beetle_red",    "fire_beetle",     "Fire Beetle",       "easy",  0,0, dict(ac=14, hp=12)),
    ("centipede_red", "giant_centipede", "Giant Centipede",   "easy",  0,0, dict(d=15)),
    ("eagle",         "wild_eagle",      "Wild Eagle",        "easy",  0,0, dict(move=12, d=15)),
    # ── normal ──
    ("skeleton",      "skeleton_warrior","Skeleton Warrior",  "normal",1,1, dict(ac=14)),
    ("orc",           "orc_raider",      "Orc Raider",        "normal",0,1, dict(hp=26, s=14)),
    ("snake_blue",    "coil_serpent",    "Coil Serpent",      "normal",0,0, dict(d=15, i=3)),
    ("spider_red",    "crimson_spider",  "Crimson Spider",    "normal",0,0, dict(d=15, i=3)),
    ("imp",           "imp",             "Imp",               "normal",0,1, dict(move=9, d=14, i=12)),
    ("kobold_mage",   "kobold_shaman",   "Kobold Shaman",     "normal",0,1, dict(i=13, w=12)),
    ("ghost_red",     "restless_spirit", "Restless Spirit",   "normal",1,0, dict(ac=14, move=8)),
    ("lizard_red",    "fire_lizard",     "Fire Lizard",       "normal",0,0, dict(hp=26, i=3)),
    ("ooze_blue",     "blue_ooze",       "Blue Ooze",         "normal",0,0, dict(ac=10, d=6, move=4, i=1)),
    # ── hard ──
    ("troll_dark",        "dark_troll",     "Dark Troll",        "hard", 0,1, dict(hp=55, s=18)),
    ("ogre_lord",         "ogre_lord",      "Ogre Lord",         "hard", 0,1, dict(hp=55, s=18)),
    ("golem_blue",        "ice_golem",      "Ice Golem",         "hard", 0,0, dict(ac=16, c=18, d=7, move=5, i=1)),
    ("yeti_blue",         "frost_yeti",     "Frost Yeti",        "hard", 0,0, dict(hp=50)),
    ("mummy_red",         "cursed_mummy",   "Cursed Mummy",      "hard", 1,1, dict(move=5)),
    ("gargoyle_red",      "gargoyle",       "Gargoyle",          "hard", 0,0, dict(ac=16, move=8)),
    ("medusa",            "medusa",         "Medusa",            "hard", 0,1, dict(d=14, i=12, w=13)),
    ("dinosaur_beast_red","raptor_beast",   "Raptor Beast",      "hard", 0,0, dict(move=8, d=14, i=3)),
    ("vampire2",          "vampire",        "Vampire",           "hard", 1,1, dict(hp=55, ac=16, i=13)),
    # ── deadly ──
    ("dragon_spirit",     "spirit_dragon",  "Spirit Dragon",     "deadly",0,0, dict(ds=12, i=12)),
    ("drake_spirit",      "spirit_drake",   "Spirit Drake",      "deadly",0,0, dict(hp=70)),
    ("giant_fire",        "fire_giant",     "Fire Giant",        "deadly",0,1, dict(hp=95, s=20)),
    ("hydra3_head_red",   "hydra_crimson",  "Crimson Hydra",     "deadly",0,0, dict(hp=100, dd=3, ds=6)),
    ("angel_red",         "fallen_seraph",  "Fallen Seraph",     "deadly",0,1, dict(ac=18, move=9, w=15)),
    # ── boss ──
    ("demon_major_lord",  "demon_lord",     "Demon Lord",        "boss",  0,1, dict()),
]


def build(sprite, mid, name, diff, undead, humanoid, ov):
    t = dict(TIER[diff])
    t.update(ov)
    return {
        "id": mid, "name": name,
        "undead": bool(undead), "humanoid": bool(humanoid),
        "hp": t["hp"], "ac": t["ac"], "attack_bonus": t["attack_bonus"],
        "damage_dice": t["dd"], "damage_sides": t["ds"], "damage_bonus": t["db"],
        "xp_reward": t["xp"], "gold_min": t["gmin"], "gold_max": t["gmax"],
        "sprite": f"monster/{sprite}.png",
        "move_range": t["move"], "post_attack_move": 0, "battle_scale": 1,
        "difficulty": diff,
        "strength": t["s"], "dexterity": t["d"], "constitution": t["c"],
        "intelligence": t["i"], "wisdom": t["w"],
    }


def main():
    doc = json.load(open(PALPATH))
    existing_ids = {m["id"] for m in doc["monsters"]}
    added, skipped = [], []
    for sprite, mid, name, diff, ud, hu, ov in M:
        if mid in existing_ids:
            skipped.append(mid); continue
        doc["monsters"].append(build(sprite, mid, name, diff, ud, hu, ov))
        existing_ids.add(mid); added.append((mid, diff))
    json.dump(doc, open(PALPATH, "w"), indent=2)
    print(f"added {len(added)} monster records (skipped {len(skipped)}: {skipped})")
    from collections import Counter
    print("by difficulty:", dict(Counter(d for _, d in added)))
    print("total monsters now:", len(doc["monsters"]))


if __name__ == "__main__":
    main()
