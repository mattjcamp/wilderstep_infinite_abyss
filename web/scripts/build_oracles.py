"""Build the Elder God oracles for Varnfell, following oracle_1 (Time).

Each god gets:
  oracle_<n>           12x12 ground ruin: archway (6,11) back to the
                       overworld, the god's two-tile ruined statue
                       (with its lore), a pit down to the basement.
  oracle_<n>_basement  12x12 lower level: landing under the pit, a
                       ladder back up.
plus an overworld ruins tile linking in, and a lore entry.

Usage:  python3 build_oracles.py MODULE_DIR [--apply]
Without --apply it only validates and prints the maps.
"""
import json
import sys
from collections import deque

MOD = sys.argv[1]
APPLY = "--apply" in sys.argv

maps_path = f"{MOD}/varnfell/maps.json"
maps_doc = json.load(open(maps_path))
MAPS = {m["id"]: m for m in maps_doc["maps"]}

TILES = {}
for m in ("default", "varnfell"):
    for t in json.load(open(f"{MOD}/{m}/map_tiles.json"))["map_tiles"]:
        TILES[t["id"]] = t


def sprite(tile_id):
    return TILES[tile_id]["sprite"]


def make_cell(tile_id, bg=None, **extra):
    if tile_id not in TILES:
        raise SystemExit(f"unknown tile {tile_id}")
    c = dict(TILES[tile_id])
    if bg is not None:
        c["background_sprite"] = sprite(bg)
    for k, v in extra.items():
        c[k] = v
    return c


# ── Shared legend pieces ───────────────────────────────────────────
STONE_FENCE = {
    "h": "town_fence_stone_straight_h",
    "v": "town_fence_stone_straight_v",
    "1": "town_fence_stone_bend_tl",
    "2": "town_fence_stone_bend_tr",
    "3": "town_fence_stone_bend_bl",
    "4": "town_fence_stone_bend_br",
}


def walls(family, bottom="top"):
    """Basement wall legend for a tile family."""
    w = {
        "<": f"{family}_wall_corner_tl",
        ">": f"{family}_wall_corner_tr",
        "T": f"{family}_wall_top",
        "L": f"{family}_wall_left",
        "R": f"{family}_wall_right",
        "U": f"{family}_ladder_up",
    }
    if bottom == "bottom":
        w.update({"3": f"{family}_wall_corner_bl", "4": f"{family}_wall_corner_br",
                  "W": f"{family}_wall_bottom"})
    return w


# ── The gods ───────────────────────────────────────────────────────
# Per map: rows (12 x 12), legend char -> tile id or (tile id, bg tile).
# Special chars: '@' exit link to overworld (ground), 'S'/'s' statue
# top/bottom, 'P' pit down (ground), 'U' ladder up (basement).
GODS = [
    dict(
        god="space", name="Space", n=2, overworld=(31, 1),
        ground=dict(
            floor="dungeon_floor_smooth", pit="dungeon_pit",
            rows=[
                "............",
                "...o..o..o..",
                "..,,,,,,,,..",
                ".o,*,,S,*,o.",
                "..,,,,s,,,..",
                ".o,*,,,,P,o.",
                "..,,,*,,,,..",
                "...o.,,.o...",
                ".....,,.....",
                "..r..,,.....",
                ".....,,..r..",
                "..hhhh@hhh..",
            ],
            legend={".": "grass", ",": "dungeon_floor_smooth", "*": "cave_floor_crystal",
                    "o": ("dungeon_pillar", "grass"), "r": ("dungeon_rubble", "grass"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTCTTTTCTT>",
                "L,,,,,,,,,,R",
                "L,*,,,,,,*,R",
                "L,,,,,,,,,,R",
                "L,,,*,,*,,,R",
                "L,,,,,,,,,,R",
                "L,*,,,p,,*,R",
                "L,,,,,,,,,,R",
                "C,,b,,,,,,,R",
                "L,*,,,,,*,,R",
                "L,,,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("cave"), ",": "cave_floor_slab", "*": "cave_floor_crystal",
                    "C": "cave_wall_crystals", "b": ("object_bones", "cave_floor_slab"),
                    "p": ("object_pots", "cave_floor_slab")},
        ),
    ),
    dict(
        god="fire", name="Fire", n=3, overworld=(70, 48),
        ground=dict(
            floor="dungeon_floor_brick", pit="dungeon_pit",
            rows=[
                "tt........tt",
                "t.1hhhhhh2.t",
                "..vB,,,,Bv..",
                "..v,;,S;,v..",
                "..v,,;s,;v..",
                "..vB;,,,Bv..",
                "..v,,P;,,v..",
                "..r;,,,;,v..",
                "..v,,;,,,v..",
                "..vB,,,,Bv..",
                "..v,,,,,,v.r",
                "..3hhh@hh4..",
            ],
            legend={".": "grass", ",": "dungeon_floor_brick", ";": "dungeon_floor_pebbles",
                    "B": ("object_brazier", "dungeon_floor_brick"), "t": "overworld_pine_forest",
                    "r": ("dungeon_rubble", "grass"), "@": "town_fence_stone_archway",
                    **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTFTTTTFTT>",
                "L,,,,,,,,,,R",
                "L,B,,,,,,B,R",
                "L,,,,,,,,,,R",
                "L,,,;;;;,,,R",
                "L,,,;##;,,,R",
                "L,,,;;,;,,,R",
                "L,b,,,,,,p,R",
                "L,,,,,,,,,,R",
                "L,B,,,,,,B,R",
                "L,,,,,,,,,UR",
                "3WWWWWWWWWW4",
            ],
            legend={**walls("deep_ones_hall", "bottom"), ",": "deep_ones_hall_floor_brick",
                    ";": "deep_ones_hall_floor_pebbles", "F": "deep_ones_hall_fireplace",
                    "#": "deep_ones_hall_pit_centre",
                    "B": ("object_brazier", "deep_ones_hall_floor_brick"),
                    "b": ("object_bones", "deep_ones_hall_floor_brick"),
                    "p": ("object_pots", "deep_ones_hall_floor_brick")},
        ),
    ),
    dict(
        god="water", name="Water", n=4, overworld=(1, 77),
        ground=dict(
            floor="dungeon_floor_cobble", pit="dungeon_pit",
            rows=[
                "~~~~~~~~~~~~",
                "~..........~",
                "~.~~~~~~~~.~",
                "~.~,,,S,,~.~",
                "~.~,b,s,,~.~",
                "~.~,,,,,P~.~",
                "~.~,,,,,,~.~",
                "~.~,o,,o,~.~",
                "~.~~~,,~~~.~",
                "~.....,....~",
                "~.....,....~",
                "~~~hhh@hhh~~",
            ],
            legend={".": "grass", "~": "water", ",": "dungeon_floor_cobble",
                    "b": ("object_bones", "dungeon_floor_cobble"),
                    "o": ("dungeon_pillar", "dungeon_floor_cobble"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTTTTTTTTT>",
                "L,,,~~~~,,,R",
                "L,;;~,,~;;,R",
                "L,;;~,,~;;,R",
                "L,,,,,,,,,,R",
                "L~~,,,,,,~~R",
                "L,,,,p,,,,,R",
                "L,;;~,,~;;,R",
                "L,;;~,,~;;,R",
                "L,,,~~~~,b,R",
                "L,,,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("dungeon"), ",": "dungeon_floor_cobble", ";": "dungeon_floor_grate",
                    "~": "water", "p": ("object_pots", "dungeon_floor_cobble"),
                    "b": ("object_bones", "dungeon_floor_cobble")},
        ),
    ),
    dict(
        god="air", name="Air", n=5, overworld=(24, 48),
        ground=dict(
            floor="dungeon_floor_smooth", pit="dungeon_pit",
            rows=[
                "............",
                "..o.....o...",
                "....;;;;....",
                "...;;,S,;;..",
                ".o.;,,s,,;o.",
                "...;,,,,P;..",
                "....;,,,;...",
                "..r..;,;..o.",
                "......,.....",
                ".o....,...r.",
                "......,.....",
                "..h.hh@h.h..",
            ],
            legend={".": "grass", ",": "dungeon_floor_smooth", ";": "dungeon_floor_pebbles",
                    "o": ("dungeon_pillar", "grass"), "r": ("dungeon_rubble", "grass"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTTTTTTTTT>",
                "L,,,,,,,,,,R",
                "L,XX,,,,XX,R",
                "L,XX,,,,XX,R",
                "L,,,,,,,,,,R",
                "L,,,,,,,,,,R",
                "L,,,XXXX,,,R",
                "L,b,XXXX,,,R",
                "L,,,,,,,,p,R",
                "L,XX,,,,,,,R",
                "L,XX,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("cave"), ",": "cave_floor_gravel", "X": "cave_pit_centre",
                    "b": ("object_bones", "cave_floor_gravel"),
                    "p": ("object_pots", "cave_floor_gravel")},
        ),
    ),
    dict(
        god="earth", name="Earth", n=6, overworld=(69, 57),
        ground=dict(
            floor="cave_floor_rock", pit="cave_pit",
            rows=[
                "<TTTTTTTTTT>",
                "L,,m,,,,m,,R",
                "L,,,,,,,,,,R",
                "L,m,,,S,,m,R",
                "L,,,,,s,,,,R",
                "L,,;,,,,P,,R",
                "L,,;;,,,,,,R",
                "Lm,,,,,,,m,R",
                "L,,,r,,,,,,R",
                "L,m,,,,,,m,R",
                "L,,,,,,,,,,R",
                "TTTTTT@TTTTT",
            ],
            legend={"<": "cave_wall_corner_tl", ">": "cave_wall_corner_tr", "T": "cave_wall_top",
                    "L": "cave_wall_left", "R": "cave_wall_right", ",": "cave_floor_rock",
                    ";": "cave_floor_gravel", "m": ("cave_stalagmite", "cave_floor_rock"),
                    "r": ("cave_rubble", "cave_floor_rock"), "@": "cave_wall_exit"},
        ),
        basement=dict(
            rows=[
                "<TTKTTTTTKT>",
                "L,,,,,,,,,,R",
                "L,r,,,;;,,,R",
                "L,,,,;;;;,,R",
                "L,,m,,;;,,,R",
                "L,,,,,,,,,,R",
                "L,m,,,,,,m,R",
                "L,,,,b,,,,,R",
                "L,,r,,,,,,,R",
                "L,,,,,,,r,,R",
                "L,p,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("cave"), ",": "cave_floor_dirt", ";": "cave_floor_crystal",
                    "K": "cave_wall_crack", "m": ("cave_stalagmite", "cave_floor_dirt"),
                    "r": ("cave_rubble", "cave_floor_dirt"),
                    "b": ("object_bones", "cave_floor_dirt"),
                    "p": ("object_pots", "cave_floor_dirt")},
        ),
    ),
    dict(
        god="birth", name="Birth", n=7, overworld=(44, 42),
        ground=dict(
            floor="dungeon_floor_pebbles", pit="dungeon_pit",
            rows=[
                "O.T....T..O.",
                ".1hhhhhhhh2.",
                ".vq..;;..qv.",
                ".v.T.;S.T.v.",
                ".v..;;s;..v.",
                ".vq.;;;;P.v.",
                ".v..;..;..v.",
                ".vW.;..;.Tv.",
                ".vw.;;;;..v.",
                ".v.T..;..qv.",
                ".v....;...v.",
                ".3hhhh@hhh4.",
            ],
            legend={".": "grass", ";": "dungeon_floor_pebbles", "T": ("tree", "grass"),
                    "O": ("overworld_tree_oak", "grass"),
                    "q": ("manor_potted_plant", "grass"), "W": ("town_well_r0c0", "grass"),
                    "w": ("town_well_r1c0", "grass"), "@": "town_fence_stone_archway",
                    **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTTYTTYTTT>",
                "L,,,,,,,,,,R",
                "L,q,,,,,,q,R",
                "L,,;;,,;;,,R",
                "L,,;;,,;;,,R",
                "L,,,,,,,,,,R",
                "L,,,,p,,,,,R",
                "L,,;;,,;;,,R",
                "L,,;;,,;;,,R",
                "L,q,,,,,,q,R",
                "L,,,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("manor"), ",": "manor_floor_planks", ";": "cave_floor_moss",
                    "Y": "manor_wall_tapestry",
                    "q": ("manor_potted_plant", "manor_floor_planks"),
                    "p": ("object_pots", "manor_floor_planks")},
        ),
    ),
    dict(
        god="death", name="Death", n=8, overworld=(88, 62),
        ground=dict(
            floor="dungeon_floor_cobble", pit="dungeon_pit",
            rows=[
                "tt..t..t..tt",
                "t1hhhhhhhh2t",
                ".vg.g.,g.gv.",
                ".v...,S,..v.",
                ".vg.g,s,g.v.",
                ".v...,,,P.v.",
                ".vg.g.,.g.v.",
                ".v....,b..v.",
                ".vg.g.,.g.v.",
                ".v....,...v.",
                ".vb...,..gv.",
                ".3hhhh@hhh4.",
            ],
            legend={".": "grass", ",": "dungeon_floor_cobble", "t": "overworld_pine_forest",
                    "g": ("town_gravestone", "grass"), "b": ("object_bones", "grass"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTTTTTTTTT>",
                "L,g,g,,g,g,R",
                "L,,,,,,,,,,R",
                "L,b,,,,,,b,R",
                "L,,,,,,,,,,R",
                "L,g,g,,,,,,R",
                "L,,,,,,,,,,R",
                "L,g,g,,g,g,R",
                "L,,,b,,,,,,R",
                "L,g,g,,g,g,R",
                "L,,,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("dungeon"), ",": "dungeon_floor_flagstone",
                    "g": ("town_gravestone", "dungeon_floor_flagstone"),
                    "b": ("object_bones", "dungeon_floor_flagstone")},
        ),
    ),
    dict(
        god="love", name="Love", n=9, overworld=(2, 38),
        ground=dict(
            floor="manor_floor_herringbone", pit="dungeon_pit",
            rows=[
                "..O......O..",
                ".1hhhhhhhh2.",
                ".v,q,,,,q,v.",
                ".v,,,,S,,,v.",
                ".v,e,,s,e,v.",
                ".v,,,,,,P,v.",
                ".v,,,W,,,,v.",
                ".v,q,w,,q,v.",
                ".v,,,,,,,,v.",
                ".v,e,,,,e,v.",
                ".v,,,,,,,,v.",
                ".3hhhh@hhh4.",
            ],
            legend={".": "grass", ",": "manor_floor_herringbone",
                    "O": ("overworld_tree_oak", "grass"),
                    "q": ("manor_potted_plant", "manor_floor_herringbone"),
                    "e": ("object_bench_2", "manor_floor_herringbone"),
                    "W": ("town_well_r0c0", "manor_floor_herringbone"),
                    "w": ("town_well_r1c0", "manor_floor_herringbone"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTYTTTTYTT>",
                "L,,,,G,,,,,R",
                "L,q,,,,,,q,R",
                "L,,1aaaa2,,R",
                "L,,lccccr,,R",
                "L,,3bbbb4,,R",
                "L,,,,,,,,,,R",
                "L,q,,,,,,q,R",
                "L,,,,p,,,,,R",
                "L,,,,,,,,,,R",
                "L,,,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("manor"), ",": "manor_floor_carpet", "Y": "manor_wall_tapestry",
                    "G": ("manor_grand_chair", "manor_floor_carpet"),
                    "q": ("manor_potted_plant", "manor_floor_carpet"),
                    "p": ("object_pots", "manor_floor_carpet"),
                    "1": "manor_rug_corner_tl", "a": "manor_rug_top", "2": "manor_rug_corner_tr",
                    "l": "manor_rug_left", "c": "manor_rug_centre", "r": "manor_rug_right",
                    "3": "manor_rug_corner_bl", "b": "manor_rug_bottom", "4": "manor_rug_corner_br"},
        ),
    ),
    dict(
        god="hate", name="Hate", n=10, overworld=(38, 22),
        ground=dict(
            floor="dungeon_floor_pebbles", pit="dungeon_pit",
            rows=[
                "t...r....t..",
                ".1hh.hr.hh2.",
                ".v;;r;;;;;v.",
                ".r;b;;S;;;r.",
                ".v;;;rs;b;v.",
                ".v;r;;;;P;..",
                ".r;;;b;;;;v.",
                ".v;;;;;r;;v.",
                "..;b;;;;;;r.",
                ".v;;r;;;b;v.",
                ".v;;;;;;;;v.",
                ".3hh.h@hhr4.",
            ],
            legend={".": "grass", ";": "dungeon_floor_pebbles", "t": "overworld_pine_forest",
                    "r": ("dungeon_rubble", "dungeon_floor_pebbles"),
                    "b": ("object_bones", "dungeon_floor_pebbles"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTTTTTTTTT>",
                "L;;;;;;;;;;R",
                "L;b;;r;;;b;R",
                "L;;;;;;;;;;R",
                "L;;r;;;;r;;R",
                "L;;;;;;;;;;R",
                "L;b;;Z;;;;;R",
                "L;;;;;;;r;;R",
                "L;r;;;;;;;;R",
                "L;;;;b;;;;;R",
                "L;;;;;;;;;UR",
                "3WWWWWWWWWW4",
            ],
            legend={**walls("deep_ones_hall", "bottom"), ";": "deep_ones_hall_floor_grate",
                    "r": ("deep_ones_hall_rubble", "deep_ones_hall_floor_grate"),
                    "b": ("object_bones", "deep_ones_hall_floor_grate"),
                    "Z": ("dungeon_throne", "deep_ones_hall_floor_grate")},
        ),
    ),
    dict(
        god="good", name="Good", n=11, overworld=(26, 69),
        ground=dict(
            floor="manor_floor_marble", pit="dungeon_pit",
            rows=[
                "..O......O..",
                ".1hhhhhhhh2.",
                ".vB,c,,c,Bv.",
                ".v,,,,S,,,v.",
                ".vc,,,s,,cv.",
                ".v,,,,|,P,v.",
                ".vc,,,|,,cv.",
                ".v,,,,|,,,v.",
                ".vB,c,|,cBv.",
                ".v,,,,|,,,v.",
                ".v,,,,|,,,v.",
                ".3hhhh@hhh4.",
            ],
            legend={".": "grass", ",": "manor_floor_marble", "|": "manor_rug_runner",
                    "O": ("overworld_tree_oak", "grass"),
                    "c": ("manor_column", "manor_floor_marble"),
                    "B": ("object_brazier", "manor_floor_marble"),
                    "@": "town_fence_stone_archway", **STONE_FENCE},
        ),
        basement=dict(
            rows=[
                "<TTXTTTTXTT>",
                "L,,,,,,,,,,R",
                "L,N,,,,,,N,R",
                "L,,,,,,,,,,R",
                "L,,,,,,,,,,R",
                "L,,,,,,,,,,R",
                "L,N,,,,,,N,R",
                "L,,,,k,,,,,R",
                "L,,,,,,,,,,R",
                "L,N,,,,,,N,R",
                "L,,,,,,,,,UR",
                "TTTTTTTTTTTT",
            ],
            legend={**walls("manor"), ",": "manor_floor_marble", "X": "manor_wall_window",
                    "N": ("object_lantern", "manor_floor_marble"),
                    "k": ("object_book_closed", "manor_floor_marble")},
        ),
    ),
    dict(
        god="evil", name="Evil", n=12, overworld=(45, 66),
        ground=dict(
            floor="deep_ones_hall_floor", pit="deep_ones_hall_pit",
            rows=[
                "ttt......ttt",
                ".<TTTTTTTT>.",
                ".L,o,,Z,o,R.",
                ".L,,,,S,,,R.",
                ".L,o,,s,o,R.",
                ".L,,,,,,P,R.",
                ".L,o,,,,o,R.",
                ".LJ,,;;,,JR.",
                ".L,o,;;,o,R.",
                ".L,,,;;,,,R.",
                ".L,,,;;,,,R.",
                ".3WWWW@WWW4.",
            ],
            legend={".": "grass", "t": "overworld_pine_forest", ",": "deep_ones_hall_floor",
                    ";": "deep_ones_hall_floor_alt",
                    "<": "deep_ones_hall_wall_corner_tl", ">": "deep_ones_hall_wall_corner_tr",
                    "T": "deep_ones_hall_wall_top", "L": "deep_ones_hall_wall_left",
                    "R": "deep_ones_hall_wall_right", "3": "deep_ones_hall_wall_corner_bl",
                    "4": "deep_ones_hall_wall_corner_br", "W": "deep_ones_hall_wall_bottom",
                    "o": ("deep_ones_hall_pillar", "deep_ones_hall_floor"),
                    "Z": ("deep_ones_hall_throne", "deep_ones_hall_floor"),
                    "J": ("object_torch", "deep_ones_hall_floor"),
                    "@": "deep_ones_hall_wall_archway"},
        ),
        basement=dict(
            rows=[
                "<TTTTTTTTTT>",
                "L,,,,,,,,,,R",
                "L,b1tt2,,,,R",
                "L,,lccr,,,,R",
                "L,,yooz,,,,R",
                "L,,,,,,,,,,R",
                "L,,,,Z,,,,,R",
                "L,,,,,,,b,,R",
                "L,p,,,,,,,,R",
                "L,,,,,,,,,,R",
                "L,,,,,,,,,UR",
                "3WWWWWWWWWW4",
            ],
            legend={"<": "deep_ones_hall_wall_corner_tl", ">": "deep_ones_hall_wall_corner_tr",
                    "T": "deep_ones_hall_wall_top", "L": "deep_ones_hall_wall_left",
                    "R": "deep_ones_hall_wall_right", "3": "deep_ones_hall_wall_corner_bl",
                    "4": "deep_ones_hall_wall_corner_br", "W": "deep_ones_hall_wall_bottom",
                    "U": "deep_ones_hall_ladder_up", ",": "deep_ones_hall_floor_plain",
                    "1": "deep_ones_hall_pit_corner_tl", "t": "deep_ones_hall_pit_top",
                    "2": "deep_ones_hall_pit_corner_tr", "l": "deep_ones_hall_pit_left",
                    "c": "deep_ones_hall_pit_centre", "r": "deep_ones_hall_pit_right",
                    "o": "deep_ones_hall_pit_bottom",
                    "y": "deep_ones_hall_pit_corner_bl", "z": "deep_ones_hall_pit_corner_br",
                    "Z": ("deep_ones_hall_throne", "deep_ones_hall_floor_plain"),
                    "b": ("object_bones", "deep_ones_hall_floor_plain"),
                    "p": ("object_pots", "deep_ones_hall_floor_plain")},
        ),
    ),
]

LORE = {
    "time": ("The Elder God of Time",
             ["Time was the second of the Elders to wake, and the first to count. It gave the dead god's world a before and an after, and with them the promise that everything would end.",
              "Pilgrims left hourglasses at its feet. The sand in every one of them has long since run out."]),
    "space": ("The Elder God of Space",
              ["When the Varn fell there was nowhere for its body to land. Space woke first and made room, and in that room the world began.",
               "The pillars here once marked the turning of the stars. Now they only lean."]),
    "fire": ("The Elder God of Fire",
             ["Fire was born from the last heat of the Varn, banked deep beneath the world. It taught the first people warmth, and the first armies how to burn.",
              "Its braziers were tended for a thousand years. They all went out on the same night."]),
    "water": ("The Elder God of Water",
              ["Water came to wash the wound the Varn left in the world. Its priests said every river is still trying to reach the place where the god fell.",
               "The moat around this shrine has never once run dry."]),
    "air": ("The Elder God of Air",
            ["Air is the breath the Varn never took. It fills the hollow of the world and carries every word ever spoken up to the sky, where nothing answers.",
             "Offerings here were whispered, never spoken aloud."]),
    "earth": ("The Elder God of Earth",
              ["Earth is the body of the Varn itself, and its Elder was the most patient of them all. It asked nothing of its faithful but that they stay.",
               "The stone of this hall was never cut. It was asked to move, and it moved."]),
    "birth": ("The Elder God of Birth",
              ["Birth was the Elder who first dared to begin something new inside a dead god. Every seed and every child was counted among its works.",
               "Mothers once walked here barefoot to ask its blessing. The garden still grows without them."]),
    "death": ("The Elder God of Death",
              ["Death was the gentlest of the Elders and the least feared. It promised that nothing in Varnfell would have to endure forever.",
               "The graves here face downward, toward the Varn, so the dead can find their way home."]),
    "love": ("The Elder God of Love",
             ["Love was the Elder of joining: friend to friend, kin to kin, oath to oath. Its priests wed kings and farmers alike and asked the same vow of both.",
              "Two names were carved on every stone of this court. Most have worn away."]),
    "hate": ("The Elder God of Hate",
             ["Hate was Love's twin, and the Elders never denied it. Where Love bound, Hate cut, and its priests taught that the world needed both.",
              "Some say the war of the gods began in this shrine. The broken walls do not argue."]),
    "good": ("The Elder God of Good",
             ["Good was the Elder of the right deed, freely chosen. It asked for no worship, only that its followers treat others as they would be treated.",
              "Its temple was the last to fall and the least damaged. Even its enemies were reluctant to break it."]),
    "evil": ("The Elder God of Evil",
             ["Evil was the Elder of the wrong deed, freely chosen, and of the hunger that makes the choice easy. Some whisper it is the last echo of the Dark the Varn destroyed.",
              "The throne behind this statue was never meant for a god. It was meant for whoever knelt the longest."]),
}

TIME_PIT = MAPS["oracle_1"]["grid"][5][3]      # template for the pit link cell
TIME_RUIN = MAPS["varnfell"]["grid"][68][2]    # template for the overworld ruins


def lore_id(god):
    return f"elder_god_{god}"


def build_grid(spec, god, kind, links):
    """kind: 'ground' | 'basement'. links: dict char -> link dict."""
    rows = spec["rows"]
    assert len(rows) == 12, (god, kind, len(rows))
    for i, r in enumerate(rows):
        assert len(r) == 12, (god, kind, i, r, len(r))
    legend = spec["legend"]
    grid = []
    for y, row in enumerate(rows):
        out = []
        for x, ch in enumerate(row):
            if ch == "S" or ch == "s":
                part = "r0c0" if ch == "S" else "r1c0"
                bg = spec["floor"]
                cell = make_cell(f"elder_statue_{god}_{part}", bg=bg, lore=lore_id(god))
            elif ch == "P":
                cell = dict(TIME_PIT)
                if spec["pit"] != "dungeon_pit":
                    cell = make_cell(spec["pit"], walkable=True)
                cell["link"] = links["P"]
            elif ch == "@":
                cell = make_cell(legend["@"], link=links["@"])
                if not cell.get("walkable"):
                    cell["walkable"] = True
            elif ch == "U":
                cell = make_cell(legend["U"], link=links["U"])
            else:
                if ch not in legend:
                    raise SystemExit(f"{god} {kind}: no legend for {ch!r} at {x},{y}")
                v = legend[ch]
                cell = make_cell(*v) if isinstance(v, tuple) else make_cell(v)
            out.append(cell)
        grid.append(out)
    return grid


def find(rows, ch):
    for y, r in enumerate(rows):
        x = r.find(ch)
        if x >= 0:
            return x, y
    raise SystemExit(f"missing {ch}")


new_maps = []
overworld_changes = []
problems = []

for g in GODS:
    god, n = g["god"], g["n"]
    gid, bid = f"oracle_{n}", f"oracle_{n}_basement"
    if gid in MAPS or bid in MAPS:
        raise SystemExit(f"{gid} already exists")
    grows, brows = g["ground"]["rows"], g["basement"]["rows"]
    px, py = find(grows, "P")
    ax, ay = find(grows, "@")
    ux, uy = find(brows, "U")
    # Ladder back up lands on the first plain floor cell beside the pit.
    land = None
    for dx, dy in ((0, 1), (-1, 0), (1, 0), (0, -1)):
        ch = grows[py + dy][px + dx]
        if ch in ",;.|*":
            land = (px + dx, py + dy)
            break
    assert land, (god, "no landing next to the pit")
    ox, oy = g["overworld"]
    links_g = {"@": {"map_id": "varnfell", "x": ox, "y": oy},
               "P": {"map_id": bid, "x": px, "y": py}}
    links_b = {"U": {"map_id": gid, "x": land[0], "y": land[1]}}
    ggrid = build_grid(g["ground"], god, "ground", links_g)
    bgrid = build_grid(g["basement"], god, "basement", links_b)
    title = f"Oracle of {g['name']}"
    tags = ["Oracle", f"Oracle: {title}"]
    new_maps.append({"id": gid, "name": title,
                     "description": f"The ruins of an ancient oracle to {g['name']}",
                     "tags": tags, "width": 12, "height": 12, "grid": ggrid})
    new_maps.append({"id": bid, "name": f"{title}, Basement", "tags": tags,
                     "width": 12, "height": 12, "grid": bgrid})
    overworld_changes.append((ox, oy, gid, ax, ay, title))

    # ── validation ──
    def walk(grid):
        return lambda x, y: 0 <= x < 12 and 0 <= y < 12 and grid[y][x].get("walkable")
    # basement landing must be walkable
    if not bgrid[py][px].get("walkable"):
        problems.append(f"{god}: basement landing {px},{py} not walkable")
    if not ggrid[land[1]][land[0]].get("walkable"):
        problems.append(f"{god}: ladder landing not walkable")
    # ground: from the archway entry, can reach the pit and stand next to the statue
    def reach(grid, start):
        W = walk(grid)
        seen = {start}
        q = deque([start])
        while q:
            x, y = q.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if (nx, ny) not in seen and W(nx, ny):
                    seen.add((nx, ny))
                    q.append((nx, ny))
        return seen
    rg = reach(ggrid, (ax, ay))
    if (px, py) not in rg:
        problems.append(f"{god}: pit not reachable from the archway")
    sx, sy = find(grows, "s")
    if not any((sx + dx, sy + dy) in rg for dx, dy in ((1, 0), (-1, 0), (0, 1))):
        problems.append(f"{god}: statue not reachable to read")
    rb = reach(bgrid, (px, py))
    if (ux, uy) not in rb:
        problems.append(f"{god}: ladder not reachable from the landing")
    # overworld target
    ow = MAPS["varnfell"]["grid"][oy][ox]
    if ow.get("link") or ow.get("dungeon") or ow.get("npc") or ow.get("spawn"):
        problems.append(f"{god}: overworld cell {ox},{oy} already used")
    if not ow.get("walkable"):
        problems.append(f"{god}: overworld cell {ox},{oy} not walkable ({ow.get('id')})")

for m in new_maps:
    print("=====", m["id"], m["name"])
    for y, row in enumerate(m["grid"]):
        print(f"{y:2d} " + "".join(
            "@" if c.get("link") and c["link"]["map_id"] == "varnfell"
            else "v" if c.get("link") and "basement" in c["link"]["map_id"]
            else "^" if c.get("link")
            else "S" if "elder_statue" in c["id"]
            else ("." if c.get("walkable") else "#") for c in row))
print("overworld:", [(x, y, mid) for x, y, mid, *_ in overworld_changes])
print("PROBLEMS:", problems or "none")

if APPLY and not problems:
    # 1. maps
    maps_doc["maps"].extend(new_maps)
    # 2. overworld entrances (ruins tile linking to the archway)
    og = MAPS["varnfell"]["grid"]
    for x, y, mid, ax, ay, title in overworld_changes:
        cell = dict(TIME_RUIN)
        cell["link"] = {"map_id": mid, "x": ax, "y": ay}
        og[y][x] = cell
    # 3. Time's statue gets its lore too
    tg = MAPS["oracle_1"]["grid"]
    for y in range(12):
        for x in range(12):
            if tg[y][x].get("id", "").startswith("elder_statue_time"):
                tg[y][x]["lore"] = lore_id("time")
    out = json.dumps(maps_doc, indent=2, ensure_ascii=False) + "\n"
    open(maps_path, "w").write(out)
    # 4. lore
    lore_doc = {
        "_comment": "Varnfell lore. The Elder God inscriptions are read by bumping each oracle's ruined statue.",
        "lore": [
            {"id": lore_id(god), "name": name, "tags": ["Religion", "Elder Gods"],
             "xp": 10, "paragraphs": paras}
            for god, (name, paras) in LORE.items()
        ],
    }
    open(f"{MOD}/varnfell/lore.json", "w").write(json.dumps(lore_doc, indent=2, ensure_ascii=False) + "\n")
    print("APPLIED")
