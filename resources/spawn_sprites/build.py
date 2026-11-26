"""Rebuild the Spawn lair sprites into web/public/modules/default/sprites/map/spawns/.

    python3 resources/spawn_sprites/build.py

Needs Pillow + numpy. Each sprite is defined in sprites.py; px.py is the
small drawing toolkit (palette pulled from the map/settlements art).
After rebuilding, run `npm run reindex-sprites` in web/ so the sprite
catalog picks up new files.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sprites import ALL  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "web", "public", "modules", "default", "sprites", "map", "spawns")
os.makedirs(OUT, exist_ok=True)
for name, make in ALL.items():
    make().save(os.path.join(OUT, f"{name}.png"))
print(f"wrote {len(ALL)} sprites to {os.path.normpath(OUT)}")
