# Spawn

## Purpose

Monster-lair behavior, keyed by the map tile that triggers it. When the party steps on or near a tile with a configured spawn point, this record drives the roamer-roller (`spawn_monsters` + `spawn_chance` + `max_spawned` + `spawn_radius`) and, when the party steps on the tile itself, the boss fight (`boss_monsters`).

Ported from v1's `data/spawn_points.json` (see `_v1_reference/docs/data_dictionary/spawn_points.json.md`).

## Location

`web/public/modules/default/spawns.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "spawns": [ <spawn_record>, ... ]
}
```

v1 keyed spawn records by stringified tile id; v2 flattens to an array and the integer `tile_id` becomes a regular field (so the catalog is uniform with the other v2 collections).

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"monster_spawn"`, `"dragon_lair"`) | TBD |
| `tile_id` | int | yes | The [Map Tile](map_tile.md) id this lair binds to (66, 67, 68, 69, 71, 75 in current data) | TBD |
| `name` | string | yes | Display name for the "Approach Lair?" prompt | TBD |
| `description` | string | no | Flavor text shown when approaching | TBD |
| `spawn_monsters` | string[] | yes | Roster the per-step roller picks from (uniform random) — Monster names | TBD |
| `spawn_chance` | int (1–100) | yes | Per-step percent chance to spawn a roamer | TBD |
| `spawn_radius` | int | yes | Chebyshev tile radius for the saturation check | TBD |
| `max_spawned` | int | yes | Cap on simultaneous roamers around the tile | TBD |
| `boss_monsters` | string[] | yes | Monsters composing the boss fight triggered when stepping on the tile itself | TBD |
| `xp_reward` | int | yes | XP awarded for clearing the lair | TBD |
| `gold_reward` | int | yes | Gold awarded for clearing the lair | TBD |
| `loot` | string[] | yes | Item names dropped on clear | TBD |

## Cross-references to other models

- `tile_id` → [Map Tile](map_tile.md) `tile_id` (the trigger tile)
- `spawn_monsters[]` and `boss_monsters[]` → [Monster](monster.md) names
- `loot[]` → [Item](item.md) names

## Example record

```json
{
  "id": "monster_spawn",
  "tile_id": 66,
  "name": "Monster Spawn",
  "description": "A monster lair.",
  "spawn_monsters": ["Giant Rat", "Wolf", "Goblin", "Orc", "Lich"],
  "spawn_chance": 5,
  "spawn_radius": 5,
  "max_spawned": 2,
  "boss_monsters": ["Goblin"],
  "xp_reward": 50,
  "gold_reward": 25,
  "loot": ["+2 Chain", "Arrows"]
}
```

## Notes and open questions

- **Dropped from v1 per the not-used rule:** `background_tile` (set on every v1 record but the v1 parser ignored it — cleared lairs in v1 had no explicit reveal tile). If cleared-lair reveal becomes a thing, re-introduce as `cleared_tile_id`.
- **`boss_monster` (singular) was a legacy fallback for `boss_monsters` in v1.** v2 keeps only the plural form; lairs that v1 had with only the singular set should be updated to populate `boss_monsters`.
- **Tile ids in v1 spawn data (66–75) overlap with tile ids in `tile_defs.json` that have `context: "spawns"`.** The relationship is implicit (the integers match by hand). v2 makes this explicit by giving Spawn a `tile_id` field that should be validated against [Map Tile](map_tile.md).
- **No id-based reference to Monster yet.** `spawn_monsters[]` and `boss_monsters[]` are Monster `name` strings — same convention as Item references elsewhere in v2.
