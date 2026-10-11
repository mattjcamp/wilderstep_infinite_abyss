#!/usr/bin/env python3
"""Process townsfolk + town-animal sprites into game-ready 32x32 NPC sprites.

1. AngbandTk/dg_people32.gif — a 4x3 grid of 32x32 townsfolk on a white
   background. The background is removed by flood-filling white from each
   cell's border (NOT a global white key, which would punch holes in white
   shirts/hair). Sprites keep their native scale.
2. Town animals (54x54, magenta-keyed) from Monsters/ and XR module/.
   Unlike process_sprites.py these are NOT scaled to fill the frame — they
   keep native pixel scale so a chicken stays smaller than a horse. Content
   is centered horizontally and bottom-anchored on a 32x32 canvas.

Outputs go to processed_sprites/npc/ and web/public/sprites/person/
(the category NPC sprite pickers default to). Run
`npm run reindex-sprites` in web/ afterwards.

Usage:  python3 resources/process_town_npcs.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "free_to_use_sprites_org")
OUT_DIRS = [os.path.join(HERE, "processed_sprites", "npc"),
            os.path.join(HERE, "..", "web", "public", "sprites", "person")]
T = 32

PEOPLE = [  # (row, col) in dg_people32.gif -> name
    ["townsfolk_child", "townsfolk_farmer", "townsfolk_hunchback", "townsfolk_hunchback_grey"],
    ["townsfolk_jester", "townsfolk_beggar", "townsfolk_hunchback_red", "townsfolk_guard"],
    ["townsfolk_drunk", "townsfolk_blond", "townsfolk_duelist_red", "townsfolk_duelist_green"],
]

ANIMALS = {
    "Monsters/Horse01.PNG": "animal_horse_brown",
    "Monsters/Horse02.PNG": "animal_horse_white",
    "Monsters/Horse03.PNG": "animal_horse_pinto",
    "Monsters/CowLeft.PNG": "animal_cow",
    "Monsters/Chicken1.PNG": "animal_chicken",
    "Monsters/Chicken2.PNG": "animal_chicken2",
    "Monsters/DogBrown.PNG": "animal_dog_brown",
    "Monsters/DogGrey.PNG": "animal_dog_grey",
    "XR module/HB_Sheep01.PNG": "animal_sheep",
    "XR module/HB_Sheepsmall01.PNG": "animal_lamb",
}


def save(img, name):
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
        img.save(os.path.join(d, name + ".png"))
    print("wrote", name)


def flood_clear(cell, bg):
    w, h = cell.size
    px = cell.load()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + \
            [(x, y) for y in range(h) for x in (0, w - 1)]
    seen = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        if px[x, y][:3] != bg:
            continue
        px[x, y] = (0, 0, 0, 0)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]


def people():
    sheet = Image.open(os.path.join(SRC, "AngbandTk", "dg_people32.gif")).convert("RGBA")
    for r, row in enumerate(PEOPLE):
        for c, name in enumerate(row):
            cell = sheet.crop((c * T, r * T, c * T + T, r * T + T)).copy()
            flood_clear(cell, (255, 255, 255))
            save(cell, name)


def animals():
    for rel, name in ANIMALS.items():
        im = Image.open(os.path.join(SRC, rel)).convert("RGBA")
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, _ = px[x, y]
                if r >= 200 and g <= 60 and b >= 200:
                    px[x, y] = (0, 0, 0, 0)
        content = im.crop(im.getbbox())
        if content.width > T or content.height > T:  # safety: shrink only if needed
            content.thumbnail((T, T), Image.NEAREST)
        canvas = Image.new("RGBA", (T, T), (0, 0, 0, 0))
        canvas.paste(content, ((T - content.width) // 2, T - 1 - content.height), content)
        save(canvas, name)


if __name__ == "__main__":
    people()
    animals()
