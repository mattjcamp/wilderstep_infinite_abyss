"""Map a legacy flat sprite path to where that sprite lives now.

Default-module sprites were reorganised (Oct 2026) into folders that
mirror the Tile Palette tag hierarchy — e.g. tag "town:house:chapel" ->
sprites/town/house/chapel/. The old -> new table is the same one the
game uses: web/src/data_model/spriteAliases.json.

Art scripts that write straight into web/public/modules/<id>/sprites/
call relocate() on their output path so regenerated art overwrites the
sprite in its current folder instead of recreating the old flat layout.
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_ALIASES_JSON = os.path.join(_HERE, "..", "..", "web", "src", "data_model", "spriteAliases.json")
_ALIASES = json.load(open(_ALIASES_JSON))["aliases"] if os.path.exists(_ALIASES_JSON) else {}


def relocate(path):
    """Return `path` moved to the sprite's current folder (creating the
    folder), or `path` unchanged when it isn't a moved sprite."""
    norm = os.path.normpath(os.path.abspath(path))
    marker = os.sep + "sprites" + os.sep
    at = norm.rfind(marker)
    if at < 0:
        return path
    root, rel = norm[: at + len(marker)], norm[at + len(marker):].replace(os.sep, "/")
    new = _ALIASES.get(rel)
    if not new:
        return path
    out = os.path.join(root, *new.split("/"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    return out
